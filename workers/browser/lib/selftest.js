// §10.2 PLAN-IDEAL — fingerprint self-test (антидетект-метрика «0 сигналов бота»).
// Поднимает РЕАЛЬНЫЙ контекст аккаунта (newAccountContext — тот же отпечаток, что у боевых),
// через переданный прокси, и проверяет ключевые сигналы, по которым Instagram палит бота:
//   webdriver=false · UA-CH platform=ОС (не Linux) · WebGL≠SwiftShader · tz=ожидаемой ·
//   platform=ожидаемой · WebRTC не течёт (нет чужого публичного IP) · canvas стабилен.
// Цель — redCount === 0. Не трогает Instagram: ходит на нейтральный example.com.
import { gotoResilient } from './browser.js'

// Выполняется В СТРАНИЦЕ (сериализуется). Собирает сырые сигналы отпечатка.
async function collectInPage() {
  const out = {}
  out.webdriver = navigator.webdriver
  out.platform = navigator.platform
  out.userAgent = navigator.userAgent
  out.languages = navigator.languages ? [...navigator.languages] : null
  out.hardwareConcurrency = navigator.hardwareConcurrency
  out.deviceMemory = navigator.deviceMemory ?? null
  out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // UA Client Hints platform (getHighEntropyValues — то, что реально читает антибот сервера)
  try {
    const uad = navigator.userAgentData
    out.uaDataPlatform = uad ? (await uad.getHighEntropyValues(['platform'])).platform : null
  } catch { out.uaDataPlatform = null }

  // WebGL UNMASKED vendor/renderer (37445/37446) — главный GPU-tell (SwiftShader = headless)
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl')
    if (gl) {
      out.glVendor = gl.getParameter(37445)
      out.glRenderer = gl.getParameter(37446)
    } else { out.glVendor = null; out.glRenderer = null }
  } catch { out.glVendor = null; out.glRenderer = null }

  // Canvas 2D fingerprint — хеш (для проверки стабильности per-account/различия меж аккаунтами)
  try {
    const c = document.createElement('canvas')
    c.width = 220; c.height = 40
    const ctx = c.getContext('2d')
    ctx.textBaseline = 'top'; ctx.font = '14px Arial'
    ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 100, 20)
    ctx.fillStyle = '#069'; ctx.fillText('InstaGuard fp 🛡', 2, 2)
    const data = c.toDataURL()
    let h = 0
    for (let i = 0; i < data.length; i++) { h = (h * 31 + data.charCodeAt(i)) | 0 }
    out.canvasHash = String(h >>> 0)
  } catch { out.canvasHash = null }

  // Реальный egress этого контекста (через прокси) — тянем сами, чтобы не зависеть от
  // деградировавшего гео-сервиса (ipapi.is иногда не отдаёт IP → exitIp был null и любой
  // WebRTC-IP ложно считался утечкой). ipify отдаёт голый IP, нейтрален к Instagram.
  try {
    const r = await fetch('https://api.ipify.org?format=text', { cache: 'no-store' })
    out.egressIp = (await r.text()).trim()
  } catch { out.egressIp = null }

  // WebRTC: собрать IP-кандидаты. Утечка = чужой ПУБЛИЧНЫЙ IP (реальный IP воркера мимо прокси).
  out.webrtcIps = await new Promise((resolve) => {
    const ips = new Set()
    let pc
    try { pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }) }
    catch { return resolve([]) }
    try { pc.createDataChannel('x') } catch {}
    pc.onicecandidate = (e) => {
      if (!e.candidate || !e.candidate.candidate) return
      const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(e.candidate.candidate)
      if (m) ips.add(m[1])
    }
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {})
    setTimeout(() => { try { pc.close() } catch {}; resolve([...ips]) }, 2500)
  })

  return out
}

const isPrivateIp = (ip) =>
  /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
  /^127\./.test(ip) || /^169\.254\./.test(ip) || /^0\./.test(ip)

/**
 * @param {import('playwright').BrowserContext} context
 * @param {{platform:string, uaPlatform:string, timezoneId:string, locale:string, glRenderer:string}} expected
 * @param {string|null} exitIp — исходящий IP прокси (чтобы отличить его от утечки)
 */
export async function fingerprintSelfTest(context, expected, exitIp) {
  const page = await context.newPage()
  let signals
  try {
    await gotoResilient(page, 'https://example.com', { timeout: 30000, retries: 2 })
    signals = await page.evaluate(collectInPage)
  } finally {
    await page.close().catch(() => {})
  }

  const red = []
  const warnings = []

  if (signals.webdriver !== false) red.push(`navigator.webdriver=${signals.webdriver} (должно быть false)`)
  if (signals.glRenderer && /swiftshader|llvmpipe|\bmesa\b|software|microsoft basic/i.test(signals.glRenderer))
    red.push(`WebGL renderer выдаёт headless: "${signals.glRenderer}"`)
  if (!signals.glRenderer) warnings.push('WebGL renderer недоступен (не удалось прочитать)')
  if (signals.uaDataPlatform && /linux/i.test(signals.uaDataPlatform))
    red.push(`UA-CH platform="${signals.uaDataPlatform}" (палит серверный Linux; ожидалось "${expected.uaPlatform}")`)
  if (signals.uaDataPlatform && expected.uaPlatform && signals.uaDataPlatform !== expected.uaPlatform)
    warnings.push(`UA-CH platform="${signals.uaDataPlatform}" ≠ ожидаемой "${expected.uaPlatform}"`)
  if (signals.platform !== expected.platform)
    red.push(`navigator.platform="${signals.platform}" ≠ ожидаемой "${expected.platform}"`)
  if (signals.timezone !== expected.timezoneId)
    red.push(`timezone="${signals.timezone}" ≠ ожидаемой "${expected.timezoneId}"`)

  // WebRTC-утечка: любой ПУБЛИЧНЫЙ IP, не равный egress прокси. Приоритет — IP, вытянутый
  // самим контекстом (egressIp, надёжнее переданного exitIp из гео-сервиса).
  const knownEgress = signals.egressIp || exitIp
  const leaks = (signals.webrtcIps || []).filter((ip) => !isPrivateIp(ip) && ip !== knownEgress)
  if (leaks.length) red.push(`WebRTC утечка публичного IP: ${leaks.join(', ')} (не через прокси)`)

  return { signals, red, warnings, redCount: red.length, webrtcLeaks: leaks }
}

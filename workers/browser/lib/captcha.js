// Решение капчи через 2captcha.com при входе Instagram (reCAPTCHA v2 / hCaptcha / Arkose FunCaptcha).
// Instagram показывает капчу как доп. проверку при подозрительном входе (новый IP/прокси/устройство) —
// отдельно от challenge-кода и 2FA. Ключ — переменная окружения TWOCAPTCHA_API_KEY на сервисе воркера.
const API_KEY = process.env.TWOCAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY || ''
const IN_URL = 'https://2captcha.com/in.php'
const RES_URL = 'https://2captcha.com/res.php'

export function captchaConfigured() { return Boolean(API_KEY) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function submitTask(params) {
  const body = new URLSearchParams({ key: API_KEY, json: '1', ...params })
  const res = await fetch(IN_URL, { method: 'POST', body })
  const data = await res.json().catch(() => null)
  if (!data || data.status !== 1) throw new Error('2captcha_submit_failed: ' + (data?.request || 'нет ответа от 2captcha'))
  return data.request // id задачи
}

async function pollResult(id, { timeoutMs = 150000, intervalMs = 6000 } = {}) {
  const deadline = Date.now() + timeoutMs
  await sleep(intervalMs) // решению нужно время — сразу опрашивать бессмысленно
  while (Date.now() < deadline) {
    const res = await fetch(`${RES_URL}?key=${API_KEY}&action=get&id=${id}&json=1`)
    const data = await res.json().catch(() => null)
    if (data?.status === 1) return data.request
    if (data && data.request !== 'CAPCHA_NOT_READY') throw new Error('2captcha_failed: ' + data.request)
    await sleep(intervalMs)
  }
  throw new Error('2captcha_timeout: решение не пришло за отведённое время')
}

export async function solveRecaptchaV2({ sitekey, url, invisible = false }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  const id = await submitTask({ method: 'userrecaptcha', googlekey: sitekey, pageurl: url, invisible: invisible ? '1' : '0' })
  return pollResult(id)
}

export async function solveHCaptcha({ sitekey, url }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  const id = await submitTask({ method: 'hcaptcha', sitekey, pageurl: url })
  return pollResult(id)
}

export async function solveFunCaptcha({ publicKey, surl, url }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  const id = await submitTask({ method: 'funcaptcha', publickey: publicKey, surl, pageurl: url })
  return pollResult(id)
}

// Простая image-капча (искажённый текст/цифры НА КАРТИНКЕ, без JS-виджета) — Instagram иногда
// показывает такую на identity-checkpoint экранах (напр. после /accounts/suspended/). Отдельный
// метод 2captcha — «Normal Captcha» (тот же in.php/res.php, method=base64 + сырой base64 картинки).
export async function solveImageCaptcha(base64Image) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  const id = await submitTask({ method: 'base64', body: base64Image })
  return pollResult(id, { timeoutMs: 90000, intervalMs: 5000 })
}

// Найти на странице img-капчу (искажённый текст, не виджет) по подсказкам в src/alt/id/class,
// по ВСЕМ фреймам — возвращает Locator (нужен для .screenshot()), не текст/токен.
export async function findImageCaptchaLocator(page) {
  const candidates = [
    'img[src*="captcha" i]',
    'img[alt*="captcha" i]',
    'img[id*="captcha" i]',
    'img[class*="captcha" i]',
  ]
  for (const frame of page.frames()) {
    for (const sel of candidates) {
      try {
        const loc = frame.locator(sel).first()
        if (await loc.isVisible({ timeout: 800 }).catch(() => false)) return loc
      } catch {}
    }
  }
  return null
}

// Найти капчу по ВСЕМ фреймам страницы (виджет часто рисуется в главном документе,
// а сам вызов/iframe — вложенный; сначала ищем data-атрибуты, потом URL iframe).
export async function detectCaptcha(page) {
  for (const frame of page.frames()) {
    let found = null
    try {
      found = await frame.evaluate(() => {
        const rc = document.querySelector('.g-recaptcha[data-sitekey], [data-sitekey][data-callback], div[data-sitekey]')
        if (rc && rc.getAttribute('data-sitekey')) {
          return { type: 'recaptcha', sitekey: rc.getAttribute('data-sitekey') }
        }
        const hc = document.querySelector('.h-captcha[data-sitekey], [data-hcaptcha-widget-id]')
        if (hc && hc.getAttribute('data-sitekey')) {
          return { type: 'hcaptcha', sitekey: hc.getAttribute('data-sitekey') }
        }
        const fc = document.querySelector('#FunCaptcha, [data-pkey]')
        if (fc && fc.getAttribute('data-pkey')) {
          return { type: 'funcaptcha', publicKey: fc.getAttribute('data-pkey') }
        }
        const rcFrame = document.querySelector('iframe[src*="recaptcha"]')
        if (rcFrame) {
          const m = rcFrame.src.match(/[?&]k=([^&]+)/)
          if (m) return { type: 'recaptcha', sitekey: decodeURIComponent(m[1]) }
        }
        const hcFrame = document.querySelector('iframe[src*="hcaptcha"]')
        if (hcFrame) {
          const m = hcFrame.src.match(/[?&]sitekey=([^&]+)/)
          if (m) return { type: 'hcaptcha', sitekey: decodeURIComponent(m[1]) }
        }
        const fcFrame = document.querySelector('iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]')
        if (fcFrame) {
          const m = fcFrame.src.match(/[?&]pk=([^&]+)/)
          const s = fcFrame.src.match(/^https?:\/\/([^/]+)/)
          if (m) return { type: 'funcaptcha', publicKey: decodeURIComponent(m[1]), surl: s ? `https://${s[1]}` : undefined }
        }
        return null
      })
    } catch { found = null }
    if (found) return found
  }
  return null
}

// Вписать токен решения в форму + дёрнуть JS-callback виджета (нужно многим виджетам,
// иначе форма не считает капчу пройденной, даже если textarea заполнена).
async function injectToken(page, type, token) {
  const script = ({ tok, kind }) => {
    if (kind === 'hcaptcha') {
      const el = document.querySelector('textarea[name="h-captcha-response"], #h-captcha-response')
      if (el) { el.value = tok; el.innerHTML = tok }
      try {
        const cfg = window.hcaptcha
        if (cfg && typeof cfg.getRespKey === 'function') { /* no-op, читаем только */ }
      } catch {}
      return
    }
    if (kind === 'funcaptcha') {
      const el = document.querySelector('textarea[name="fc-token"], #fc-token, input[name="fc-token"]')
      if (el) el.value = tok
      try { if (typeof window.onFunCaptchaSuccess === 'function') window.onFunCaptchaSuccess(tok) } catch {}
      return
    }
    // recaptcha v2
    const el = document.querySelector('textarea[name="g-recaptcha-response"], #g-recaptcha-response')
    if (el) { el.value = tok; el.innerHTML = tok }
    try {
      const cfg = window.___grecaptcha_cfg
      if (cfg && cfg.clients) {
        for (const k in cfg.clients) {
          const client = cfg.clients[k]
          for (const kk in client) {
            const obj = client[kk]
            if (obj && typeof obj.callback === 'function') { obj.callback(tok); return }
            // вложенный объект с колбэком (структура ___grecaptcha_cfg varies по версии)
            if (obj && typeof obj === 'object') {
              for (const kkk in obj) {
                const inner = obj[kkk]
                if (inner && typeof inner.callback === 'function') { inner.callback(tok); return }
              }
            }
          }
        }
      }
    } catch {}
  }
  for (const frame of page.frames()) {
    try { await frame.evaluate(script, { tok: token, kind: type }) } catch {}
  }
}

// Обнаружить и решить капчу на текущей странице, вписав токен в форму.
// НЕ кликает «Продолжить»/submit — это делает вызывающий код (login.js), т.к. кнопка
// и её текст зависят от конкретного экрана (форма входа / challenge / device-approval).
export async function trySolveCaptcha(page) {
  if (!captchaConfigured()) return false
  const found = await detectCaptcha(page).catch(() => null)
  if (!found) return false
  const url = page.url()
  try {
    let token
    if (found.type === 'hcaptcha') token = await solveHCaptcha({ sitekey: found.sitekey, url })
    else if (found.type === 'funcaptcha') token = await solveFunCaptcha({ publicKey: found.publicKey, surl: found.surl, url })
    else token = await solveRecaptchaV2({ sitekey: found.sitekey, url })
    await injectToken(page, found.type, token)
    return true
  } catch (e) {
    console.error('[captcha] решение 2captcha не удалось:', e.message)
    return false
  }
}

// Стабильный отпечаток на аккаунт: один и тот же username → всегда один и тот же
// UA/viewport/locale/timezone/GPU (детерминированно). У разных аккаунтов — разные.
// Как в Python-воркере (_stable_device_settings): «фермой» пахнет, если один аккаунт
// заходит с разных устройств от раза к разу. См. plan.md §4.3 + PLAN-IDEAL §2.

function hashInt(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

// Реалистичные desktop-профили Chrome (Win/Mac). Мажор версии в UA-строке ({V}-плейсхолдер)
// подставляется в fingerprint() ИЗ РЕАЛЬНОГО запущенного браузера (browser.js передаёt chromeMajor,
// снятый через browser.version()) — раньше был захардкожен буквально "130.0.0.0" в каждом профиле
// (PLAN-MASTER D.3): если Playwright когда-нибудь обновит бандл Chromium (npm-апдейт), реальный
// движок разъедется с UA-строкой, хотя `sec-ch-ua`/UA-CH full-version-list (не оверрайдятся, см.
// browser.js) уже автоматически берут ПРАВДИВУЮ версию от самого браузера — рассинхрон между
// navigator.userAgent и sec-ch-ua = ровно тот бот-сигнал, которого добивались избежать. Нет данных
// от вызывающего кода (chromeMajor не передан) → фолбэк на "130" (текущий известный образ), без
// регресса. Каждый профиль несёт КОНСИСТЕНТНЫЙ с ОС набор: platform, UA-CH platform, WebGL
// vendor/renderer (правдоподобный GPU вместо SwiftShader — PLAN-IDEAL §2.1 [D1]/§2.2 [D2]/§2.7 [D6][D7]).
const PROFILES = [
  {
    os: 'win', uaTemplate: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{V}.0.0.0 Safari/537.36',
    vw: 1366, vh: 768, dpr: 1, platform: 'Win32', uaPlatform: 'Windows',
    glVendor: 'Google Inc. (Intel)', glRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    os: 'win', uaTemplate: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{V}.0.0.0 Safari/537.36',
    vw: 1536, vh: 864, dpr: 1, platform: 'Win32', uaPlatform: 'Windows',
    glVendor: 'Google Inc. (NVIDIA)', glRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    os: 'win', uaTemplate: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{V}.0.0.0 Safari/537.36',
    vw: 1920, vh: 1080, dpr: 1, platform: 'Win32', uaPlatform: 'Windows',
    glVendor: 'Google Inc. (Intel)', glRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    os: 'mac', uaTemplate: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{V}.0.0.0 Safari/537.36',
    vw: 1440, vh: 900, dpr: 2, platform: 'MacIntel', uaPlatform: 'macOS',
    glVendor: 'Google Inc. (Intel Inc.)', glRenderer: 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 640, OpenGL 4.1)',
  },
  {
    os: 'mac', uaTemplate: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{V}.0.0.0 Safari/537.36',
    vw: 1680, vh: 1050, dpr: 2, platform: 'MacIntel', uaPlatform: 'macOS',
    glVendor: 'Google Inc. (ATI Technologies Inc.)', glRenderer: 'ANGLE (AMD, AMD Radeon Pro 560 OpenGL Engine, OpenGL 4.1)',
  },
]

const DEFAULT_CHROME_MAJOR = '130' // фолбэк, если вызывающий код не передал реальную версию движка

// Правдоподобные пары (ядра CPU, память ГБ) для десктопа — стабильно на аккаунт (PLAN-IDEAL §2.7 [D7]).
const HW = [
  { cores: 8, mem: 8 },
  { cores: 4, mem: 8 },
  { cores: 12, mem: 16 },
  { cores: 8, mem: 16 },
  { cores: 6, mem: 8 },
]

/**
 * @param {string} username
 * @param {{locale?:string, timezoneId?:string, chromeMajor?:string}} [override] — гео из страны
 *   прокси (Фаза 4) + мажор версии РЕАЛЬНОГО запущенного Chromium (browser.js `browser.version()`,
 *   PLAN-MASTER D.3) — держит UA-строку в синхроне с движком без ручных правок при апдейте Playwright.
 */
export function fingerprint(username, override = {}) {
  const h = hashInt((username || 'anon').toLowerCase())
  const p = PROFILES[h % PROFILES.length]
  const hw = HW[(h >> 3) % HW.length]
  const chromeMajor = override.chromeMajor || DEFAULT_CHROME_MAJOR
  return {
    userAgent: p.uaTemplate.replace('{V}', chromeMajor),
    viewport: { width: p.vw, height: p.vh },
    locale: override.locale || 'en-US',
    timezoneId: override.timezoneId || 'America/New_York',
    deviceScaleFactor: p.dpr,
    // Консистентный с ОС набор для маскировки (browser.js применяет через initScript + заголовки).
    platform: p.platform,
    uaPlatform: p.uaPlatform,
    // UA-CH high-entropy platformVersion под ОС (иначе протекает версия ядра Linux-хоста при
    // platform="Windows"/"macOS" — рассинхрон = бот-сигнал, PLAN-IDEAL [D2]/PLAN-MASTER D.1).
    // Windows: "10.0.0" (Win10, консистентно с UA "Windows NT 10.0"); macOS: реальные Chrome шлют
    // современную версию при frozen-UA "10_15_7" — берём "14.5.0" (как реальный флот).
    uaPlatformVersion: p.uaPlatform === 'Windows' ? '10.0.0' : '14.5.0',
    glVendor: p.glVendor,
    glRenderer: p.glRenderer,
    hardwareConcurrency: hw.cores,
    deviceMemory: hw.mem,
    // Стабильные на аккаунт СИДы для шума Canvas/Audio-отпечатка (как Dolphin/GoLogin): у разных
    // аккаунтов отпечаток РАЗНЫЙ, но у одного — ОДИН И ТОТ ЖЕ каждый раз (смена = свой сигнал).
    canvasSeed: (h ^ 0x9e3779b9) >>> 0,
    audioSeed: (Math.imul(h, 2246822519) ^ 0x85ebca6b) >>> 0,
  }
}

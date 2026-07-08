// Стабильный отпечаток на аккаунт: один и тот же username → всегда один и тот же
// UA/viewport/locale/timezone (детерминированно). У разных аккаунтов — разные.
// Как в Python-воркере (_stable_device_settings): «фермой» пахнет, если один аккаунт
// заходит с разных устройств от раза к разу. См. plan.md §4.3.

function hashInt(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

// Реалистичные desktop-профили Chrome (Win/Mac). UA-версия совпадает по мажору с Chromium
// в базовом Playwright-образе (~130). Меняйте вместе с обновлением образа.
const PROFILES = [
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', vw: 1366, vh: 768 },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', vw: 1536, vh: 864 },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', vw: 1920, vh: 1080 },
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', vw: 1440, vh: 900 },
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', vw: 1680, vh: 1050 },
]

/**
 * @param {string} username
 * @param {{locale?:string, timezoneId?:string}} [override] — гео из страны прокси (Фаза 4)
 */
export function fingerprint(username, override = {}) {
  const h = hashInt((username || 'anon').toLowerCase())
  const p = PROFILES[h % PROFILES.length]
  return {
    userAgent: p.ua,
    viewport: { width: p.vw, height: p.vh },
    locale: override.locale || 'en-US',
    timezoneId: override.timezoneId || 'America/New_York',
    deviceScaleFactor: 1,
  }
}

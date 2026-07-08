// Запуск Chromium (stealth) + фабрика контекстов на аккаунт. См. plan.md §4.2/§4.3.
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { resolveProxy } from './proxy.js'
import { fingerprint } from './fingerprint.js'

chromium.use(StealthPlugin())

let _browser = null

export async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser
  const headful = process.env.BROWSER_HEADFUL === '1' && process.env.NODE_ENV !== 'production'
  _browser = await chromium.launch({
    headless: !headful,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-features=IsolateOrigins,site-per-process',
      '--lang=en-US',
    ],
  })
  return _browser
}

/**
 * Новый контекст под конкретный аккаунт: стабильный отпечаток + прокси (+ восстановленная сессия).
 * @param {{username:string, proxy?:string, storageState?:object, locale?:string, timezoneId?:string}} opts
 */
export async function newAccountContext(opts) {
  const { username, proxy, storageState, locale, timezoneId } = opts
  const browser = await getBrowser()
  const fp = fingerprint(username, { locale, timezoneId })

  const ctxOpts = {
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    deviceScaleFactor: fp.deviceScaleFactor,
    serviceWorkers: 'block',
  }
  // Автоопределение схемы (http/socks5/socks4) — прокси часто даются без указания
  // протокола, а неверная схема выглядит как «страница не загрузилась» (см. proxy.js).
  const p = await resolveProxy(getBrowser, proxy)
  if (p) ctxOpts.proxy = p
  if (storageState) ctxOpts.storageState = storageState

  const context = await browser.newContext(ctxOpts)
  // Доп. маскировка (stealth покрывает большую часть; это подстраховка).
  await context.addInitScript(() => {
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) } catch {}
  })
  context.setDefaultTimeout(45000)
  context.setDefaultNavigationTimeout(60000)
  return context
}

export async function closeContextSafe(context) {
  try { await context?.close() } catch {}
}

/**
 * Навигация с ретраями на СЕТЕВЫЕ сбои (ротирующие/резидентные прокси часто моргают
 * и восстанавливаются — техника из Python-воркера, `_login_with_retry`,
 * CLAUDE.md 2026-07-07(11)). Не путать с логическими исходами (bad_password/checkpoint) —
 * те возвращаются штатно через DOM, сюда не попадают.
 * @param {import('playwright-core').Page} page
 */
export async function gotoResilient(page, url, { timeout = 60000, retries = 2, backoffMs = [1500, 4000] } = {}) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
      return
    } catch (e) {
      lastErr = e
      if (i < retries) await new Promise((r) => setTimeout(r, backoffMs[i] ?? 4000))
    }
  }
  throw new Error(`network: прокси не доходит до Instagram (${String(lastErr?.message ?? 'таймаут').slice(0, 140)})`)
}

// ── DOM-хелперы: перебор вариантов селекторов, первый видимый ──────────────────

export async function firstVisible(page, selectors, timeout = 6000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first()
        if (await loc.isVisible().catch(() => false)) return loc
      } catch {}
    }
    await page.waitForTimeout(300)
  }
  return null
}

// Клик по кнопке/ссылке с одним из текстов (getByText, точное совпадение, первый видимый).
export async function clickByText(page, texts, { timeout = 6000 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const t of texts) {
      try {
        const loc = page.getByRole('button', { name: t, exact: true }).first()
        if (await loc.isVisible().catch(() => false)) { await loc.click({ delay: 60 }); return true }
      } catch {}
      try {
        const loc2 = page.getByText(t, { exact: true }).first()
        if (await loc2.isVisible().catch(() => false)) { await loc2.click({ delay: 60 }); return true }
      } catch {}
    }
    await page.waitForTimeout(250)
  }
  return false
}

// Есть ли на странице любой из текстов (для детекции состояний).
export async function pageHasText(page, texts) {
  for (const t of texts) {
    try {
      if (await page.getByText(t, { exact: false }).first().isVisible().catch(() => false)) return true
    } catch {}
  }
  return false
}

// Залогинен ли контекст: наличие куки sessionid.
export async function hasSessionCookie(context) {
  try {
    const cookies = await context.cookies('https://www.instagram.com')
    return cookies.some((c) => c.name === 'sessionid' && c.value)
  } catch {
    return false
  }
}

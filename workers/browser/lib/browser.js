// Запуск Chromium (stealth) + фабрика контекстов на аккаунт. См. plan.md §4.2/§4.3.
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { resolveProxy } from './proxy.js'
import { fingerprint } from './fingerprint.js'
import { humanClick } from './human.js'   // человеческий клик (кривая траектория) — plan.md §1.3

// §10.2: отключаем два дефолта stealth, которые ПЕРЕБИВАЮТ наш консистентный с ОС отпечаток:
//  • 'webgl.vendor' — ставит macOS-строку "Intel Inc./Intel Iris OpenGL Engine" ПОВЕРХ нашего
//    Windows-профиля (ANGLE ...D3D11) → нестыковка ОС/GPU = сигнал бота (self-test поймал это).
//  • 'navigator.hardwareConcurrency' — жёсткие 4 ядра поверх нашего стабильного-на-аккаунт HW.
// Оба значения мы ставим сами в newAccountContext (addInitScript из fingerprint()).
const _stealth = StealthPlugin()
_stealth.enabledEvasions.delete('webgl.vendor')
_stealth.enabledEvasions.delete('navigator.hardwareConcurrency')
chromium.use(_stealth)

let _browser = null
let _launching = null   // §6.1 single-flight: промис текущего запуска (защита от гонки старта)

// Аргументы запуска Chromium (общие для headful/headless).
const LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-features=IsolateOrigins,site-per-process',
  // WebRTC: не отдавать не-проксированный UDP → реальный IP сервера не утекает в обход прокси
  // (PLAN-IDEAL §2.9 [D11]). Без этого STUN может светить датацентр-IP даже на чистом резиденте.
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  // УБРАНЫ: --disable-gpu (давал WebGL=SwiftShader — headless/VM-утечка, §2.1 [D1]) и
  // --lang=en-US (конфликтовал с гео-локалью контекста, §2.6 [D4]; локаль ставит сам контекст).
]

/**
 * Запуск Chromium. ПО УМОЛЧАНИЮ — headful (видимый браузер), т.к. в этом весь смысл
 * перехода на «эмуль»: Instagram отдаёт headless-Chromium бот-стену (страница без формы
 * входа), а живому окну — нормальный вход (см. plan.md §1, memory pivot-to-browser-emulator).
 * В проде (Railway/Docker) окна нет — headful крутится под виртуальным дисплеем Xvfb
 * (`xvfb-run` в Dockerfile CMD). RAM это почти не добавляет (кадровый буфер крошечный;
 * тяжёлые — контексты Chromium, а не head/headless), поэтому риск §377 плана не растёт.
 * Аварийный откат: `BROWSER_HEADLESS=1` форсит старый headless. Если headful не стартует
 * (нет $DISPLAY — Xvfb не поднялся) — деградируем в headless, а не роняем весь воркер.
 */
export async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser
  // §6.1 single-flight: при холодном старте ИЛИ после краша браузера несколько одновременных
  // запросов (concurrency MAX) все увидят !isConnected и запустят СВОЙ Chromium — лишние процессы
  // осиротеют (в `_browser` попадёт только последний) = утечка процессов/RAM под нагрузкой.
  // Держим один промис запуска: параллельные вызовы ждут его, а не плодят браузеры.
  if (_launching) return _launching
  const forceHeadless = process.env.BROWSER_HEADLESS === '1'
  const wantHeadful = !forceHeadless
  _launching = (async () => {
    try {
      return await chromium.launch({ headless: !wantHeadful, args: LAUNCH_ARGS })
    } catch (e) {
      if (wantHeadful) {
        // Скорее всего «Missing X server or $DISPLAY» — Xvfb не запущен. Не падаем.
        console.warn('[browser] headful-запуск не удался, откат в headless:', String(e?.message || e).slice(0, 160))
        return await chromium.launch({ headless: true, args: LAUNCH_ARGS })
      }
      throw e
    }
  })()
  try {
    _browser = await _launching
    return _browser
  } finally {
    _launching = null   // сбрасываем и на успехе, и на ошибке (следующий вызов повторит запуск)
  }
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
    // UA-CH platform под заявленную ОС (иначе Chrome шлёт "Linux" → палит сервер, §2.2 [D2]).
    extraHTTPHeaders: { 'sec-ch-ua-platform': `"${fp.uaPlatform}"` },
  }
  // Автоопределение схемы (http/socks5/socks4) — прокси часто даются без указания
  // протокола, а неверная схема выглядит как «страница не загрузилась» (см. proxy.js).
  const p = await resolveProxy(getBrowser, proxy)
  if (p) ctxOpts.proxy = p
  if (storageState) ctxOpts.storageState = storageState

  const context = await browser.newContext(ctxOpts)
  // Доп. маскировка (stealth покрывает часть; это подстраховка + консистентность с ОС отпечатка).
  // Все значения — из fingerprint() (стабильны на аккаунт). PLAN-IDEAL §2.1/2.2/2.7.
  await context.addInitScript((fp) => {
    const def = (obj, prop, val) => { try { Object.defineProperty(obj, prop, { get: () => val }) } catch {} }
    def(navigator, 'webdriver', false)
    def(navigator, 'platform', fp.platform)
    def(navigator, 'hardwareConcurrency', fp.hardwareConcurrency)
    def(navigator, 'deviceMemory', fp.deviceMemory)
    // UA Client Hints → под заявленную ОС (иначе navigator.userAgentData.platform='Linux' — палево).
    try {
      const uad = navigator.userAgentData
      if (uad) {
        def(uad, 'platform', fp.uaPlatform)
        const orig = uad.getHighEntropyValues && uad.getHighEntropyValues.bind(uad)
        if (orig) uad.getHighEntropyValues = (hints) => orig(hints).then((v) => Object.assign({}, v, { platform: fp.uaPlatform }))
      }
    } catch {}
    // WebGL UNMASKED vendor/renderer → правдоподобный GPU вместо SwiftShader (§2.1 [D1]).
    try {
      const patch = (proto) => {
        if (!proto || !proto.getParameter) return
        const gp = proto.getParameter
        proto.getParameter = function (p) {
          if (p === 37445) return fp.glVendor    // UNMASKED_VENDOR_WEBGL
          if (p === 37446) return fp.glRenderer   // UNMASKED_RENDERER_WEBGL
          return gp.call(this, p)
        }
      }
      patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype)
      patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype)
    } catch {}
    // WebRTC IP-leak guard (§2.9 [D11] / §10.2): launch-флаг disable_non_proxied_udp не всегда
    // держит — self-test поймал утечку реального датацентр-egress (Railway) мимо резидентного
    // HTTP-прокси = сильнейший сигнал прокси-детекта. HTTP/SOCKS-прокси не носят UDP, поэтому
    // легитимный исход за таким прокси — вообще НЕТ публичных srflx-кандидатов; режем публичные
    // IP из ICE-кандидатов на уровне JS (детерминированно, независимо от Chromium). Приватные/
    // mDNS-кандидаты оставляем (их даёт и обычный Chrome). toString подделан под нативный.
    try {
      const NativeRTC = window.RTCPeerConnection || window.webkitRTCPeerConnection
      if (NativeRTC) {
        const isPublic = (cand) => {
          const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(cand || '')
          if (!m) return false
          const ip = m[1]
          return !(/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
                   /^127\./.test(ip) || /^169\.254\./.test(ip) || /^0\./.test(ip))
        }
        const drop = (e) => e && e.candidate && isPublic(e.candidate.candidate)
        function RTCPeerConnection(...args) {
          const pc = new NativeRTC(...args)
          const origAEL = pc.addEventListener.bind(pc)
          let oncb = null
          try {
            Object.defineProperty(pc, 'onicecandidate', {
              configurable: true, get() { return oncb }, set(fn) { oncb = fn },
            })
          } catch {}
          origAEL('icecandidate', (e) => { if (oncb && !drop(e)) oncb.call(pc, e) })
          pc.addEventListener = function (type, listener, opts) {
            if (type === 'icecandidate' && typeof listener === 'function') {
              return origAEL(type, (e) => { if (!drop(e)) listener.call(pc, e) }, opts)
            }
            return origAEL(type, listener, opts)
          }
          return pc
        }
        RTCPeerConnection.prototype = NativeRTC.prototype
        try {
          Object.defineProperty(RTCPeerConnection, 'name', { value: 'RTCPeerConnection' })
          RTCPeerConnection.toString = () => 'function RTCPeerConnection() { [native code] }'
        } catch {}
        window.RTCPeerConnection = RTCPeerConnection
        if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = RTCPeerConnection
      }
    } catch {}
  }, fp)
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
export async function gotoResilient(page, url, { timeout = 60000, retries = 3, backoffMs = [2000, 5000, 10000] } = {}) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      // 'commit' (первый байт ответа) толерантнее к медленным/моргающим резидентным прокси,
      // чем 'domcontentloaded'. Форму/сессию дальше по коду ждём ЯВНО (waitForSelector /
      // hasSessionCookie), поэтому ранний commit безопасен и не «недогружает» страницу.
      // Ошибки уровня прокси (ERR_HTTP_RESPONSE_CODE_FAILURE / ERR_TUNNEL_CONNECTION_FAILED /
      // таймаут) — часто транзиентны у резидентных прокси; повторяем с нарастающей паузой.
      await page.goto(url, { waitUntil: 'commit', timeout })
      return
    } catch (e) {
      lastErr = e
      if (i < retries) await new Promise((r) => setTimeout(r, backoffMs[i] ?? 8000))
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

// Как firstVisible, но перебирает ВСЕ фреймы страницы (не только главный). Инстаграм обычно
// не иет форму входа во фрейм, но некоторые consent/anti-bot прослойки могут — обычный
// page.locator() их не видит, хотя на скриншоте форма выглядит нормально (см. login.js
// «поля не найдены, хотя на скрине видны» — диагностика этого случая).
export async function firstVisibleAnyFrame(page, selectors, timeout = 6000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const sel of selectors) {
        try {
          const loc = frame.locator(sel).first()
          if (await loc.isVisible().catch(() => false)) return loc
        } catch {}
      }
    }
    await page.waitForTimeout(300)
  }
  return null
}

// Клик по кнопке/ссылке с одним из текстов (getByText, точное совпадение, первый видимый).
// Клик — человеческий (кривая траектория курсора + смещение от центра, plan.md §1.3).
export async function clickByText(page, texts, { timeout = 6000 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const t of texts) {
      try {
        const loc = page.getByRole('button', { name: t, exact: true }).first()
        if (await loc.isVisible().catch(() => false)) { await humanClick(page, loc); return true }
      } catch {}
      try {
        const loc2 = page.getByText(t, { exact: true }).first()
        if (await loc2.isVisible().catch(() => false)) { await humanClick(page, loc2); return true }
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

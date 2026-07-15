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
    // Canvas fingerprint: детерминированный на аккаунт шум (как Dolphin/GoLogin). У разных аккаунтов
    // canvas-отпечаток РАЗНЫЙ, у одного — стабильный (иначе смена отпечатка = свой сигнал). Шум ±1
    // на части пикселей — незаметно глазу, но меняет хеш. Оригинальный canvas НЕ мутируем (для
    // toDataURL рисуем в теневой canvas). Всё в try/catch — не ломает рендер страницы.
    try {
      const cseed = (fp.canvasSeed >>> 0) || 0x9e3779b9
      const shift = (i) => (((Math.imul(i + 1, 2654435761) ^ cseed) >>> 0) % 3) - 1  // -1|0|+1, детерминир.
      const applyNoise = (data) => { for (let i = 0; i < data.length; i += 4) { if (((i >> 2) % 11) === 0) { const s = shift(i); data[i] = Math.max(0, Math.min(255, data[i] + s)); data[i + 1] = Math.max(0, Math.min(255, data[i + 1] - s)) } } }
      const C2D = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype
      const origGID = C2D && C2D.getImageData
      if (C2D && origGID) {
        C2D.getImageData = function (sx, sy, sw, sh) { const img = origGID.call(this, sx, sy, sw, sh); try { applyNoise(img.data) } catch {} return img }
      }
      const HCE = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype
      if (HCE && origGID) {
        const origToDataURL = HCE.toDataURL
        HCE.toDataURL = function (...a) {
          try {
            if (this.width && this.height && this.width * this.height < 4e6) {
              const sh = document.createElement('canvas'); sh.width = this.width; sh.height = this.height
              const sctx = sh.getContext('2d'); sctx.drawImage(this, 0, 0)
              const img = origGID.call(sctx, 0, 0, this.width, this.height); applyNoise(img.data); sctx.putImageData(img, 0, 0)
              return origToDataURL.apply(sh, a)
            }
          } catch {}
          return origToDataURL.apply(this, a)
        }
      }
    } catch {}
    // AudioContext fingerprint: лёгкий детерминированный шум в аудио-буфере (тоже стабильный на аккаунт).
    try {
      const aseed = (fp.audioSeed >>> 0) || 0x85ebca6b
      const AB = window.AudioBuffer && window.AudioBuffer.prototype
      if (AB && AB.getChannelData) {
        const origGCD = AB.getChannelData
        AB.getChannelData = function (ch) {
          const arr = origGCD.call(this, ch)
          try { for (let i = 0; i < arr.length; i += 1000) arr[i] = arr[i] + ((((Math.imul(i + 1, aseed) >>> 0) % 1000) - 500) * 1e-8) } catch {}
          return arr
        }
      }
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

// ── Кэш контекстов на аккаунт: ОДНА браузерная сессия на цикл ────────────────────
// Раньше на КАЖДУЮ цель открывался и закрывался свой контекст («вошёл → действие → вышел →
// снова вошёл» — не по-человечески). Теперь контекст переиспользуется по ключу username|proxy:
// первая цель цикла создаёт контекст (+прогрев), остальные цели того же цикла работают в ТОМ ЖЕ
// контексте (без повторного «входа»/прогрева), а закрывается он по ПРОСТОЮ (idle) — как человек
// зашёл, сделал всё и ушёл. Живучесть: мёртвый контекст выселяется, следующий вызов создаст свежий.
const _ctxCache = new Map() // key → { context, lastUsed, warmedUp }
const CTX_IDLE_MS = 2 * 60 * 1000   // закрыть по простою 2 мин (цикл на аккаунт укладывается)
const CTX_MAX = 3                    // держим мало открытых контекстов (RAM Chromium) — остальное закрывается
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of _ctxCache) {
    if (now - v.lastUsed > CTX_IDLE_MS) { _ctxCache.delete(k); closeContextSafe(v.context) }
  }
}, 30 * 1000).unref?.()

function ctxKey(opts) { return `${String(opts.username || 'owner').toLowerCase()}|${opts.proxy || ''}` }

/**
 * Получить переиспользуемый контекст на аккаунт (создать при первом обращении цикла).
 * @returns {{context, reused:boolean, key:string}} reused=true → прогрев уже был, повторять НЕ надо.
 */
export async function getOrCreateContext(opts) {
  const key = ctxKey(opts)
  const hit = _ctxCache.get(key)
  if (hit) {
    try { hit.context.pages(); hit.lastUsed = Date.now(); return { context: hit.context, reused: true, key } } // живой
    catch { _ctxCache.delete(key); await closeContextSafe(hit.context) }                                        // мёртвый — выселяем
  }
  if (_ctxCache.size >= CTX_MAX) {                     // переполнение — закрыть самый старый
    let ok = null, ot = Infinity
    for (const [k, v] of _ctxCache) if (v.lastUsed < ot) { ot = v.lastUsed; ok = k }
    if (ok) { const v = _ctxCache.get(ok); _ctxCache.delete(ok); await closeContextSafe(v.context) }
  }
  const context = await newAccountContext(opts)
  _ctxCache.set(key, { context, lastUsed: Date.now(), warmedUp: false })
  return { context, reused: false, key }
}

export function touchContext(key) { const v = _ctxCache.get(key); if (v) v.lastUsed = Date.now() }
export async function evictContext(key) { const v = _ctxCache.get(key); if (v) { _ctxCache.delete(key); await closeContextSafe(v.context) } }

// context.storageState() бросает "Target page, context or browser has been closed", если контекст
// уже закрыт (краш браузера / дохлый прокси оборвал соединение / гонка закрытия). Тогда возвращаем
// undefined, а не роняем ВСЁ действие криптовой ошибкой — сессия просто не «дозреет» в этот раз.
export async function safeStorageState(context) {
  try { return await context.storageState() } catch { return undefined }
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
  throw new Error(`network: прокси моргнул — Instagram не ответил за ${retries + 1} попыток (резидентные прокси иногда сбоят на коннекте; повторите вход через пару секунд или смените прокси). ${String(lastErr?.message ?? 'таймаут').slice(0, 120)}`)
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

// Как clickByText, но НЕ кликает — только проверяет присутствие контрола (§10.3 dry-run:
// «дошли до кнопки действия без финального клика»). Возвращает true, если найден.
export async function findByText(page, texts, { timeout = 6000 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const t of texts) {
      try {
        const b = page.getByRole('button', { name: t, exact: true }).first()
        if (await b.isVisible().catch(() => false)) return true
      } catch {}
      try {
        const g = page.getByText(t, { exact: true }).first()
        if (await g.isVisible().catch(() => false)) return true
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

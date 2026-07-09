// Разбор строки прокси + автоопределение схемы (http/socks5/socks4).
// Перенесено из Python-воркера (workers/python/instagrapi_client.py
// _resolve_proxy_scheme, см. CLAUDE.md 2026-07-07(5)) — многие продавцы дают строку
// "host:port:user:pass" БЕЗ указания протокола, а Playwright (в отличие от requests)
// не пытается угадать: если прокси на самом деле SOCKS5, а мы шлём HTTP CONNECT,
// страница просто не грузится ("network: страница входа не загрузилась") — ровно
// симптом, с которым столкнулся пользователь на реальном прокси.
const _schemeCache = new Map() // hostPort → рабочая схема (кеш на процесс)

function splitProxy(raw) {
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null

  let scheme = null
  const schemeMatch = s.match(/^(\w+):\/\//)
  if (schemeMatch) { scheme = schemeMatch[1].toLowerCase(); s = s.slice(schemeMatch[0].length) }

  let username, password, hostPort
  if (s.includes('@')) {
    const at = s.lastIndexOf('@')
    const creds = s.slice(0, at), hp = s.slice(at + 1)
    hostPort = hp
    const ci = creds.indexOf(':')
    if (ci >= 0) { username = creds.slice(0, ci); password = creds.slice(ci + 1) }
    else username = creds
  } else {
    const parts = s.split(':')
    if (parts.length === 4) { hostPort = `${parts[0]}:${parts[1]}`; username = parts[2]; password = parts[3] }
    else hostPort = s
  }
  if (!hostPort || !hostPort.includes(':')) return null
  return { scheme, hostPort, username, password }
}

function toPlaywrightProxy(scheme, p) {
  const out = { server: `${scheme}://${p.hostPort}` }
  if (p.username) out.username = p.username
  if (p.password !== undefined) out.password = p.password
  return out
}

// Нейтральный лёгкий endpoint: проверяем, что прокси ВООБЩЕ носит трафик.
// НЕ Instagram: раньше схему проверяли заходом на instagram.com — если IG капризничал
// через этот IP (гео/анти-бот), схема ложно считалась нерабочей и ЖИВОЙ прокси метился
// «мёртвым» (ровно жалоба пользователя: внешний чекер — ок, наш — «не отвечает»).
// Доходимость прокси и достижимость IG — разные вещи; IG проверяет сам вход.
const PROBE_URL = 'https://api.ipify.org/?format=json'

// Пробное подключение через ВРЕМЕННЫЙ КОНТЕКСТ (дёшево — не новый браузер, переиспользуем
// общий процесс Chromium из browser.js).
async function schemeWorks(browser, scheme, p) {
  let context
  try {
    context = await browser.newContext({ proxy: toPlaywrightProxy(scheme, p) })
    const page = await context.newPage()
    await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded', timeout: 8000 })
    return true
  } catch {
    return false
  } finally {
    await context?.close().catch(() => {})
  }
}

/**
 * Резолвит строку прокси в готовый Playwright proxy-объект.
 * Схема указана явно (socks5://…) — используется как есть (доверяем пользователю).
 * Иначе — автоопределение http → socks5 → socks4 реальным подключением, результат
 * кешируется на процесс по hostPort (как в Python-воркере), чтобы не пробовать на
 * каждый вход/действие. Ни одна схема не дошла — фолбэк на http (прежнее поведение;
 * дальше по цепочке всё равно придёт честная ошибка входа/действия).
 * @param {() => Promise<import('playwright-core').Browser>} getBrowser
 */
export async function resolveProxy(getBrowser, raw) {
  const p = splitProxy(raw)
  if (!p) return null
  if (p.scheme) return toPlaywrightProxy(p.scheme, p)

  const cached = _schemeCache.get(p.hostPort)
  if (cached) return toPlaywrightProxy(cached, p)

  const browser = await getBrowser()
  // Схемы пробуем ПАРАЛЛЕЛЬНО — первая рабочая выигрывает. Мёртвый прокси выявляется
  // за ~8с (один таймаут), а не за ~24с последовательного перебора. Это критично:
  // при мёртвом прокси вход иначе висел до клиентского таймаута (см. CLAUDE.md — TCP_INVALID).
  const probes = ['http', 'socks5', 'socks4'].map((scheme) =>
    schemeWorks(browser, scheme, p).then((ok) => {
      if (ok) return scheme
      throw new Error('scheme-fail')
    }),
  )
  let winner = null
  try { winner = await Promise.any(probes) } catch { winner = null }
  if (winner) {
    _schemeCache.set(p.hostPort, winner)
    return toPlaywrightProxy(winner, p)
  }
  // Ни одна схема не дошла до Instagram → прокси мёртв/битый (или неверные креды/тип).
  // Быстрый ЯВНЫЙ отказ вместо доомной навигации на 40+ секунд.
  throw new Error(
    'proxy_dead: прокси не отвечает ни по одной схеме (http/socks5/socks4). ' +
    'Проверьте его на вкладке «Прокси» → «Проверить IP» или замените — ' +
    'вход через нерабочий прокси невозможен. В сетевом логе такой прокси даёт TCP_INVALID.',
  )
}

// host:port без логина/пароля — для логов (видно, через какой IP шёл вход).
export function proxyHostLabel(raw) {
  const p = splitProxy(raw)
  if (!p) return 'без прокси'
  return p.hostPort
}

/**
 * Проверка прокси браузером: исходящий IP/страна/провайдер + флаги (датацентр/vpn/mobile),
 * как их видит внешний сервис ЧЕРЕЗ этот прокси. Заменяет мёртвый Python-воркер `/check-proxy`
 * (тот перестал существовать → «Application not found»). Источник — ipapi.is (тот же, что
 * использовал Python, формы совпадают). Возвращает { ok:false } на нерабочем прокси (НЕ throw).
 * @param {() => Promise<import('playwright-core').Browser>} getBrowser
 */
export async function checkProxyBrowser(getBrowser, raw) {
  let pw
  try {
    pw = await resolveProxy(getBrowser, raw)  // бросит proxy_dead, если ни одна схема не носит трафик
  } catch (e) {
    return { ok: false, error: String(e?.message || 'proxy_dead').slice(0, 200) }
  }
  if (!pw) return { ok: false, error: 'пустая строка прокси' }

  const browser = await getBrowser()
  const scheme = pw.server.split('://')[0]
  let context
  try {
    context = await browser.newContext({ proxy: pw })
    const page = await context.newPage()
    await page.goto('https://ipapi.is/json/', { waitUntil: 'domcontentloaded', timeout: 15000 })
    const text = await page.evaluate(() => document.body?.innerText || '')
    let d = {}
    try { d = JSON.parse(text) } catch {}
    return {
      ok: true,
      ip: d.ip || null,
      country: d?.location?.country || d?.country || null,
      isp: d?.company?.name || d?.asn?.org || d?.asn?.descr || null,
      scheme,
      datacenter: d?.is_datacenter ?? null,
      vpn: d?.is_vpn ?? null,
      proxy: d?.is_proxy ?? null,
      mobile: d?.is_mobile ?? null,
      companyType: d?.company?.type ?? null,
    }
  } catch (e) {
    // resolveProxy выше УЖЕ подтвердил, что прокси НОСИТ трафик (дошёл до ipify).
    // Значит сбой здесь — недоступность гео-сервиса ipapi.is, а НЕ мёртвый прокси.
    // Не метим прокси мёртвым: отдаём ok:true (degraded) без гео-деталей, чтобы живой
    // прокси не считался дохлым из-за хиккапа стороннего сервиса.
    return {
      ok: true, degraded: true, scheme,
      ip: null, country: null, isp: null,
      datacenter: null, vpn: null, proxy: null, mobile: null,
      note: 'Прокси работает, но гео-сервис не ответил — детали IP недоступны',
    }
  } finally {
    await context?.close().catch(() => {})
  }
}

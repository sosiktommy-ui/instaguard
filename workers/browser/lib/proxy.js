// Разбор строки прокси + автоопределение схемы (http/socks5/socks4).
// Перенесено из Python-воркера (workers/python/instagrapi_client.py
// _resolve_proxy_scheme, см. CLAUDE.md 2026-07-07(5)) — многие продавцы дают строку
// "host:port:user:pass" БЕЗ указания протокола, а Playwright (в отличие от requests)
// не пытается угадать: если прокси на самом деле SOCKS5, а мы шлём HTTP CONNECT,
// страница просто не грузится ("network: страница входа не загрузилась") — ровно
// симптом, с которым столкнулся пользователь на реальном прокси.
const _schemeCache = new Map() // hostPort → рабочая схема (кеш на процесс)

// «host:port» валиден, только если порт — ЧИСЛО 1..65535. Без этой проверки строка вида
// «u36387_h35p:KGLvZQv6..._session-XXX_lifetime-1440» (это ЛОГИН:ПАРОЛЬ резидентного прокси
// БЕЗ адреса шлюза — частая ошибка: провайдер даёт креды и шлюз отдельно) молча трактовалась
// как host:port → Chromium получал несуществующий хост и «порт»-строку → ERR_PROXY_CONNECTION_FAILED
// («прокси моргнул»), хотя прокси живой и дело в формате строки (живой кейс 2026-07-16).
function validHostPort(hp) {
  if (!hp || !hp.includes(':')) return false
  const i = hp.lastIndexOf(':')
  const host = hp.slice(0, i)
  const port = hp.slice(i + 1)
  if (!host) return false
  return /^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535
}

export function splitProxy(raw) {
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
    const isPort = (x) => /^\d{1,5}$/.test(x) && Number(x) >= 1 && Number(x) <= 65535
    // Два ходовых формата БЕЗ '@' различаем по тому, ГДЕ стоит числовой порт:
    //  • «host:port:user:pass»  — порт ВТОРОЙ (классика продавцов).
    //  • «user:pass:host:port»  — порт ПОСЛЕДНИЙ (так отдаёт, напр., rp.proxxxymiron.cc:
    //    socks5://логин:пароль:host:port). Раньше этот формат молча читался как host:port → логин
    //    принимался за хост → ERR_PROXY_CONNECTION_FAILED на живом прокси (кейс 2026-07-16).
    // Пароль может содержать ':' (резиденты зашивают session/lifetime) → склеиваем середину.
    if (parts.length >= 4 && isPort(parts[1])) {
      hostPort = `${parts[0]}:${parts[1]}`          // host:port:user:pass…
      username = parts[2]
      password = parts.slice(3).join(':')
    } else if (parts.length >= 4 && isPort(parts[parts.length - 1])) {
      hostPort = `${parts[parts.length - 2]}:${parts[parts.length - 1]}`   // …user:pass:host:port
      username = parts[0]
      password = parts.slice(1, parts.length - 2).join(':')
    } else {
      hostPort = s   // host:port без кредов
    }
  }
  if (!validHostPort(hostPort)) return null
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
async function probeSchemesOnce(browser, p) {
  // Схемы пробуем ПАРАЛЛЕЛЬНО — первая рабочая выигрывает. Мёртвый прокси выявляется
  // за ~8с (один таймаут), а не за ~24с последовательного перебора.
  const probes = ['http', 'socks5', 'socks4'].map((scheme) =>
    schemeWorks(browser, scheme, p).then((ok) => {
      if (ok) return scheme
      throw new Error('scheme-fail')
    }),
  )
  try { return await Promise.any(probes) } catch { return null }
}

export async function resolveProxy(getBrowser, raw) {
  const p = splitProxy(raw)
  if (!p) {
    // Прокси НЕ задан вообще — законно (работа без прокси регулируется настройкой allowNoProxy).
    if (!raw || !String(raw).trim()) return null
    // Прокси ЗАДАН, но строка не разобралась. НЕЛЬЗЯ молча вернуть null: выше (newAccountContext)
    // это значит «контекст без прокси» → браузер пойдёт НАПРЯМУЮ с датацентр-IP сервера, Instagram
    // увидит серверный IP = прямой риск бана, и всё это молча. Падаем с понятной причиной.
    throw new Error(
      'proxy_bad_format: строка прокси не распознана. Нужен формат «host:port:логин:пароль» ' +
      '(или «логин:пароль@host:port», или «socks5://host:port»). Похоже, указаны только логин и пароль ' +
      'БЕЗ адреса шлюза — возьмите host и port резидентного прокси в личном кабинете провайдера ' +
      'и поставьте их ПЕРЕД логином. Порт обязан быть числом.',
    )
  }
  if (p.scheme) return toPlaywrightProxy(p.scheme, p)

  const cached = _schemeCache.get(p.hostPort)
  if (cached) return toPlaywrightProxy(cached, p)

  const browser = await getBrowser()
  // Живой прокси (особенно резидентный/мобильный/ротирующий) иногда не успевает за один
  // 8-секундный проброс — это НЕ смерть прокси, а разовое моргание (холодный тоннель у
  // ротирующего пула, задержка апстрима и т.п.). Раньше единственный неудачный проброс сразу
  // давал proxy_dead на живом прокси (жалоба пользователя: «проверил кучу — все живые»,
  // хотя вход тем же прокси падает). Теперь — до 2 попыток с короткой паузой между ними,
  // прежде чем честно признать прокси мёртвым; на реально дохлом это добавляет лишние ~10с,
  // на живом, но подтормаживающем — спасает от ложного отказа.
  let winner = await probeSchemesOnce(browser, p)
  if (!winner) {
    await new Promise((r) => setTimeout(r, 2500))
    winner = await probeSchemesOnce(browser, p)
  }
  if (winner) {
    _schemeCache.set(p.hostPort, winner)
    return toPlaywrightProxy(winner, p)
  }
  // Ни одна схема не дошла до Instagram за 2 попытки → прокси мёртв/битый (или неверные креды/тип).
  // Быстрый ЯВНЫЙ отказ вместо доомной навигации на 40+ секунд.
  throw new Error(
    'proxy_dead: прокси не отвечает ни по одной схеме (http/socks5/socks4) за 2 попытки. ' +
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

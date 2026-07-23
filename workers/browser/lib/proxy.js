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
    const left = s.slice(0, at), right = s.slice(at + 1)
    // Обе ориентации '@': «user:pass@host:port» (обычная) И «host:port@user:pass» (инвертированная —
    // её предлагают некоторые провайдеры, напр. rp.proxxxymiron.cc в списке форматов). Определяем по
    // тому, с какой стороны стоит ВАЛИДНЫЙ host:port (порт — число), а не по позиции.
    let creds
    if (validHostPort(right)) { hostPort = right; creds = left }
    else if (validHostPort(left)) { hostPort = left; creds = right }
    else { hostPort = right; creds = left }   // ни одна сторона не похожа на host:port → отсеется ниже
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
// §0.1 PLAN.md: при прочих равных предпочесть HTTP CONNECT — ресёрч показывает, что HTTP-эджи
// провайдеров (обычно nginx/HAProxy) стабильнее на ПЕРВОМ коннекте, чем SOCKS5 (которому чаще
// достаётся «ленивый» модем/CGNAT пула — та же природа блипов, что чинит warmConnection).
const HTTP_HEAD_START_MS = 1200

async function probeSchemesOnce(browser, p) {
  // С логином/паролем socks5/socks4 пробовать БЕССМЫСЛЕННО: Chromium их с авторизацией не умеет
  // («Browser does not support socks5 proxy authentication») — проба всегда упадёт. Пробуем только
  // http (единственная схема, поддерживающая авторизацию в этом движке). Без кредов — весь набор.
  const schemes = (p.username || p.password) ? ['http'] : ['http', 'socks5', 'socks4']
  // Схемы пробуем ПАРАЛЛЕЛЬНО — первая рабочая выигрывает, мёртвый прокси выявляется за ~8с,
  // а не за ~24с последовательного перебора. НО чистая гонка (Promise.any) отдаёт схему тому,
  // кто первым ОТВЕТИЛ, а не приоритетную http — если socks5 того же хоста отвечает на пару
  // сотен мс быстрее, выигрывает он, хотя http надёжнее на холодном коннекте. Даём http
  // короткую фору: socks5/socks4 стартуют с задержкой, так что при равной/близкой скорости
  // побеждает http; если http реально не отвечает — socks-пробы всё равно идут почти сразу
  // следом (задержка мала относительно ~8с таймаута пробы).
  const probes = schemes.map((scheme) => {
    const delay = scheme === 'http' ? 0 : HTTP_HEAD_START_MS
    const run = delay
      ? new Promise((r) => setTimeout(r, delay)).then(() => schemeWorks(browser, scheme, p))
      : schemeWorks(browser, scheme, p)
    return run.then((ok) => {
      if (ok) return scheme
      throw new Error('scheme-fail')
    })
  })
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
  // ── SOCKS + авторизация: ограничение САМОГО Chromium, не наше ────────────────────────────
  // browser.newContext бросает «Browser does not support socks5 proxy authentication»: движок
  // умеет SOCKS5 БЕЗ логина/пароля ЛИБО HTTP(S) С логином/паролем, но не SOCKS+auth (живой кейс
  // 2026-07-16). Почти все резидентные провайдеры отдают ТОТ ЖЕ прокси и по HTTP — пробуем http
  // на том же host:port: заработало → молча используем (пользователю ничего менять не нужно).
  // Не заработало → честная ошибка с инструкцией, а не крипто-текст от Playwright.
  if (p.scheme && /^socks/i.test(p.scheme) && (p.username || p.password)) {
    const browser = await getBrowser()
    if (await schemeWorks(browser, 'http', p)) {
      _schemeCache.set(p.hostPort, 'http')
      return toPlaywrightProxy('http', p)
    }
    throw new Error(
      'proxy_socks_auth: Chromium не поддерживает SOCKS5/SOCKS4 с логином и паролем — это ограничение ' +
      'самого браузера (умеет либо SOCKS без авторизации, либо HTTP с авторизацией). Ваш прокси живой, ' +
      'но в таком виде браузер к нему подключиться не может. Что делать: возьмите у провайдера HTTP(S)-доступ ' +
      'к ЭТОМУ ЖЕ прокси (обычно тот же хост, другой порт) и вставьте строку БЕЗ «socks5://» — например ' +
      '«rp.proxxxymiron.cc:8000:логин:пароль». HTTP-прокси с логином/паролем работает штатно.',
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
      // PLAN-MASTER §7.1 D.4: таймзона КОНКРЕТНОГО IP (точнее общей таблицы «страна→tz» для
      // крупных многочасовых стран — США/Россия/Бразилия/Индонезия и т.п.).
      timezone: d?.location?.timezone || null,
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

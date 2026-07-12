// plan4 — СВОИ уведомления основного аккаунта. По требованию пользователя читаем их ТАК ЖЕ,
// как видит человек: ОТКРЫВАЕМ панель «Уведомления» в реальном браузере и читаем DOM (а не
// дёргаем приватный API — он для веб-сессии отдаёт 500/нестабилен). Приватный `news/inbox`
// остаётся молчаливым РЕЗЕРВОМ на случай, если панель не открылась.
//
// Классификация строки — по видимому тексту (мультиязычно) + структуре (кнопка «Подписаться» →
// follow; превью поста → like/comment). Актор (username) берём из ссылки на профиль (/username/) —
// это язык-независимо. При raw=true возвращаем сырой текст/строки панели — для сверки на живом.
import { jitter, preActionBrowse } from './human.js'
import { gotoResilient, hasSessionCookie } from './browser.js'
import { normalizeNews, classifyRow } from './newsparse.js'   // чистый разбор (юнит-тестится)

const IG_APP_ID = '936619743392459'

// Открыть панель уведомлений (клик по пункту навигации; accessible name мультиязычный).
async function openNotifications(page) {
  const NAME = /notification|сповіщенн|повідомленн|уведомлен|notificaci|notifikasi|bildirim|powiadomien|通知/i
  for (const role of ['link', 'button']) {
    try {
      const el = page.getByRole(role, { name: NAME }).first()
      if (await el.isVisible().catch(() => false)) { await el.click({ timeout: 4000 }).catch(() => {}); break }
    } catch { /* пробуем следующий role */ }
  }
  await jitter(2200, 3500)   // ждём подгрузку строк панели
}

// Прочитать строки панели из DOM. Возвращает {rows, sample}.
async function readNotificationsRows(page) {
  return page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
    const scope = document.querySelector('div[role="dialog"]') || document.body
    const anchors = Array.from(scope.querySelectorAll('a[href^="/"]'))
    const RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'direct', 'stories', 'about', ''])
    const rows = []
    const seen = new Set()
    for (const a of anchors) {
      const href = a.getAttribute('href') || ''
      const m = href.match(/^\/([A-Za-z0-9._]+)\/$/)
      if (!m || RESERVED.has(m[1])) continue
      const username = m[1]
      // строка = ближайший предок, где появляется осмысленный текст (не только username)
      let row = a
      for (let i = 0; i < 7 && row.parentElement; i++) { row = row.parentElement; if (clean(row.innerText).length > username.length + 4) break }
      const rowText = clean(row.innerText)
      const key = username + '|' + rowText.slice(0, 50)
      if (seen.has(key)) continue
      seen.add(key)
      const postLink = row.querySelector('a[href*="/p/"], a[href*="/reel/"]')
      rows.push({ username, rowText: rowText.slice(0, 220), postHref: postLink ? postLink.getAttribute('href') : null, hasButton: Boolean(row.querySelector('button')) })
      if (rows.length >= 40) break
    }
    const dlg = document.querySelector('div[role="dialog"]')
    return { rows, sample: clean(dlg ? dlg.innerText : document.body.innerText).slice(0, 1800) }
  })
}

// Захваченные заголовки запроса санитизируем перед реплеем: убираем те, что подставляет сам
// транспорт (host/cookie/длина/кодировка) — cookie придут из context.request автоматически.
function sanitizeHeaders(h) {
  const DROP = new Set(['host', 'content-length', 'cookie', 'accept-encoding', 'connection', ':authority', ':method', ':path', ':scheme'])
  const out = {}
  for (const [k, v] of Object.entries(h || {})) { if (!DROP.has(k.toLowerCase())) out[k] = v }
  return out
}

// НЕЗАВИСИМЫЙ РЕЗЕРВ через `context.request` (делит cookies с контекстом, но БЕЗ ограничений
// браузерного fetch на заголовки — можно выставить любой x-*). Приоритет — РЕПЛЕЙ РЕАЛЬНОГО
// запроса самого сайта (точные URL+заголовки, захваченные при открытии колокольчика) → это тот
// самый рабочий вызов, что не отдаёт 500. Если его не захватили — сконструированный запрос с
// полным набором заголовков веб-клиента. Оба с ретраем транзиентных кодов. Крайний резерв.
async function readViaApi(context, capturedReq) {
  const TRANSIENT = [429, 500, 502, 503, 504]
  let csrf = ''
  try { const ck = await context.cookies('https://www.instagram.com'); csrf = (ck.find((c) => c.name === 'csrftoken') || {}).value || '' } catch { /* csrf опционален */ }

  const attempts = []
  if (capturedReq?.url) attempts.push({ url: capturedReq.url, headers: sanitizeHeaders(capturedReq.headers) })  // реплей рабочего запроса сайта
  attempts.push({                                                                                               // сконструированный запрос
    url: 'https://www.instagram.com/api/v1/news/inbox/',
    headers: { 'x-ig-app-id': IG_APP_ID, 'x-asbd-id': '129477', 'x-requested-with': 'XMLHttpRequest', 'x-csrftoken': csrf, accept: '*/*' },
  })

  let lastErr = 'no_attempt'
  for (const at of attempts) {
    for (let i = 0; i < 3; i++) {
      try {
        const resp = await context.request.get(at.url, { headers: at.headers, timeout: 15000 })
        const st = resp.status()
        if (resp.ok()) {
          const j = await resp.json().catch(() => null)
          if (j && (Array.isArray(j.new_stories) || Array.isArray(j.old_stories))) return { events: normalizeNews(j) }
          lastErr = 'news_bad_json'
        } else {
          lastErr = `news_inbox_http_${st}`
          if (!TRANSIENT.includes(st)) break   // осмысленный 4xx (401/403/404) — реплей/креды не помогут, к следующей попытке
        }
      } catch (e) { lastErr = `news_err: ${String(e?.message ?? e).slice(0, 80)}` }
      if (i < 2) await new Promise((r) => setTimeout(r, 1000 + i * 1500))
    }
  }
  return { events: [], apiError: lastErr }
}

/**
 * Читает свои уведомления ГИБРИДНО (лучшее из «API» и «меню», по разбору с пользователем):
 *  1) Открываем колокольчик в браузере (ОРГАНИЧНЫЙ человеческий флоу — клиент сам грузит
 *     уведомления со всей телеметрией) и ПЕРЕХВАТЫВАЕМ сетевой JSON ответа приложения
 *     (page.on('response') по news/inbox) — это РАБОЧИЙ запрос самого сайта (без нашего 500)
 *     и структурный, язык-независимый (normalizeNews). ← основной путь.
 *  2) Если перехват не сработал — читаем DOM-панель (classifyRow, язык-зависимо) — резерв.
 *  3) Если и это пусто — прямой fetch с полными заголовками — крайний резерв.
 * Возвращает: events[], browserState; при raw=true — {source, intercepted, rows, sample, apiError}.
 */
export async function readSelfEvents(context, { amount = 30, raw = false } = {}) {
  const ok = await hasSessionCookie(context)
  if (!ok) return { events: [], error: 'login_required: сессия недействительна — нужен повторный вход' }
  const page = await context.newPage()

  // Перехват ответа приложения на уведомления (клиент дёрнет свой рабочий эндпоинт при
  // открытии колокольчика). Матчим и по URL (news/inbox), и по ФОРМЕ тела (new/old_stories).
  let captured = null
  const onResp = async (resp) => {
    if (captured) return
    try {
      const u = resp.url()
      if (!/news\/inbox|\/api\/v1\/news|graphql/i.test(u)) return
      const j = await resp.json().catch(() => null)
      if (j && (Array.isArray(j.new_stories) || Array.isArray(j.old_stories))) captured = j
    } catch { /* не тот ответ */ }
  }
  page.on('response', onResp)

  // Перехват ЗАПРОСА уведомлений (url + заголовки) — чтобы РЕЗЕРВ мог РЕПЛЕИТЬ рабочий вызов
  // самого сайта (тот, что не отдаёт 500), а не конструировать голый запрос. Берём первый GET
  // к news/inbox — заголовки клиента снимаем ровно те, что реально ушли.
  let capturedReq = null
  const onReq = (req) => {
    if (capturedReq) return
    try { const u = req.url(); if (/news\/inbox|\/api\/v1\/news/i.test(u) && req.method() === 'GET') capturedReq = { url: u, headers: req.headers() } } catch { /* не тот запрос */ }
  }
  page.on('request', onReq)

  try {
    await gotoResilient(page, 'https://www.instagram.com/', { timeout: 30000, retries: 1, backoffMs: [2000] })
    await jitter(1200, 2400)

    // ПРОГРЕВ перед просмотром уведомлений (по запросу пользователя): человек сперва листает
    // ленту, а потом открывает колокольчик — не «login → сразу news/inbox» (портрет бота).
    // Лёгкий браузинг (пара скроллов, движения мыши); лайки НЕ делаем (нет доступа к лимитам).
    // Сбой прогрева не критичен: колокольчик всё равно откроем.
    try { await preActionBrowse(page) } catch { /* прогрев не должен ронять чтение */ }

    let events = []
    let source = ''
    let rowsDump = null
    let sample = ''
    let apiError

    // 1) Органично открываем колокольчик → ждём перехвата JSON (до ~7с) + попутно снимаем DOM.
    try {
      await openNotifications(page)
      for (let i = 0; i < 14 && !captured; i++) await page.waitForTimeout(500)
      const r = await readNotificationsRows(page).catch(() => null)
      if (r) { rowsDump = r.rows; sample = r.sample }
    } catch (e) {
      apiError = `open_failed: ${String(e?.message ?? e).slice(0, 100)}`
    }

    if (captured) { events = normalizeNews(captured).slice(0, amount); source = 'intercept' }
    // 2) DOM-панель (резерв, если перехват пуст).
    if (!events.length && rowsDump) { const ev = rowsDump.map(classifyRow).filter(Boolean); if (ev.length) { events = ev.slice(0, amount); source = 'dom' } }
    // 3) НЕЗАВИСИМЫЙ запрос к API — реплей рабочего запроса сайта (или сконструированный) через
    //    context.request (крайний резерв). Теперь это настоящий рабочий фолбэк, а не голый fetch→500.
    if (!events.length) {
      const api = await readViaApi(context, capturedReq).catch(() => ({ events: [], apiError: 'api_exception' }))
      if (api.events.length) { events = api.events.slice(0, amount); source = 'api' }
      if (api.apiError) apiError = apiError ? `${apiError}; ${api.apiError}` : api.apiError
    }

    const out = { events, storageState: await context.storageState() }
    if (!events.length && apiError) out.error = apiError
    if (raw) out.raw = { source, capturedReq: capturedReq ? { url: capturedReq.url } : null, intercepted: captured ? { topKeys: Object.keys(captured), new: (captured.new_stories || []).length, old: (captured.old_stories || []).length } : null, rows: rowsDump, sample, apiError }
    return out
  } catch (e) {
    return { events: [], error: String(e?.message ?? e).slice(0, 200) }
  } finally {
    page.off('response', onResp)
    page.off('request', onReq)
    await page.close().catch(() => {})
  }
}

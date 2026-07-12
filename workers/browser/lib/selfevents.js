// plan4 — СВОИ уведомления основного аккаунта. По требованию пользователя читаем их ТАК ЖЕ,
// как видит человек: ОТКРЫВАЕМ панель «Уведомления» в реальном браузере и читаем DOM (а не
// дёргаем приватный API — он для веб-сессии отдаёт 500/нестабилен). Приватный `news/inbox`
// остаётся молчаливым РЕЗЕРВОМ на случай, если панель не открылась.
//
// Классификация строки — по видимому тексту (мультиязычно) + структуре (кнопка «Подписаться» →
// follow; превью поста → like/comment). Актор (username) берём из ссылки на профиль (/username/) —
// это язык-независимо. При raw=true возвращаем сырой текст/строки панели — для сверки на живом.
import { jitter } from './human.js'
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

// Резерв: прямой fetch news/inbox изнутри страницы с ПОЛНЫМ набором заголовков веб-клиента
// (x-ig-app-id + x-asbd-id + x-csrftoken из cookie + x-requested-with) — так запрос выглядит
// как обычная работа сайта, а не голый вызов. Ретрай транзиентных кодов. Крайний резерв.
async function readViaApi(page) {
  const json = await page.evaluate(async ({ appId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const TRANSIENT = [429, 500, 502, 503, 504]
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
    const headers = { 'x-ig-app-id': appId, 'x-asbd-id': '129477', 'x-requested-with': 'XMLHttpRequest', 'x-csrftoken': csrf }
    let last = { __err: 'no_attempt' }
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch('/api/v1/news/inbox/', { headers, credentials: 'include' })
        if (r.ok) return await r.json()
        last = { __status: r.status }
        if (!TRANSIENT.includes(r.status)) return last
      } catch (e) { last = { __err: String((e && e.message) || e) } }
      if (i < 2) await sleep(1000 + i * 1500)
    }
    return last
  }, { appId: IG_APP_ID })
  if (json?.__status) return { events: [], apiError: `news_inbox_http_${json.__status}` }
  if (json?.__err) return { events: [], apiError: `news_inbox_err: ${json.__err}` }
  return { events: normalizeNews(json) }
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

  try {
    await gotoResilient(page, 'https://www.instagram.com/', { timeout: 30000, retries: 1, backoffMs: [2000] })
    await jitter(1200, 2400)

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
    // 3) Прямой fetch с полными заголовками (крайний резерв).
    if (!events.length) {
      const api = await readViaApi(page).catch(() => ({ events: [], apiError: 'api_exception' }))
      if (api.events.length) { events = api.events.slice(0, amount); source = 'api' }
      if (api.apiError) apiError = apiError ? `${apiError}; ${api.apiError}` : api.apiError
    }

    const out = { events, storageState: await context.storageState() }
    if (!events.length && apiError) out.error = apiError
    if (raw) out.raw = { source, intercepted: captured ? { topKeys: Object.keys(captured), new: (captured.new_stories || []).length, old: (captured.old_stories || []).length } : null, rows: rowsDump, sample, apiError }
    return out
  } catch (e) {
    return { events: [], error: String(e?.message ?? e).slice(0, 200) }
  } finally {
    page.off('response', onResp)
    await page.close().catch(() => {})
  }
}

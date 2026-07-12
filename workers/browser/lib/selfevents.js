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

// Резерв: приватный API (если DOM-панель не открылась). Ретрай транзиентных кодов.
async function readViaApi(page) {
  const json = await page.evaluate(async ({ appId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const TRANSIENT = [429, 500, 502, 503, 504]
    let last = { __err: 'no_attempt' }
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch('/api/v1/news/inbox/', { headers: { 'x-ig-app-id': appId }, credentials: 'include' })
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
 * Читает свои уведомления: сначала DOM-панель (как человек), при неудаче — приватный API-резерв.
 *  - events: [{type,pk,username,text,media_id,ts,code}]
 *  - raw (если raw=true): {source, rows, sample, apiError?} — для сверки на живом.
 */
export async function readSelfEvents(context, { amount = 30, raw = false } = {}) {
  const ok = await hasSessionCookie(context)
  if (!ok) return { events: [], error: 'login_required: сессия недействительна — нужен повторный вход' }
  const page = await context.newPage()
  try {
    await gotoResilient(page, 'https://www.instagram.com/', { timeout: 30000, retries: 1, backoffMs: [2000] })
    await jitter(1200, 2400)

    // 1) DOM: открываем панель уведомлений и читаем то, что видит человек.
    let events = []
    let source = 'dom'
    let rowsDump = null
    let sample = ''
    let apiError
    try {
      await openNotifications(page)
      const { rows, sample: s } = await readNotificationsRows(page)
      rowsDump = rows
      sample = s
      events = rows.map(classifyRow).filter(Boolean).slice(0, amount)
    } catch (e) {
      apiError = `dom_read_failed: ${String(e?.message ?? e).slice(0, 120)}`
    }

    // 2) Если DOM ничего не дал — молчаливый резерв через приватный API.
    if (!events.length) {
      const api = await readViaApi(page).catch(() => ({ events: [], apiError: 'api_exception' }))
      if (api.events.length) { events = api.events.slice(0, amount); source = 'api' }
      if (api.apiError) apiError = apiError ? `${apiError}; ${api.apiError}` : api.apiError
    }

    const out = { events, storageState: await context.storageState() }
    if (!events.length && apiError) out.error = apiError
    if (raw) out.raw = { source, rows: rowsDump, sample, apiError }
    return out
  } catch (e) {
    return { events: [], error: String(e?.message ?? e).slice(0, 200) }
  } finally {
    await page.close().catch(() => {})
  }
}

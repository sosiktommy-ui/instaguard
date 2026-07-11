// plan4 — СВОИ уведомления основного аккаунта (лента активности) через приватный web-API
// `/api/v1/news/inbox/`, вызываемый ИЗНУТРИ залогиненной страницы (fetch наследует cookies +
// x-ig-app-id) — тот же приём, что readStoryEvents/parse.js. Отдаёт события: новые подписчики,
// лайки/комментарии твоих постов, упоминания. НАДЁЖНЕЕ DOM-скрейпа панели «Сповіщення»
// (локализована и виртуализована): здесь структурные коды типов + user-объекты, не текст.
//
// ⚠️ Формат news/inbox не документирован официально и варьируется. Поэтому:
//   • normalize — BEST-EFFORT (тип события определяем по структуре, уточняется на живом);
//   • при raw=true возвращаем СЫРОЙ payload (первые N историй) — по нему финализируем нормализатор
//     (Фаза B плана). Любой сбой → {events:[], error} — НИКОГДА не роняем цикл поллинга.
import { jitter } from './human.js'
import { gotoResilient, hasSessionCookie } from './browser.js'

const IG_APP_ID = '936619743392459'

function pickUser(a) {
  // Актор события: разные поля в разных типах историй.
  const inline = a?.inline_follow?.user_info
  const pk = String(a?.profile_id ?? inline?.pk ?? a?.user_id ?? '')
  const username = a?.profile_name ?? inline?.username ?? a?.username ?? ''
  return { pk, username }
}

// BEST-EFFORT классификация одной «истории» ленты в наше событие.
function classify(st) {
  const a = st?.args ?? {}
  const { pk, username } = pickUser(a)
  const text = String(a.text ?? '')
  const media = Array.isArray(a.media) && a.media[0] ? a.media[0] : null
  // media.id обычно "<mediaPk>_<ownerPk>" — берём левую часть.
  const media_id = media ? String(media.id ?? '').split('_')[0] : undefined
  const ts = a.timestamp != null ? Math.round(Number(a.timestamp)) : null
  const code = st?.story_type ?? st?.type ?? null

  // Определяем тип. inline_follow → подписка. media без явного «коммент»-признака → лайк;
  // с признаком коммента (в тексте/полях) → коммент. Всё это уточним по реальному payload.
  let type = 'unknown'
  if (a.inline_follow || /\bfollow|стеж|подпис|подпіс|siguió|empezó a seguirte|mengikuti/i.test(text)) {
    type = 'follow'
  } else if (media_id || media) {
    const looksComment = /comment|коммент|коментар|comentó|prokoment|ответ/i.test(text) || a.comment_id != null
    type = looksComment ? 'comment' : 'like'
  }
  return { type, pk, username, text, media_id, ts, code }
}

function normalizeNews(json) {
  const stories = [
    ...(Array.isArray(json?.new_stories) ? json.new_stories : []),
    ...(Array.isArray(json?.old_stories) ? json.old_stories : []),
  ]
  const events = []
  for (const st of stories) {
    try {
      const e = classify(st)
      if (e.username || e.pk) events.push(e)
    } catch { /* пропускаем битую историю */ }
  }
  return events
}

/**
 * Читает свою ленту уведомлений. { amount, raw }.
 *  - events: нормализованный список [{type,pk,username,text,media_id,ts,code}].
 *  - raw (только если raw=true): сырые первые `amount` историй + ключи ответа (для Фазы B).
 *  - browserState: сессия дозрела (возвращаем, как везде).
 */
export async function readSelfEvents(context, { amount = 30, raw = false } = {}) {
  const ok = await hasSessionCookie(context)
  if (!ok) return { events: [], error: 'login_required: сессия недействительна — нужен повторный вход' }
  const page = await context.newPage()
  try {
    await gotoResilient(page, 'https://www.instagram.com/', { timeout: 30000, retries: 1, backoffMs: [2000] })
    await jitter(1000, 2200)
    const json = await page.evaluate(async ({ appId }) => {
      try {
        const r = await fetch('/api/v1/news/inbox/', { headers: { 'x-ig-app-id': appId }, credentials: 'include' })
        if (!r.ok) return { __status: r.status }
        return await r.json()
      } catch (e) { return { __err: String((e && e.message) || e) } }
    }, { appId: IG_APP_ID })

    if (json?.__status) return { events: [], error: `news_inbox_http_${json.__status}` }
    if (json?.__err) return { events: [], error: `news_inbox_err: ${json.__err}` }

    const events = normalizeNews(json)
    const out = { events, storageState: await context.storageState() }
    if (raw) {
      // Урезаем: ключи верхнего уровня + первые истории (для снятия формата, без гигантских payload).
      const trim = (arr) => (Array.isArray(arr) ? arr.slice(0, amount) : arr)
      out.raw = {
        topKeys: Object.keys(json ?? {}),
        counts: json?.counts ?? null,
        new_stories: trim(json?.new_stories),
        old_stories: trim(json?.old_stories),
      }
    }
    return out
  } catch (e) {
    return { events: [], error: String(e?.message ?? e).slice(0, 200) }
  } finally {
    await page.close().catch(() => {})
  }
}

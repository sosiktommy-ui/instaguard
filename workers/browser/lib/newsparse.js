// plan4 — ЧИСТЫЙ разбор ленты уведомлений Instagram (`/api/v1/news/inbox/`) в наши события.
// Вынесено из selfevents.js БЕЗ зависимостей (нет Playwright) — чтобы юнит-тестить `node --test`.
//
// Событие: { type:'follow'|'like'|'comment'|'unknown', pk, username, text, media_id, ts, code }.
// ⚠️ Коды типов (story_type) не документированы и варьируются — классифицируем по СТРУКТУРЕ
// (inline_follow → подписка; media без коммент-признака → лайк; с признаком → коммент) + тексту.
// Структурная раскладка (pk/username/media_id из args) — надёжна; точные story_type-коды
// доуточняются по реальному payload (Фаза B) и подставляются в FOLLOW_CODES/LIKE_CODES/…

// Известные story_type-коды (расширяются после снятия формата на живом). Пусто = опираемся
// только на структуру/текст. Заполняется из живых данных без изменения логики.
export const NEWS_TYPE_CODES = { follow: new Set(), like: new Set(), comment: new Set() }

// Актор события: поля различаются по типу истории.
export function pickUser(a) {
  const inline = a && a.inline_follow && a.inline_follow.user_info
  const pk = String((a && a.profile_id) ?? (inline && inline.pk) ?? (a && a.user_id) ?? '')
  const username = (a && a.profile_name) ?? (inline && inline.username) ?? (a && a.username) ?? ''
  return { pk, username }
}

const FOLLOW_TEXT = /\bfollow|стеж|подпис|подпіс|siguió|empezó a seguirte|mengikuti|started following/i
const COMMENT_TEXT = /comment|коммент|коментар|comentó|comment[oó]|prokoment|ответил|ответ на|replied/i

export function classify(st) {
  const a = (st && st.args) || {}
  const { pk, username } = pickUser(a)
  const text = String(a.text ?? '')
  const media = Array.isArray(a.media) && a.media[0] ? a.media[0] : null
  const media_id = media ? String(media.id ?? '').split('_')[0] : undefined
  const ts = a.timestamp != null ? Math.round(Number(a.timestamp)) : null
  const code = (st && (st.story_type ?? st.type)) ?? null

  let type = 'unknown'
  if (code != null && NEWS_TYPE_CODES.follow.has(code)) type = 'follow'
  else if (code != null && NEWS_TYPE_CODES.comment.has(code)) type = 'comment'
  else if (code != null && NEWS_TYPE_CODES.like.has(code)) type = 'like'
  else if (a.inline_follow || FOLLOW_TEXT.test(text)) type = 'follow'
  else if (media_id || media) type = (COMMENT_TEXT.test(text) || a.comment_id != null) ? 'comment' : 'like'

  return { type, pk, username, text, media_id, ts, code }
}

export function normalizeNews(json) {
  const stories = [
    ...(Array.isArray(json && json.new_stories) ? json.new_stories : []),
    ...(Array.isArray(json && json.old_stories) ? json.old_stories : []),
  ]
  const events = []
  for (const st of stories) {
    try {
      const e = classify(st)
      if (e.username || e.pk) events.push(e)
    } catch { /* пропускаем битую историю — не роняем разбор */ }
  }
  return events
}

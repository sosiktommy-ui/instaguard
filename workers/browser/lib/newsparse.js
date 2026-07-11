// plan4 — ЧИСТЫЙ разбор ленты уведомлений Instagram (`/api/v1/news/inbox/`) в наши события.
// Вынесено из selfevents.js БЕЗ зависимостей (нет Playwright) — чтобы юнит-тестить `node --test`.
//
// Событие: { type:'follow'|'like'|'comment'|'unknown', pk, username, text, media_id, ts, code }.
// ⚠️ Коды типов (story_type) не документированы и варьируются — классифицируем по СТРУКТУРЕ
// (inline_follow → подписка; media без коммент-признака → лайк; с признаком → коммент) + тексту.
// Структурная раскладка (pk/username/media_id из args) — надёжна; точные story_type-коды
// доуточняются по реальному payload (Фаза B) и подставляются в FOLLOW_CODES/LIKE_CODES/…

// Карта notif_name → наш тип. notif_name — СЕМАНТИЧЕСКАЯ строка Instagram (не локализована,
// не зависит от языка) → надёжнее story_type-кодов и текста. Подтверждено на живом (Фаза B):
//   user_followed (story_type 101) → follow;  comment_like (13) → ЛАЙК МОЕГО КОММЕНТА (НЕ триггер).
// like/comment на МОЙ пост в сэмпле не встретились — их notif_name добавлены по известным
// вариантам Instagram (доуточнить, когда придут на живом). 'ignore' → событие отбрасывается.
export const NEWS_NAME_MAP = {
  user_followed: 'follow',
  follow_request_received: 'follow',        // приватный основной: запрос на подписку
  // лайк МОЕГО поста (варианты имени у IG различаются) — доуточнить на живом:
  like: 'like', post_like: 'like', like_on_media: 'like', liked_media: 'like',
  // комментарий к МОЕМУ посту:
  comment: 'comment', comment_on_media: 'comment', comment_on_your_post: 'comment', commented_on_media: 'comment',
  reply_to_comment: 'comment',
  // НЕ наши триггеры (лайк моего коммента, лайк-агрегации активности и пр.) → отбросить:
  comment_like: 'ignore', like_on_comment: 'ignore',
}

// story_type-коды (подтверждённые на живом). notif_name главнее; коды — подстраховка.
export const NEWS_TYPE_CODES = { follow: new Set([101]), like: new Set(), comment: new Set(), ignore: new Set([13]) }

// Актор события: поля различаются по типу истории.
export function pickUser(a) {
  const inline = a && a.inline_follow && a.inline_follow.user_info
  const pk = String((a && a.profile_id) ?? (inline && inline.pk) ?? (a && a.user_id) ?? '')
  const username = (a && a.profile_name) ?? (inline && inline.username) ?? (a && a.username) ?? ''
  return { pk, username }
}

const FOLLOW_TEXT = /\bfollow|стеж|подпис|подпіс|siguió|empezó a seguirte|mengikuti|started following/i
const COMMENT_TEXT = /comment|коммент|коментар|comentó|comment[oó]|prokoment|ответил|ответ на|replied/i

// Классификация одной истории. Возвращает событие ИЛИ null (если это не наш триггер —
// напр. «лайкнули ваш комментарий» comment_like → отбрасываем).
export function classify(st) {
  const a = (st && st.args) || {}
  const { pk, username } = pickUser(a)
  const text = String(a.text ?? '')
  const media = Array.isArray(a.media) && a.media[0] ? a.media[0] : null
  const media_id = media ? String(media.id ?? '').split('_')[0] : undefined
  const ts = a.timestamp != null ? Math.round(Number(a.timestamp)) : null
  const name = st && st.notif_name
  const storyType = st && st.story_type
  const code = storyType ?? (st && st.type) ?? null

  // 1) notif_name — семантическая строка Instagram (не локализована) — ГЛАВНЫЙ сигнал.
  let mapped = name && NEWS_NAME_MAP[name] ? NEWS_NAME_MAP[name] : null
  // 2) story_type-код (подтверждён на живом) — подстраховка, если имя незнакомо.
  if (!mapped && storyType != null) {
    if (NEWS_TYPE_CODES.ignore.has(storyType)) mapped = 'ignore'
    else if (NEWS_TYPE_CODES.follow.has(storyType)) mapped = 'follow'
    else if (NEWS_TYPE_CODES.comment.has(storyType)) mapped = 'comment'
    else if (NEWS_TYPE_CODES.like.has(storyType)) mapped = 'like'
  }
  // 3) структурная эвристика (последний резерв — незнакомые имя И код).
  if (!mapped) {
    if (a.inline_follow || FOLLOW_TEXT.test(text)) mapped = 'follow'
    else if (media_id || media) mapped = (COMMENT_TEXT.test(text) || a.comment_id != null) ? 'comment' : 'like'
    else mapped = 'unknown'
  }
  if (mapped === 'ignore') return null   // не наш триггер (лайк моего коммента и т.п.)

  return { type: mapped, pk, username, text, media_id, ts, code }
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
      if (e && (e.username || e.pk)) events.push(e)
    } catch { /* пропускаем битую историю — не роняем разбор */ }
  }
  return events
}

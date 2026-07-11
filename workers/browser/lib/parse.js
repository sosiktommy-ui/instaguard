// Парсинг черновыми (HELPER) аккаунтами через ПРИВАТНЫЙ web-API Instagram, вызываемый
// ИЗНУТРИ залогиненной страницы чернового (fetch наследует cookies + x-ig-app-id) — так же,
// как readStoryEvents (actions.js). Это НАДЁЖНЕЕ DOM-скрейпа модалок (виртуализованных и
// часто меняющихся): один вызов web_profile_info даёт pk + число подписчиков + приватность +
// недавние медиа, а friendships/media-эндпоинты — сами списки.
//
// Формы ответов совпадают с HikerAPI (lib/scraper/hiker.ts), чтобы poll не переписывать.
// Доп. поля parseFollowers: followerCount (реальное число — для метрики в drafts-режиме) и
// restricted (аккаунт скрыл список от третьих сторон: verified/приватный → «парсинг невозможен»).
// Всё дефенсивно: любой сбой → пустой список + error, НИКОГДА не роняет цикл поллинга.
import { jitter } from './human.js'
import { gotoResilient } from './browser.js'

const IG_APP_ID = '936619743392459'

// Приватный web-API запрос изнутри залогиненной страницы (same-origin, cookies наследуются).
async function apiGet(page, path) {
  return page.evaluate(async ({ path, appId }) => {
    try {
      const r = await fetch(path, { headers: { 'x-ig-app-id': appId }, credentials: 'include' })
      if (!r.ok) return { __status: r.status }
      return await r.json()
    } catch (e) { return { __err: String((e && e.message) || e) } }
  }, { path, appId: IG_APP_ID })
}

// Открыть страницу на origin instagram.com (чтобы fetch унаследовал cookies), выполнить fn, закрыть.
async function withPage(context, fn) {
  const page = await context.newPage()
  try {
    await gotoResilient(page, 'https://www.instagram.com/', { timeout: 30000, retries: 1, backoffMs: [2000] })
    await jitter(1000, 2000)
    return await fn(page)
  } finally {
    await page.close().catch(() => {})
  }
}

// Профиль: pk, число подписчиков, приватность/верификация, недавние медиа (id+shortcode).
async function profileInfo(page, username) {
  const j = await apiGet(page, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`)
  const user = j && j.data && j.data.user
  if (!user) return { error: `profile_unavailable${j && j.__status ? ':' + j.__status : ''}` }
  const media = (((user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.edges) || [])
    .map((e) => e && e.node)
    .filter(Boolean)
    .map((n) => ({ id: String(n.id || '').split('_')[0], shortcode: n.shortcode })))
  return {
    pk: String(user.id),
    followerCount: user.edge_followed_by ? Number(user.edge_followed_by.count) : null,
    isPrivate: !!user.is_private,
    isVerified: !!user.is_verified,
    media,
  }
}

// ── Подписчики ───────────────────────────────────────────────────────────────
export async function parseFollowers(context, { targetUsername, limit = 50 }) {
  return withPage(context, async (page) => {
    const prof = await profileInfo(page, targetUsername)
    if (prof.error) return { followers: [], error: prof.error }
    const fl = await apiGet(page, `/api/v1/friendships/${prof.pk}/followers/?count=${Math.min(limit, 100)}`)
    if (fl && fl.__status) {
      // 400/403 на списке подписчиков при наличии подписчиков = аккаунт ограничил список
      // (проверенный/приватный — виден только владельцу). Это НЕ ошибка чернового.
      return { followers: [], followerCount: prof.followerCount, restricted: true, error: `followers_restricted:${fl.__status}` }
    }
    const users = ((fl && fl.users) || []).map((u) => ({ pk: String(u.pk), username: u.username, full_name: u.full_name || '' }))
    // Эвристика ограничения: подписчики ЕСТЬ, а список пуст (не приватный, где мы просто не подписаны).
    const restricted = users.length === 0 && (prof.followerCount || 0) > 0 && !prof.isPrivate
    return { followers: users, followerCount: prof.followerCount, isVerified: prof.isVerified, restricted }
  })
}

// ── Подписки (для гейта «взаимная подписка») ─────────────────────────────────
export async function parseFollowing(context, { targetUsername, limit = 200 }) {
  return withPage(context, async (page) => {
    const prof = await profileInfo(page, targetUsername)
    if (prof.error) return { following: [], error: prof.error }
    const fl = await apiGet(page, `/api/v1/friendships/${prof.pk}/following/?count=${Math.min(limit, 200)}`)
    if (fl && fl.__status) return { following: [], restricted: true, error: `following_restricted:${fl.__status}` }
    const users = ((fl && fl.users) || []).map((u) => ({ pk: String(u.pk), username: u.username }))
    return { following: users }
  })
}

// ── Комментарии под последними постами ───────────────────────────────────────
// media_id храним как SHORTCODE (poll строит postUrl через mediaPostUrl, который его понимает),
// а к API обращаемся по числовому media.id.
export async function parseComments(context, { targetUsername, mediaCount = 3, perMedia = 20 }) {
  return withPage(context, async (page) => {
    const prof = await profileInfo(page, targetUsername)
    if (prof.error) return { comments: [], error: prof.error }
    const self = targetUsername.toLowerCase()
    const out = []
    for (const m of prof.media.slice(0, mediaCount)) {
      if (!m.id) continue
      const j = await apiGet(page, `/api/v1/media/${m.id}/comments/?can_support_threading=true&permalink_enabled=false`)
      const comments = (j && j.comments) || []
      for (const c of comments.slice(0, perMedia)) {
        const u = c.user || {}
        if (!u.username || u.username.toLowerCase() === self) continue
        out.push({ pk: String(c.pk || c.id || ''), text: c.text || '', user_pk: String(u.pk || ''), username: u.username, media_id: m.shortcode || m.id })
      }
      await jitter(600, 1400)
    }
    return { comments: out }
  })
}

// ── Лайкнувшие последние посты ────────────────────────────────────────────────
export async function parseLikers(context, { targetUsername, mediaCount = 3, perMedia = 50 }) {
  return withPage(context, async (page) => {
    const prof = await profileInfo(page, targetUsername)
    if (prof.error) return { likers: [], error: prof.error }
    const self = targetUsername.toLowerCase()
    const out = []
    const seen = new Set()
    for (const m of prof.media.slice(0, mediaCount)) {
      if (!m.id) continue
      const j = await apiGet(page, `/api/v1/media/${m.id}/likers/`)
      const users = (j && j.users) || []
      for (const u of users.slice(0, perMedia)) {
        const uname = u.username
        if (!uname || seen.has(uname) || uname.toLowerCase() === self) continue
        seen.add(uname)
        out.push({ pk: String(u.pk), username: uname, media_id: m.shortcode || m.id })
      }
      await jitter(600, 1400)
    }
    return { likers: out }
  })
}

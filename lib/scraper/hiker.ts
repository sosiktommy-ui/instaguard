/**
 * Скрейпер-API (HikerAPI) — ЗАМЕНА черновых аккаунтов для парсинга.
 *
 * Раньше парсинг подписчиков/комментариев/лайкнувших делали черновые (HELPER) аккаунты
 * своей instagrapi-сессией через прокси — это требовало покупать аккаунты + прокси и несло
 * риск бана. Теперь ЧТЕНИЕ публичных данных основного аккаунта идёт через внешний API
 * (https://hikerapi.com) — без наших аккаунтов, без наших прокси, без риска бана.
 *
 * Возвращаемые формы 1:1 совпадают с функциями lib/instagram/client.ts (getFollowers/
 * getFollowing/getComments/getLikers), чтобы poll/route.ts не пришлось переписывать глубоко.
 *
 * Ключ — переменная окружения HIKER_API_KEY (Next.js-сервис). Авторизация — заголовок
 * x-access-key. Оплата у HikerAPI — предоплаченный баланс, ~$0.0006–0.02 за запрос.
 * Записи ошибок 50x не тарифицируются, 200/403/404 — тарифицируются.
 */

const BASE = process.env.HIKER_API_BASE?.replace(/\/$/, '') || 'https://api.hikerapi.com'
const KEY = process.env.HIKER_API_KEY ?? ''
const TIMEOUT_MS = Number(process.env.HIKER_TIMEOUT_MS) || 30_000

export function scraperConfigured(): boolean {
  return Boolean(KEY)
}

// ── Низкоуровневый запрос ────────────────────────────────────────────────────
async function req(path: string, params: Record<string, string | number | undefined>): Promise<any> {
  if (!KEY) throw new Error('HIKER_API_KEY не задан — парсинг через скрейпер-API невозможен')
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE}${path}?${qs.toString()}`, {
      headers: { 'x-access-key': KEY, accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HikerAPI ${res.status} (${path}): ${body.slice(0, 160)}`)
    }
    return await res.json()
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`HikerAPI таймаут ${Math.round(TIMEOUT_MS / 1000)}с (${path})`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// Разбор ответа: chunk-эндпоинты отдают кортеж [items, next_cursor]; часть эндпоинтов —
// {users|items|response:{...}} или просто список. Возвращаем нормализованный вид.
function unwrapChunk(data: any): { items: any[]; next: string | null } {
  if (Array.isArray(data)) {
    if (data.length === 2 && Array.isArray(data[0])) return { items: data[0], next: data[1] ?? null }
    return { items: data, next: null }
  }
  const items = data?.users ?? data?.items ?? data?.response?.users ?? data?.response?.items ?? []
  const next = data?.next_page_id ?? data?.next_max_id ?? data?.max_id ?? data?.end_cursor ?? null
  return { items: Array.isArray(items) ? items : [], next: next || null }
}

// Постранично собрать не более `amount` элементов из chunk-эндпоинта (ограничиваем число
// страниц — контроль стоимости: нам нужны только СВЕЖИЕ элементы, а не весь список).
async function paginate(
  path: string,
  baseParams: Record<string, string | number | undefined>,
  amount: number,
  maxPages = 4,
): Promise<any[]> {
  const out: any[] = []
  let cursor: string | null = null
  for (let i = 0; i < maxPages && out.length < amount; i++) {
    const data = await req(path, { ...baseParams, ...(cursor ? { max_id: cursor } : {}) })
    const { items, next } = unwrapChunk(data)
    out.push(...items)
    if (!next) break
    cursor = next
  }
  return out.slice(0, amount)
}

// ── Кеши на процесс (снижают число платных запросов в рамках одного цикла поллинга) ──
const _uidCache = new Map<string, string>()                        // username → user_id (pk)
const _mediaCache = new Map<string, { ids: string[]; ts: number }>() // username → recent media ids
const MEDIA_TTL = 5 * 60 * 1000

function pickUser(u: any): { pk: string; username: string; full_name?: string } | null {
  const src = u?.user ?? u ?? {}
  const pk = String(src.pk ?? src.id ?? src.user_id ?? '')
  const username = String(src.username ?? '')
  if (!pk || !username) return null
  return { pk, username, full_name: src.full_name ?? '' }
}

export async function scrapeUserId(username: string): Promise<string> {
  const key = username.toLowerCase()
  const cached = _uidCache.get(key)
  if (cached) return cached
  const data = await req('/v1/user/by/username', { username: key })
  const pk = String(data?.pk ?? data?.user?.pk ?? data?.id ?? data?.user?.id ?? '')
  if (!pk) throw new Error(`HikerAPI: не удалось получить user_id для @${username}`)
  _uidCache.set(key, pk)
  return pk
}

/**
 * Профиль аккаунта по username: pk + счётчики (подписчики/подписки/посты).
 * Тот же эндпоинт, что scrapeUserId (та же цена), но отдаёт и follower_count — используется
 * для реального числа подписчиков (метрика «Подписчики» + спарклайн прироста). Кеширует pk,
 * поэтому последующий scrapeFollowers/… в том же цикле не делает повторный платный запрос.
 */
export async function scrapeUserInfo(username: string): Promise<{
  pk: string; username: string; full_name: string
  follower_count: number; following_count: number; media_count: number
}> {
  const key = username.toLowerCase()
  const data = await req('/v1/user/by/username', { username: key })
  const src = data?.user ?? data ?? {}
  const pk = String(src.pk ?? src.id ?? src.user_id ?? '')
  if (pk) _uidCache.set(key, pk)
  return {
    pk,
    username: String(src.username ?? username),
    full_name: String(src.full_name ?? ''),
    follower_count: Number(src.follower_count ?? 0) || 0,
    following_count: Number(src.following_count ?? 0) || 0,
    media_count: Number(src.media_count ?? 0) || 0,
  }
}

async function recentMediaIds(username: string, count: number): Promise<string[]> {
  const key = username.toLowerCase()
  const cached = _mediaCache.get(key)
  if (cached && Date.now() - cached.ts < MEDIA_TTL && cached.ids.length >= count) {
    return cached.ids.slice(0, count)
  }
  const uid = await scrapeUserId(username)
  const medias = await paginate('/v1/user/medias/chunk', { user_id: uid }, count)
  const ids = medias.map((m: any) => String(m?.id ?? m?.pk ?? '')).filter(Boolean)
  _mediaCache.set(key, { ids, ts: Date.now() })
  return ids.slice(0, count)
}

// ── Публичные функции (формы = lib/instagram/client.ts) ──────────────────────

/** Подписчики аккаунта (для триггера NEW_FOLLOWER и гейта «подписан на нас»). */
export async function scrapeFollowers(username: string, amount = 50): Promise<{ followers: { pk: string; username: string; full_name?: string }[] }> {
  const uid = await scrapeUserId(username)
  const raw = await paginate('/v1/user/followers/chunk', { user_id: uid }, amount)
  const followers = raw.map(pickUser).filter(Boolean) as { pk: string; username: string; full_name?: string }[]
  return { followers }
}

/** На кого подписан аккаунт (для гейта «взаимная подписка»). */
export async function scrapeFollowing(username: string, amount = 200): Promise<{ following: { pk: string; username: string }[] }> {
  const uid = await scrapeUserId(username)
  const raw = await paginate('/v1/user/following/chunk', { user_id: uid }, amount)
  const following = (raw.map(pickUser).filter(Boolean) as { pk: string; username: string }[])
  return { following }
}

/** Комментарии под последними постами аккаунта (триггер NEW_COMMENT). Свои — исключаем. */
export async function scrapeComments(
  username: string,
  mediaCount = 3,
  perMedia = 20,
): Promise<{ comments: { pk: string; text: string; user_pk: string; username: string; media_id: string }[] }> {
  const self = username.toLowerCase()
  const mediaIds = await recentMediaIds(username, mediaCount)
  const out: { pk: string; text: string; user_pk: string; username: string; media_id: string }[] = []
  for (const mid of mediaIds) {
    let raw: any[] = []
    try { raw = await paginate('/v1/media/comments/chunk', { id: mid }, perMedia) }
    catch { continue } // один пост не отдал комменты — не валим весь поток
    for (const c of raw) {
      const u = pickUser(c)
      const upk = u?.pk ?? String(c?.user_id ?? '')
      const uname = u?.username ?? ''
      if (!upk || !uname || uname.toLowerCase() === self) continue
      out.push({ pk: String(c?.pk ?? c?.id ?? ''), text: String(c?.text ?? ''), user_pk: upk, username: uname, media_id: mid })
    }
  }
  return { comments: out }
}

/** Лайкнувшие последние посты аккаунта (триггер NEW_LIKE). Свои и дубли — исключаем. */
export async function scrapeLikers(
  username: string,
  mediaCount = 3,
  perMedia = 50,
): Promise<{ likers: { pk: string; username: string; media_id: string }[] }> {
  const self = username.toLowerCase()
  const mediaIds = await recentMediaIds(username, mediaCount)
  const out: { pk: string; username: string; media_id: string }[] = []
  const seen = new Set<string>()
  for (const mid of mediaIds) {
    let items: any[] = []
    try { const data = await req('/v1/media/likers', { id: mid }); items = unwrapChunk(data).items }
    catch { continue }
    for (const u of items.slice(0, perMedia)) {
      const pu = pickUser(u)
      if (!pu || seen.has(pu.pk) || pu.username.toLowerCase() === self) continue
      seen.add(pu.pk)
      out.push({ pk: pu.pk, username: pu.username, media_id: mid })
    }
  }
  return { likers: out }
}

/** Живой тест ключа: дешёвый запрос, подтверждающий что API отвечает и ключ валиден. */
export async function scraperTest(): Promise<{ ok: boolean; userId?: string; error?: string }> {
  if (!KEY) return { ok: false, error: 'HIKER_API_KEY не задан' }
  try {
    const uid = await scrapeUserId('instagram')
    return { ok: true, userId: uid }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'ошибка запроса' }
  }
}

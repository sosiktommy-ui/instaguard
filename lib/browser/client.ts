// Обёртка над браузерным воркером (эмуль). Зеркалит формы ответов lib/instagram/client.ts,
// но сессия аккаунта = Playwright storageState (browserState), а не instagrapi-настройки.
// См. plan.md §4.4/§6.
// Канонично — BROWSER_WORKER_URL; принимаем и BROWSER_URL как частый вариант написания,
// чтобы опечатка в имени переменной не оставляла движок молча на legacy.
const BROWSER_WORKER_URL = process.env.BROWSER_WORKER_URL ?? process.env.BROWSER_URL ?? ''
const BROWSER_WORKER_SECRET = process.env.BROWSER_WORKER_SECRET ?? ''
// Браузер медленнее приватного API (вход 30–60с) — таймаут выше, чем у Python-воркера.
// 180с (не 120): при bot-стене воркер сначала перебирает селекторы/повторы и лишь потом
// отдаёт СКРИН — на 120с клиент рвал fetch до diag (аудит-баг #1). Бюджет воркера подрезан,
// но запас нужен на медленный прокси + первый scheme-детект.
const TIMEOUT_MS = Number(process.env.BROWSER_WORKER_TIMEOUT_MS) || 180_000
// Единая сессия на цикл: визит (/session/run) И первый вызов цикла (чтение уведомлений / авто-приём)
// включают прогрев ленты + человеческие паузы → на медленном резидентном прокси легко выходят за 180с.
// Даём им отдельный, БОЛЬШИЙ бюджет. Воркер сам ограничивает конкуренцию, так что это безопасно.
const VISIT_TIMEOUT_MS = Number(process.env.BROWSER_VISIT_TIMEOUT_MS) || 300_000

/** Задеплоен ли браузерный воркер (задан URL). Если нет — движок остаётся legacy. */
export function browserConfigured(): boolean {
  return Boolean(BROWSER_WORKER_URL)
}

async function browserFetch<T = any>(path: string, body: object, timeoutMs: number = TIMEOUT_MS): Promise<T> {
  if (!BROWSER_WORKER_URL) throw new Error('Браузерный воркер не настроен (нет BROWSER_WORKER_URL)')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${BROWSER_WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': BROWSER_WORKER_SECRET },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`Таймаут ${Math.round(timeoutMs / 1000)}с: браузерный воркер не ответил (${path})`)
    throw e
  } finally {
    clearTimeout(timer)
  }
  // ВАЖНО: тело ответа читаем РОВНО ОДИН раз (res.text()), затем парсим как JSON. Раньше в ветке
  // !res.ok делали res.json(), а при сбое — res.text() на УЖЕ прочитанном теле → «Body is unusable:
  // Body has already been read», что МАСКИРОВАЛО реальную ошибку воркера (и роняло, напр., self-events).
  const raw = await res.text().catch(() => '')
  if (!res.ok) {
    let msg = raw || `HTTP ${res.status}`
    let diag: any = undefined
    try { const d = JSON.parse(raw); msg = d.message ?? d.error ?? (raw || JSON.stringify(d)); diag = d.diag } catch { /* тело не JSON — оставляем как есть */ }
    const err = new Error(msg) as Error & { diag?: any; status?: number }
    if (diag) err.diag = diag   // скрин страницы при провале входа — прокидываем в вызывающий код (UI покажет)
    err.status = res.status     // статус — чтобы вызывающий отличил 404 (эндпоинта нет) от логической ошибки
    throw err
  }
  try { return JSON.parse(raw) as T }
  catch { throw new Error(`Некорректный ответ воркера (${path}): ${raw.slice(0, 120) || 'пустое тело'}`) }
}

// ── Вход ───────────────────────────────────────────────────────────────────
export interface BrowserLoginResult {
  ok?: boolean
  browserState?: object
  username?: string
  needsCheckpoint?: boolean
  needs2fa?: boolean
  channel?: 'email' | 'sms' | null
  diag?: { url?: string; title?: string; screenshot?: string | null }
}

/** locale/timezoneId — гео отпечатка по стране прокси (plan.md §349, lib/browser/geo.ts). Опционально: без них воркер берёт дефолт en-US/America/New_York. */
export function browserLogin(username: string, password: string, proxy?: string, totpSecret?: string, locale?: string, timezoneId?: string) {
  return browserFetch<BrowserLoginResult>('/login', { username, password, proxy, totpSecret, locale, timezoneId })
}

// manual=true пропускает авто-TOTP на воркере (даже если 2FA-ключ известен) и заставляет
// использовать РОВНО тот code, что передан — фолбэк для случая, когда авто-решение (resumeWithTotp)
// само не справилось (DOM/тайминг), а у пользователя есть свежий код (свой authenticator/подсчитанный).
export function submitBrowserCheckpoint(username: string, code: string, proxy?: string, manual?: boolean) {
  return browserFetch<{ ok: boolean; browserState: object; username: string }>('/login/checkpoint', { username, code, proxy, manual })
}

/** Повтор кода. Браузерный воркер сам определяет канал по странице — method принимается для сигнатурной совместимости. */
export function resendBrowserCode(username: string, _method: 'email' | 'sms' = 'email') {
  return browserFetch<{ ok: boolean }>('/login/resend', { username })
}

export function browserLoginByCookies(input: object | string, proxy?: string, locale?: string, timezoneId?: string) {
  const payload = typeof input === 'string' ? { cookies: input } : { storageState: input }
  return browserFetch<{ ok: boolean; browserState: object; username: string }>('/login/cookies', { ...payload, proxy, locale, timezoneId })
}

export async function browserTestSession(storageState: object, proxy?: string, username?: string, locale?: string, timezoneId?: string): Promise<boolean> {
  try {
    const d = await browserFetch<{ alive: boolean }>('/session/test', { storageState, proxy, username, locale, timezoneId })
    return d.alive
  } catch {
    return false
  }
}

// Прогрев + keep-alive: периодический живой заход, чтобы IG не «остужал» сессию и аккаунт
// грелся. Возвращает свежий browserState (сохранить в БД, сессия дозревает).
export function browserWarmup(storageState: object, proxy?: string, username?: string, locale?: string, timezoneId?: string) {
  return browserFetch<{ alive: boolean; browserState?: object; error?: string }>('/session/warmup', { storageState, proxy, username, locale, timezoneId })
}

// ВРЕМЕННО (удалить вместе с /api/accounts/[id]/reread-username и кнопкой в UI): перечитать
// username уже залогиненной сессии (без повторного входа) — починка накопившихся username=unknown.
export function browserRereadUsername(storageState: object, proxy?: string, username?: string, locale?: string, timezoneId?: string) {
  return browserFetch<{
    ok: boolean; username: string | null; browserState?: object; error?: string
    sessionAlive?: boolean; url?: string; diag?: { url?: string; title?: string; screenshot?: string | null }; dom?: unknown
    needsCaptcha?: boolean; captchaImage?: string | null
  }>('/session/username', { storageState, proxy, username, locale, timezoneId })
}

// ВРЕМЕННО (тот же жизненный цикл, что browserRereadUsername выше): человек ввёл текст/цифры
// с картинки капчи, которую IG показал во время перечитывания ника — довершает застрявшую сессию
// на живом контексте воркера (pendingCaptcha), заново читает ник.
export function browserSubmitCaptcha(username: string, code: string) {
  return browserFetch<{ ok: boolean; username: string; browserState: object }>('/session/captcha', { username, code })
}

// Здоровье воркера — ПЛОСКИЙ GET на /health (воркер отдаёт его без секрета). Раньше тут был
// browserFetch(POST) → но у воркера /health только GET → POST давал 404 → индикатор в шапке
// ВСЕГДА показывал «Воркер офлайн», хотя воркер жив. Свой лёгкий fetch, не через browserFetch.
export async function browserHealth() {
  const down = { ok: false, build: '', chromium: '', concurrency: 0, active: 0, pending: 0 }
  if (!BROWSER_WORKER_URL) return down
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(`${BROWSER_WORKER_URL}/health`, { method: 'GET', signal: ctrl.signal })
    if (!res.ok) return down
    return await res.json()
  } catch {
    return down
  } finally {
    clearTimeout(timer)
  }
}

// ── Антидетект self-test (§10.2/§11.2): «0 сигналов бота» через прокси ──────────
export interface SelfTestResult {
  ok: boolean
  build?: string
  redCount?: number
  red?: string[]
  warnings?: string[]
  exit?: { ip: string | null; country: string | null } | null
  webrtcLeaks?: string[]
  expected?: { platform?: string; uaPlatform?: string; timezoneId?: string; locale?: string; glRenderer?: string }
  signals?: Record<string, any>
  error?: string
}
export function browserSelfTest(proxy: string, username?: string, locale?: string, timezoneId?: string) {
  // Долгий тест (поднимает контекст + ходит на detector) — но воркер сам ограничивает; TIMEOUT_MS покрывает.
  return browserFetch<SelfTestResult>('/selftest/fingerprint', { proxy, username, locale, timezoneId })
}

// ── Прокси (заменяет мёртвый Python-воркер) ─────────────────────────────────────
export interface BrowserProxyCheck {
  ok: boolean
  ip?: string | null
  country?: string | null
  isp?: string | null
  scheme?: string | null
  datacenter?: boolean | null
  vpn?: boolean | null
  proxy?: boolean | null
  mobile?: boolean | null
  companyType?: string | null
  error?: string
}

/** Проверить один прокси браузерным воркером (исходящий IP/страна/провайдер + флаги). */
export function browserCheckProxy(proxy?: string) {
  return browserFetch<BrowserProxyCheck>('/check-proxy', { proxy })
}

export interface BrowserPickedProxy {
  chosen: string | null
  flagged: boolean
  checked: Array<{ url: string; ok: boolean; ip?: string; country?: string; datacenter?: boolean | null; vpn?: boolean | null }>
}

/** Подобрать рабочий прокси из списка (первый чистый, иначе первый рабочий). */
export function browserPickProxy(candidates: string[]) {
  return browserFetch<BrowserPickedProxy>('/pick-proxy', { candidates })
}

// ── Действия (Фаза 2). Каждое возвращает обновлённый browserState. ──────────────
export interface ActionResult { ok: boolean; browserState?: object; closed?: boolean; error?: string; [k: string]: any }

// locale/timezoneId — гео отпечатка (plan.md §349): вход и действия/парсинг одного аккаунта
// должны использовать ОДИН и тот же отпечаток, поэтому Ctx их несёт наравне с proxy/username.
type Ctx = { storageState: object; proxy?: string; username?: string; locale?: string; timezoneId?: string }

// image — data-URL (data:image/…;base64,…) из конструктора кампании; отправляется
// best-effort ОТДЕЛЬНЫМ сообщением ПОСЛЕ подтверждённого текста (§4.6/§4.3 [A3]).
// dryRun (§10.3) — доходить до кнопки действия БЕЗ финального клика (безопасный тест на живых аккаунтах).
export function browserDM(ctx: Ctx, toUsername: string, text: string, image?: string, dryRun?: boolean) {
  return browserFetch<ActionResult>('/dm', { ...ctx, toUsername, text, image, dryRun })
}
export function browserFollow(ctx: Ctx, targetUsername: string, dryRun?: boolean) {
  return browserFetch<ActionResult>('/follow', { ...ctx, targetUsername, dryRun })
}
export function browserLike(ctx: Ctx, targetUsername: string, count = 1, dryRun?: boolean) {
  return browserFetch<ActionResult>('/like', { ...ctx, targetUsername, count, dryRun })
}
export function browserStories(ctx: Ctx, targetUsername: string, like = false, count = 4, dryRun?: boolean) {
  return browserFetch<ActionResult>('/stories', { ...ctx, targetUsername, like, count, dryRun })
}
export function browserComment(ctx: Ctx, postUrl: string, text: string, dryRun?: boolean) {
  return browserFetch<ActionResult>('/comment', { ...ctx, postUrl, text, dryRun })
}
export function browserReply(ctx: Ctx, postUrl: string, text: string, dryRun?: boolean) {
  return browserFetch<ActionResult>('/reply-comment', { ...ctx, postUrl, text, dryRun })
}
// Канареечный тест: прокомментировать последний пост цели (канарейка → пост основного).
export function browserCommentLatest(ctx: Ctx, targetUsername: string, text: string, dryRun?: boolean) {
  return browserFetch<ActionResult>('/comment-latest', { ...ctx, targetUsername, text, dryRun })
}

// ── Сессия-визит (Фаза II §1.1): все задачи на цель в ОДНОМ контексте воркера. ──
export interface VisitTask { type: 'dm' | 'follow' | 'like' | 'story' | 'comment'; target: string; text?: string; image?: string; count?: number; storyLike?: boolean; postUrl?: string; fallbackFollow?: boolean; fallbackLike?: boolean }
// impossible — действия, НЕвыполнимые не по вине бота (0 постов для лайка / 0 активных сторис): §13.10.
export interface VisitResult { done: Record<string, number>; impossible?: string[]; closed?: boolean; errors?: string[]; brk?: 'CHALLENGE' | 'PAUSED'; browserState?: object }
export function browserRunVisit(ctx: Ctx, tasks: VisitTask[]) {
  return browserFetch<VisitResult>('/session/run', { ...ctx, tasks }, VISIT_TIMEOUT_MS)
}

// Стори-события основного (ответы на сторис + упоминания) — читает директ своим браузером.
// Форма совпадает с legacy getStoryEvents, чтобы poll/route.ts не переписывать.
export interface BrowserStoryEvent { pk: string; user_pk: string; username: string; text: string; kind: 'reply' | 'mention' }
export function browserStoryEvents(ctx: Ctx, amount = 10) {
  return browserFetch<{ events: BrowserStoryEvent[]; browserState?: object }>('/story-inbox', { ...ctx, amount }, VISIT_TIMEOUT_MS)
}

// plan4 — свои уведомления (лента активности) основного аккаунта: детект follow/like/comment.
// raw=true → сырой payload news/inbox (Фаза B: снять формат на живом).
export interface SelfEvent { type: 'follow' | 'like' | 'comment' | 'unknown'; pk: string; username: string; text?: string; media_id?: string; ts?: number | null; code?: number | string | null }
export function browserSelfEvents(ctx: Ctx, opts: { amount?: number; raw?: boolean } = {}) {
  // Первый вызов цикла: создаёт+греет контекст (прогрев ленты) → больший бюджет.
  return browserFetch<{ events: SelfEvent[]; raw?: any; error?: string; browserState?: object }>('/self-events', { ...ctx, amount: opts.amount, raw: opts.raw }, VISIT_TIMEOUT_MS)
}

// §13.11 — авто-приём заявок в подписчики (для приватных аккаунтов): подтвердить ожидающие
// follow-requests. Возвращает сколько было ожидающих и кого подтвердили (+ обновлённый browserState).
export interface AcceptRequestsResult { pendingCount: number; approved: { pk: string; username: string }[]; errors?: string[]; browserState?: object }
export function browserAcceptFollowRequests(ctx: Ctx, limit = 10) {
  // Может быть первым вызовом цикла (приватный аккаунт) → включает прогрев → больший бюджет.
  return browserFetch<AcceptRequestsResult>('/follow-requests/accept', { ...ctx, limit }, VISIT_TIMEOUT_MS)
}

// ── Парсинг черновыми (Фаза 3, plan.md §4.4/§5). Формы = lib/scraper/hiker.ts, чтобы
// poll/route.ts мог переключаться между API/черновыми без переписывания потребителей.
// ⚠️ ЭКСПЕРИМЕНТАЛЬНО — DOM-парсинг воркера не проверялся на живом Instagram, см.
// workers/browser/lib/parse.js.
export interface ParseFollowersResult {
  followers: { pk: string; username: string; full_name?: string }[]
  followerCount?: number | null   // реальное число подписчиков (для метрики в drafts-режиме)
  restricted?: boolean            // аккаунт скрыл список подписчиков от третьих сторон (verified/приватный)
  isVerified?: boolean
  error?: string
}
export function parseFollowersBrowser(ctx: Ctx, targetUsername: string, limit = 50) {
  return browserFetch<ParseFollowersResult>('/parse/followers', { ...ctx, targetUsername, limit })
}
export function parseFollowingBrowser(ctx: Ctx, targetUsername: string, limit = 200) {
  return browserFetch<{ following: { pk: string; username: string }[]; error?: string }>('/parse/following', { ...ctx, targetUsername, limit })
}
export function parseCommentsBrowser(ctx: Ctx, targetUsername: string, mediaCount = 3, perMedia = 20) {
  return browserFetch<{ comments: { pk: string; text: string; user_pk: string; username: string; media_id: string }[] }>('/parse/comments', { ...ctx, targetUsername, mediaCount, perMedia })
}
export function parseLikersBrowser(ctx: Ctx, targetUsername: string, mediaCount = 3, perMedia = 50) {
  return browserFetch<{ likers: { pk: string; username: string; media_id: string }[] }>('/parse/likers', { ...ctx, targetUsername, mediaCount, perMedia })
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  sendDM, sendDMPhoto, replyComment, likeComment,
  viewStories, followUser, likeLatestMedia, likeUserMedias,
  getStoryEvents,
} from '@/lib/instagram/client'
// Парсинг подписчиков/комментариев/лайкнувших/подписок — через скрейпер-API (замена черновых).
// Формы ответов 1:1 совпадают со старыми getFollowers/getComments/getLikers/getFollowing.
import { scrapeFollowers, scrapeFollowing, scrapeComments, scrapeLikers, scraperConfigured, scrapeUserInfo } from '@/lib/scraper/hiker'
import { resolveEngine } from '@/lib/browser/engine'
import { runFollowerActionsBrowser } from '@/lib/browser/actions'
import {
  browserComment, browserReply, browserFollow, browserLike, browserDM, browserStories,
  browserStoryEvents, browserWarmup,
  parseFollowersBrowser, parseCommentsBrowser, parseLikersBrowser,
} from '@/lib/browser/client'
import { pickDraft, markDraftUsed } from '@/lib/browser/draftPool'
import { mediaPostUrl } from '@/lib/instagram/shortcode'
import { Queue } from 'bullmq'
import { loadCounters, consume, warmupFactor, scaleCaps, MAX_NEW_PER_POLL, type Counters, type ActionKind } from '@/lib/limits'
import { getCurrentUser } from '@/lib/auth'
import { mergeStatsMap } from '@/lib/stats'

// Сколько последних постов автора комментария лайкать (действие «Лайк» в триггере «Комментарий»)
const COMMENT_LIKE_POSTS = 3
// Минимум 20 минут между автоматическими проверками одного аккаунта
const POLL_COOLDOWN_MS = 20 * 60 * 1000
// Комментарии проверяем реже — раз в 60 минут (они меняются медленнее)
const COMMENT_COOLDOWN_MS = 60 * 60 * 1000
// Лайки и стори-события — тоже реже подписчиков
const LIKE_COOLDOWN_MS = 30 * 60 * 1000
const STORY_COOLDOWN_MS = 60 * 60 * 1000
// Прогрев/keep-alive браузерной сессии: не чаще раза в ~3.5ч на аккаунт (живой заход,
// чтобы сессия не остывала и аккаунт грелся). Метка времени — в limits.lastWarmup.
const WARMUP_KEEPALIVE_MS = 3.5 * 60 * 60 * 1000
// Сколько последних постов сканировать на лайкнувших и сколько лайков с поста брать
const LIKERS_MEDIA_COUNT = 3
const LIKERS_PER_MEDIA = 50
// Сколько тредов директа читать на предмет ответов/упоминаний в сторис
const STORY_EVENTS_AMOUNT = 15
// Глубина скрейпа подписчиков/подписок ОСНОВНОГО черновым для проверки гейта.
// Держим НЕБОЛЬШОЙ (свежая порция + накопленный снапшот подписчиков): 900+900 с
// внутренними паузами instagrapi давали ~1-2 мин НА КАЖДЫЙ аккаунт — при 10 аккаунтах
// цикл перехлёстывал 30-минутный интервал. 200 достаточно (снапшот копится со временем).
const GATE_FOLLOWERS_SCAN = 200
const GATE_FOLLOWING_SCAN = 200
// Сколько последних подписчиков запрашивать у Instagram (лимит безопасности)
const FOLLOWERS_FETCH_LIMIT = 50
// Сколько последних постов и комментариев под каждым сканировать
const COMMENT_MEDIA_COUNT = 3
const COMMENT_PER_MEDIA = 15
// Максимум pk в снапшоте (защита от бесконечного роста JSON в БД)
const SNAPSHOT_MAX = 6000
// Порог ошибок подряд, после которого аккаунт ставится на паузу
const ERROR_PAUSE_THRESHOLD = 5

// Ограничивает множество последними N элементами
function capPks(set: Set<string>, max: number): string[] {
  const arr = Array.from(set)
  return arr.length > max ? arr.slice(arr.length - max) : arr
}

// ── Микс парсинга: API (HikerAPI) / черновые браузером — plan.md §5. ──────────
// ⚠️ Черновой путь (parseXBrowser) экспериментален — DOM-парсинг воркера не проверялся
// на живом Instagram (см. workers/browser/lib/parse.js). Любой сбой чернового —
// не фатален: 'drafts_then_api' падает в API, 'drafts' просто возвращает пусто
// (WARN залогирует внешний scrape()-обёртчик в вызывающем коде).
type DraftGetter = () => Promise<Awaited<ReturnType<typeof pickDraft>>>

function makeDraftGetter(userId: string): DraftGetter {
  let cached: Awaited<ReturnType<typeof pickDraft>> | undefined
  return async () => {
    if (cached === undefined) cached = await pickDraft(userId)
    return cached
  }
}

async function parseFollowersFor(username: string, parsingSource: string, getDraft: DraftGetter, limit: number) {
  if (parsingSource !== 'api') {
    const d = await getDraft()
    if (d) {
      try {
        const r = await parseFollowersBrowser({ storageState: d.browserState, proxy: d.proxy ?? undefined, username: d.username, locale: d.locale ?? undefined, timezoneId: d.timezoneId ?? undefined }, username, limit)
        await markDraftUsed(d.id)
        return { followers: r.followers ?? [] }
      } catch { /* черновой недоступен — попробуем API, если разрешено (см. ниже) */ }
    }
    if (parsingSource === 'drafts') return { followers: [] }
  }
  return scrapeFollowers(username, limit)
}

async function parseCommentsFor(username: string, parsingSource: string, getDraft: DraftGetter, mediaCount: number, perMedia: number) {
  if (parsingSource !== 'api') {
    const d = await getDraft()
    if (d) {
      try {
        const r = await parseCommentsBrowser({ storageState: d.browserState, proxy: d.proxy ?? undefined, username: d.username, locale: d.locale ?? undefined, timezoneId: d.timezoneId ?? undefined }, username, mediaCount, perMedia)
        await markDraftUsed(d.id)
        return { comments: r.comments ?? [] }
      } catch {}
    }
    if (parsingSource === 'drafts') return { comments: [] }
  }
  return scrapeComments(username, mediaCount, perMedia)
}

async function parseLikersFor(username: string, parsingSource: string, getDraft: DraftGetter, mediaCount: number, perMedia: number) {
  if (parsingSource !== 'api') {
    const d = await getDraft()
    if (d) {
      try {
        const r = await parseLikersBrowser({ storageState: d.browserState, proxy: d.proxy ?? undefined, username: d.username, locale: d.locale ?? undefined, timezoneId: d.timezoneId ?? undefined }, username, mediaCount, perMedia)
        await markDraftUsed(d.id)
        return { likers: r.likers ?? [] }
      } catch {}
    }
    if (parsingSource === 'drafts') return { likers: [] }
  }
  return scrapeLikers(username, mediaCount, perMedia)
}

// Выбирает НОВЫЕ цели и помечает «известными» ТОЛЬКО обработанные (+ всю базу на
// первом проходе). Раньше все найденные разом падали в снапшот → всё сверх
// MAX_NEW_PER_POLL молча терялось (помечалось «видели», но действие не выполнялось).
// Теперь лишние остаются «новыми» и добираются в следующих циклах (в пределах лимитов).
function selectTargets<T>(all: T[], known: Set<string>, hadBaseline: boolean, pkOf: (x: T) => string): { fresh: T[]; process: T[] } {
  if (!hadBaseline) { all.forEach((x) => { const k = pkOf(x); if (k) known.add(k) }); return { fresh: [], process: [] } }
  const fresh = all.filter((x) => { const k = pkOf(x); return Boolean(k) && !known.has(k) })
  const process = fresh.slice(0, MAX_NEW_PER_POLL)
  process.forEach((x) => known.add(pkOf(x)))
  return { fresh, process }
}
// Определяет по тексту ошибки, нужно ли остановить аккаунт (challenge/бан/ограничение)
function statusFromError(msg: string): 'CHALLENGE' | 'PAUSED' | null {
  const m = (msg || '').toLowerCase()
  if (/challenge|checkpoint|verify|подтвержд/.test(m)) return 'CHALLENGE'
  if (/feedback_required|feedbackrequired|spam|blocked|action.?block|429|login_required|loginrequired|please wait|few minutes/.test(m)) return 'PAUSED'
  return null
}

// Гейт подписки перед DM: followed_by — он подписан на нас; mutual — взаимная подписка
type GateMode = 'followed_by' | 'mutual'
function passesGate(mode: GateMode, fs: { following: boolean; followed_by: boolean }): boolean {
  return mode === 'mutual' ? (fs.following && fs.followed_by) : fs.followed_by
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const randDelay = (minS: number, maxS: number) =>
  sleep(Math.round((minS + Math.random() * (maxS - minS)) * 1000))

// Извлекает Set<pk> из снапшота в любом формате (старый: [{pk,username}], новый: string[])
function extractKnownPks(data: unknown): Set<string> {
  if (!Array.isArray(data) || data.length === 0) return new Set()
  if (typeof data[0] === 'object' && data[0] !== null) {
    return new Set((data as any[]).map((f) => String(f.pk)))
  }
  return new Set((data as string[]).map(String))
}

function getDmQueue() {
  const url = process.env.REDIS_URL
  if (!url) return null
  return new Queue('dm-send', { connection: { url } })
}

/**
 * Тревога владельцу: громкий лог на затронутые аккаунты (виден в /logs) + опциональный
 * внешний вебхук (ALERT_WEBHOOK_URL) — сюда можно повесить SMS/email-провайдера.
 * НЕ дублируем алерт чаще раза в 3 часа (по последнему такому логу), чтобы не спамить.
 */
const ALERT_COOLDOWN_MS = 3 * 60 * 60 * 1000
async function notifyOwner(accountIds: string[], message: string) {
  if (!accountIds.length) return
  const recent = await prisma.log.findFirst({
    where: { accountId: { in: accountIds }, level: 'ERROR', message: { startsWith: '🚨' } },
    orderBy: { createdAt: 'desc' },
  })
  const throttled = recent && Date.now() - new Date(recent.createdAt).getTime() < ALERT_COOLDOWN_MS
  await Promise.all(accountIds.map((accountId) =>
    prisma.log.create({ data: { accountId, level: 'ERROR', message } }).catch(() => null)
  ))
  const hook = process.env.ALERT_WEBHOOK_URL
  if (hook && !throttled) {
    try {
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: message }) })
    } catch {}
  }
}

// ── Сопоставление фраз (для триггеров на комментарии) ─────────────────────────
function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const prev = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j]
      prev[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(diag, prev[j], prev[j - 1])
      diag = tmp
    }
  }
  return prev[n]
}
function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max
}
/**
 * match = { mode: 'all' | 'specific', phrases: string[], exact: boolean }
 * exact=true  → строгое совпадение нормализованной фразы (регистр/пунктуация игнорируются)
 * exact=false → подстрока ИЛИ близость по опечаткам ("suees liss" ≈ "guest list")
 */
function matchPhrase(text: string, match: any): boolean {
  if (!match || match.mode === 'all') return true
  const phrases: string[] = (match.phrases ?? []).map(norm).filter(Boolean)
  if (!phrases.length) return true // фраз не задано — реагируем всегда
  const t = norm(text)
  if (!t) return false
  if (match.exact) return phrases.some((p) => t === p)

  return phrases.some((p) => {
    if (t.includes(p)) return true
    if (similarity(t, p) >= 0.6) return true
    // фраза внутри длинного комментария с опечатками — скользящее окно по словам
    const words = t.split(' ')
    const pWords = p.split(' ').length
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j <= words.length && j <= i + pWords + 1; j++) {
        if (similarity(words.slice(i, j).join(' '), p) >= 0.7) return true
      }
    }
    return false
  })
}

// Читает текущие счётчики действий триггера и сливает прибавки «сработало» (fired)
// и «выполнено» (done). undefined (пустой инкремент) → Prisma пропустит поле stats.
async function mergeStats(triggerId: string, incFired: Record<string, number>, incDone: Record<string, number>): Promise<any> {
  if (!Object.keys(incFired).length && !Object.keys(incDone).length) return undefined
  const cur = await prisma.triggerRule.findUnique({ where: { id: triggerId }, select: { stats: true } }).catch(() => null)
  return mergeStatsMap(cur?.stats ?? {}, incFired, incDone)
}

// Выполняет действия триггера-подписки для одной цели синхронно.
// Считаем отдельно «сработало» (попытались) и «выполнено» (получилось).
async function runFollowerActionsInline(job: any) {
  // ── Браузерный движок (эмуль): действия по username через реальный Chromium (plan §4.6). ──
  // Строго изолировано от legacy: включается только когда job.engine==='browser' и есть browserState.
  if (job.engine === 'browser' && job.browserState) {
    const r = await runFollowerActionsBrowser({
      browserState: job.browserState, ownerUsername: job.ownerUsername, proxy: job.proxy,
      locale: job.locale, timezoneId: job.timezoneId,
      followerUsername: job.followerUsername, text: job.text || undefined,
      doFollow: job.doFollow, doLike: job.doLike, viewStories: job.viewStories, storyLike: job.storyLike,
      fallbackFollow: job.fallbackFollow, fallbackLike: job.fallbackLike,
    })
    if (r.browserState) await prisma.instagramAccount.update({ where: { id: job.accountId }, data: { browserState: r.browserState as any } }).catch(() => null)
    const attempted = Object.keys(r.incFired).length > 0
    const success = Object.keys(r.incDone).length > 0
    if (attempted) {
      const level = success ? (r.errors.length ? 'WARN' : 'SUCCESS') : 'ERROR'
      const message = success
        ? `Сработал триггер «${job.triggerName}» → @${job.followerUsername}${r.errors.length ? ` (частично: ${r.errors.join('; ')})` : ''}`
        : `Триггер «${job.triggerName}» → @${job.followerUsername}: действия не выполнены${r.errors.length ? ` (${r.errors.join('; ')})` : ''}`
      await Promise.all([
        prisma.log.create({ data: { accountId: job.accountId, level, message } }),
        prisma.triggerRule.update({ where: { id: job.triggerId }, data: { fireCount: { increment: 1 }, stats: await mergeStats(job.triggerId, r.incFired, r.incDone) } }),
      ])
    }
    if (r.brk) await prisma.instagramAccount.update({ where: { id: job.accountId }, data: { status: r.brk } }).catch(() => null)
    return
  }
  // [A1] Страховка: engine=browser, но нет browserState — НЕ звать мёртвый legacy Python.
  // Штатно poll уже отсеивает такие аккаунты (гард в цикле), сюда доходить не должно.
  if (job.engine === 'browser') return

  const session = job.sessionData as object          // основной: DM/фото/подписка/fallback
  const proxy = job.proxy ?? undefined
  // Лайк/сторис могут выполняться черновым (Настройки) — если сессия не передана, берём основного.
  const likeSession = (job.likeSession as object) ?? session
  const likeProxy   = job.likeProxy ?? proxy
  const storySession = (job.storySession as object) ?? session
  const storyProxy   = job.storyProxy ?? proxy
  const errors: string[] = []
  const incFired: Record<string, number> = {}
  const incDone: Record<string, number> = {}
  let dmFired = false, dmSucceeded = false

  if (job.text) {
    dmFired = true
    try { await sendDM(session, job.followerPk, job.text, proxy); dmSucceeded = true }
    catch (e: any) {
      if (statusFromError(e.message)) throw e  // бан/челлендж/лимит → пусть внешний catch остановит основной
      // Личка закрыта → мягкий контакт основным (follow+лайк, только если бюджет был выделен)
      errors.push(`директ закрыт: ${e.message}`)
      if (job.fallbackFollow) { incFired.follow = (incFired.follow || 0) + 1; try { await followUser(session, job.followerPk, proxy); incDone.follow = (incDone.follow || 0) + 1 } catch {} }
      if (job.fallbackLike)   { incFired.like = (incFired.like || 0) + 1; try { await randDelay(2, 5); await likeLatestMedia(session, job.followerPk, proxy); incDone.like = (incDone.like || 0) + 1 } catch {} }
    }
  }
  if (job.image) { dmFired = true; await randDelay(2, 5); try { await sendDMPhoto(session, job.followerPk, job.image, proxy); dmSucceeded = true } catch (e: any) { errors.push(`фото: ${e.message}`) } }
  if (dmFired) { incFired.dm = (incFired.dm || 0) + 1; if (dmSucceeded) incDone.dm = (incDone.dm || 0) + 1 }
  if (job.doFollow) { incFired.follow = (incFired.follow || 0) + 1; await randDelay(3, 7); try { await followUser(session, job.followerPk, proxy); incDone.follow = (incDone.follow || 0) + 1 } catch (e: any) { errors.push(`подписка: ${e.message}`) } }
  if (job.doLike)   { incFired.like = (incFired.like || 0) + 1; await randDelay(3, 8); try { await likeLatestMedia(likeSession, job.followerPk, likeProxy); incDone.like = (incDone.like || 0) + 1 } catch (e: any) { errors.push(`лайк: ${e.message}`) } }
  if (job.viewStories) { incFired.story = (incFired.story || 0) + 1; await randDelay(4, 10); try { await viewStories(storySession, job.followerPk, job.storyLike, storyProxy); incDone.story = (incDone.story || 0) + 1 } catch (e: any) { errors.push(`сторис: ${e.message}`) } }

  const attempted = Object.keys(incFired).length > 0
  const success = Object.keys(incDone).length > 0
  if (attempted) {
    const level = success ? (errors.length ? 'WARN' : 'SUCCESS') : 'ERROR'
    const message = success
      ? `Сработал триггер «${job.triggerName}» → @${job.followerUsername}${errors.length ? ` (частично: ${errors.join('; ')})` : ''}`
      : `Триггер «${job.triggerName}» → @${job.followerUsername}: действия не выполнены${errors.length ? ` (${errors.join('; ')})` : ''}`
    await Promise.all([
      prisma.log.create({ data: { accountId: job.accountId, level, message } }),
      prisma.triggerRule.update({ where: { id: job.triggerId }, data: { fireCount: { increment: 1 }, stats: await mergeStats(job.triggerId, incFired, incDone) } }),
    ])
  }
}

interface PollSummary {
  accountId: string
  totalFollowers: number
  newFollowers: number
  dmsQueued: number
  triggersFound: number
  totalComments: number
  newComments: number
  commentActions: number
  newLikers?: number
  newStoryEvents?: number
  limited?: number      // пропущено из-за дневного лимита
  skipped?: string
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { accountId?: string; manual?: boolean }
  const { accountId } = body
  // Ручная проверка: указан конкретный аккаунт ИЛИ явный флаг manual (кнопка «Проверить»)
  const isManual = Boolean(accountId) || body.manual === true

  // Крон-вызов (по внутреннему секрету) обрабатывает ВСЕ тенанты. Ручной вызов из UI —
  // только аккаунты пользователя сессии (изоляция данных, план A).
  const isInternal = req.headers.get('x-internal-secret') === (process.env.INTERNAL_SECRET ?? 'instaguard-internal-cron')
  let userId: string | null = null
  if (!isInternal) {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    userId = user.id
  }
  const scope = userId ? { userId } : {}

  // ── Глобальный лок от параллельного поллинга ─────────────────────────────────
  // Любой поллинг (полный авто-цикл ИЛИ ручная проверка одного аккаунта) берёт ОДНУ
  // общую аренду. Раньше лок брал только полный цикл, а ручная проверка одного
  // аккаунта шла мимо него → могла обработать тот же аккаунт ОДНОВРЕМЕННО с авто-циклом
  // → задвоение DM и гонка дневных счётчиков. Теперь любые два прохода сериализуются
  // (поллинг редкий — раз в 30 мин + по кнопке, поэтому глобальная сериализация дешева
  // и безопаснее задвоения действий на основном аккаунте).
  const LOCK_KEY = 'poll:all'
  const LOCK_LEASE_MS = 25 * 60 * 1000
  let lockedByUs = false
  {
    await prisma.appLock.upsert({ where: { key: LOCK_KEY }, create: { key: LOCK_KEY, lockedUntil: new Date(0) }, update: {} }).catch(() => {})
    const now = new Date()
    const r = await prisma.appLock.updateMany({
      where: { key: LOCK_KEY, lockedUntil: { lt: now } },
      data: { lockedUntil: new Date(now.getTime() + LOCK_LEASE_MS) },
    }).catch(() => ({ count: 0 }))
    lockedByUs = r.count === 1
    if (!lockedByUs) {
      return NextResponse.json({ ok: true, busy: true, message: 'Проверка уже выполняется — дождитесь завершения.' })
    }
  }

  try {

  // Основные аккаунты (отправители): исключаем черновых (HELPER) — те только парсят.
  const where: any = accountId
    ? { id: accountId, status: 'ACTIVE' as const, ...scope }
    : { status: 'ACTIVE' as const, role: { in: ['RESPONDER', 'BOTH'] }, ...scope }

  const accounts = await prisma.instagramAccount.findMany({
    where,
    include: {
      triggersAsResponder: { where: { isActive: true } },
      snapshots: { orderBy: { createdAt: 'desc' } },
    },
  })

  // Настройки владельцев: работа без прокси (защита от бана) + источник парсинга (plan.md §5).
  // «Черновые» (HELPER) вернулись как ОПЦИЯ (parsingSource='drafts'|'drafts_then_api') — по
  // умолчанию всё ещё 'api' (скрейпер-API), likeByDraft/storyByDraft/allowNoDrafts (действия
  // черновым) остаются LEGACY no-op — черновые теперь только парсят, не действуют.
  const ownerIds = [...new Set(accounts.map((a) => a.userId))]
  const settingsRows = ownerIds.length
    ? await prisma.userSettings.findMany({ where: { userId: { in: ownerIds } }, select: { userId: true, allowNoProxy: true, parsingSource: true } })
    : []
  const allowNoProxy = new Map(settingsRows.map((r) => [r.userId, r.allowNoProxy]))
  const parsingSourceOf = new Map(settingsRows.map((r) => [r.userId, r.parsingSource ?? 'api']))
  // Прокси обязателен, если владелец НЕ включил «Работать без прокси» (по умолчанию — обязателен).
  const proxyRequired = (userId: string) => !allowNoProxy.get(userId)

  // Основные, которым реально есть что делать (есть сессия — legacy ИЛИ браузерная — и активные триггеры)
  const workingMains = accounts.filter((a) => (a.sessionData || a.browserState) && a.triggersAsResponder.length)

  // Скрейпер-API нужен владельцам с parsingSource 'api' или 'drafts_then_api' (там он фолбэк).
  // Чисто 'drafts' — ключ не нужен вообще. Если ключа нет — блокируем ТОЛЬКО тех, кому он
  // реально нужен (честная тревога + стоп для них), остальные (drafts-only) идут в общий цикл.
  const needsScraper = (uid: string) => (parsingSourceOf.get(uid) ?? 'api') !== 'drafts'
  const blockedMains = workingMains.filter((a) => needsScraper(a.userId) && !scraperConfigured())
  const blockedIds = new Set(blockedMains.map((a) => a.id))
  if (blockedMains.length) {
    await notifyOwner(
      blockedMains.map((a) => a.id),
      '🚨 Не задан ключ скрейпер-API (HIKER_API_KEY) — парсинг подписчиков/комментариев/лайков невозможен. Добавьте ключ в переменные окружения Next.js-сервиса (оформить: hikerapi.com) либо переключите «Источник парсинга» на «Только черновые» в Настройках.'
    )
  }

  const summary: PollSummary[] = []
  const dmQueue = getDmQueue()

  for (const account of accounts) {
    if (!account.sessionData && !account.browserState) continue

    // Владельцу нужен скрейпер-API (parsingSource 'api'/'drafts_then_api'), но ключ не задан —
    // уже уведомили выше, этого конкретного аккаунта просто пропускаем.
    if (blockedIds.has(account.id)) {
      summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: account.triggersAsResponder.length, totalComments: 0, newComments: 0, commentActions: 0, skipped: 'no-scraper' })
      continue
    }

    // Прокси обязателен и не задан → НЕ работаем этим аккаунтом (защита от мгновенного бана).
    // Отключается тумблером «Работать без прокси» в Настройках.
    if (proxyRequired(account.userId) && !account.proxy) {
      summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: account.triggersAsResponder.length, totalComments: 0, newComments: 0, commentActions: 0, skipped: 'no-proxy' })
      continue
    }

    // Кулдаун: пропускаем авто-поллинг если аккаунт проверялся недавно
    if (!isManual && account.lastChecked) {
      const elapsed = Date.now() - account.lastChecked.getTime()
      if (elapsed < POLL_COOLDOWN_MS) {
        summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: 0, totalComments: 0, newComments: 0, commentActions: 0, skipped: 'cooldown' })
        continue
      }
    }

    const triggers = account.triggersAsResponder
    const followerTriggers = triggers.filter((t) => t.triggerType === 'NEW_FOLLOWER')
    const commentTriggers = triggers.filter((t) => t.triggerType === 'NEW_COMMENT')
    const likeTriggers = triggers.filter((t) => t.triggerType === 'NEW_LIKE')
    const storyTriggers = triggers.filter((t) => t.triggerType === 'STORY_MENTION')

    const session = account.sessionData as object
    const proxy = account.proxy ?? undefined
    // Движок действий владельца: всегда браузер (кроме недеплоя воркера — см. lib/browser/engine.ts).
    const engine = await resolveEngine(account.userId)
    // [A1] Браузерный движок БЕЗ браузерной сессии → НЕ падать в мёртвый legacy Python.
    // Без browserState аккаунт физически не может действовать браузером (DM/лайк/подписка/сторис).
    // Раньше такие действия уходили в legacy-ветку → 404 к мёртвому Python → errorCount копился и
    // аккаунт ложно метился PAUSED «как бан». Теперь честно: метим CHALLENGE (нужен повторный вход
    // браузером) и пропускаем — без вызова Python и без инкремента ошибок. Аккаунт с browserState
    // (нормальный браузерный вход) сюда не попадает. Все в этом цикле — status ACTIVE (where-фильтр).
    if (engine === 'browser' && !account.browserState) {
      await prisma.instagramAccount.update({ where: { id: account.id }, data: { status: 'CHALLENGE' } }).catch(() => null)
      await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: '⚠️ Нет браузерной сессии — переподключите аккаунт (вход браузером). Действия не выполняются, пока нет browserState.' } }).catch(() => null)
      summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: triggers.length, totalComments: 0, newComments: 0, commentActions: 0, skipped: 'no-browser-session' })
      continue
    }
    // Источник парсинга владельца (plan.md §5): 'api' (по умолч.) | 'drafts' | 'drafts_then_api'.
    // getDraft лениво подбирает и КЕШИРУЕТ чернового на весь цикл этого аккаунта (не дёргаем
    // подбор на каждый поток отдельно — один черновой обслуживает все потоки одного основного).
    const parsingSource = parsingSourceOf.get(account.userId) ?? 'api'
    const getDraft = makeDraftGetter(account.userId)
    const s: PollSummary = {
      accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0,
      triggersFound: triggers.length, totalComments: 0, newComments: 0, commentActions: 0, limited: 0,
    }

    // Дневные счётчики действий (защита от бана)
    const counters: Counters = loadCounters(account.limits)
    // Разнесённые задержки: первое действие скоро, дальше с интервалом ~45–115с
    let cursor = (isManual ? 8 + Math.random() * 14 : 45 + Math.random() * 75) * 1000
    const nextGap = () => (45 + Math.random() * 70) * 1000
    // Черновых больше нет: парсинг идёт через скрейпер-API (по username основного), а ВСЕ
    // действия (директ/лайк/подписка/сторис/коммент) выполняет сам ОСНОВНОЙ своей сессией.
    const likeSess:  object = session
    const likePx:    string | undefined = proxy
    const storySess: object = session
    const storyPx:   string | undefined = proxy

    // Прогрев: дневные лимиты ужимаются по возрасту основного аккаунта (свежий не срывается на полную).
    const warm = warmupFactor(account.createdAt)
    const caps = scaleCaps(warm)
    const use = (k: ActionKind, n = 1) => consume(counters, k, n, caps)

    // ── Проверка подписки БЕЗ обращения к основному ──────────────────────────
    // Подписчиков/подписки основного тянет скрейпер-API (публичные данные) → гейт = принадлежность
    // множеству. Так проверка «подписан ли на нас» не грузит основной аккаунт вообще.
    let gateFollowers: Set<string> | null = null   // кто подписан на основной (followed_by)
    let gateFollowing: Set<string> | null = null   // на кого подписан основной (для mutual)
    const ensureGateFollowers = async (): Promise<Set<string>> => {
      if (gateFollowers) return gateFollowers
      // Стартуем с накопленного снапшота подписчиков + добираем свежих через API
      const set = extractKnownPks(account.snapshots.find((sn) => sn.type === 'FOLLOWERS')?.data)
      try {
        const { followers } = await scrapeFollowers(account.username, GATE_FOLLOWERS_SCAN)
        followers.forEach((f) => set.add(String(f.pk)))
      } catch { /* не смогли добрать — используем что есть (гейт ошибётся в безопасную сторону) */ }
      gateFollowers = set
      return set
    }
    const ensureGateFollowing = async (): Promise<Set<string>> => {
      if (gateFollowing) return gateFollowing
      const set = new Set<string>()
      try {
        const { following } = await scrapeFollowing(account.username, GATE_FOLLOWING_SCAN)
        following.forEach((u) => set.add(String(u.pk)))
      } catch { /* degrade */ }
      gateFollowing = set
      return set
    }
    // true → цель проходит гейт. Не в множестве → безопасно НЕ шлём (защита основного).
    const passesGateFor = async (pk: string, mode: GateMode): Promise<boolean> => {
      const followed_by = (await ensureGateFollowers()).has(pk)
      const following = mode === 'mutual' ? (await ensureGateFollowing()).has(pk) : false
      return passesGate(mode, { following, followed_by })
    }

    // Общий обработчик «целей» (подписчики/лайкнувшие/ответившие на сторис):
    // DM ставит основной (в очередь), лайк/подписка/сторис — черновой (в job).
    // withGate=true → перед DM проверяем подписку; не проходит → DM пропускаем.
    const handleTargets = async (
      targets: { pk: string; username: string }[],
      triggersForStream: typeof triggers,
      withGate: boolean,
    ) => {
      for (const trigger of triggersForStream) {
        const actions = (trigger.actions ?? []) as any[]
        const isOn = (a: any) => a && a.enabled !== false
        const msgAction = actions.find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
        const doFollowT = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
        const doLikeT = actions.some((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))
        const storiesAct = actions.find((a: any) => a.type === 'VIEW_STORIES' && isOn(a))
        if (!msgAction?.templates?.[0] && !doFollowT && !doLikeT && !storiesAct) continue

        const template: string = msgAction?.templates?.[0] ?? ''
        const link = msgAction?.link
        const image: string | undefined = msgAction?.image?.enabled ? msgAction.image.url : undefined
        const gateMode: GateMode | null = withGate && msgAction?.gate ? (msgAction.gate.mode ?? 'followed_by') : null

        for (const target of targets) {
          // Гейт подписки: если задан и не проходит — DM не шлём (лайк/подписка/сторис остаются)
          let dmAllowed = Boolean(msgAction?.templates?.[0])
          if (dmAllowed && gateMode) {
            dmAllowed = await passesGateFor(target.pk, gateMode)
          }

          // ВСЕ действия делает основной (лимиты counters); черновой только парсил цель
          const willDM = dmAllowed && use('dm')
          const willFollow = doFollowT && use('follow')
          const willLike = doLikeT && use('like')
          const willStory = Boolean(storiesAct) && use('story')
          // Флаги fallback (follow+like основным при закрытой личке). РЕЗЕРВИРУЕМ бюджет
          // заранее (use), иначе fallback выполняется в воркере/inline БЕЗ доступа к дневным
          // счётчикам → пробивает потолок follow/like (при холодном трафике закрытых личек
          // много). Приоритет «основной не банится» важнее лёгкого перерасхода бюджета при
          // успешном DM (тогда зарезервированное действие просто не выполнится).
          const fallbackFollow = willDM && !willFollow && use('follow')
          const fallbackLike   = willDM && !willLike && use('like')
          if (!willDM && !willFollow && !willLike && !willStory) { s.limited = (s.limited ?? 0) + 1; continue }

          let text = willDM ? template.replace(/\{\{username\}\}/gi, target.username) : ''
          if (willDM && link?.enabled && link.url) {
            const lt = String(link.text ?? '').replace(/\{\{username\}\}/gi, target.username)
            text += `\n\n${lt ? lt + ': ' : ''}${link.url}`
          }

          const job = {
            sessionData: account.sessionData, browserState: account.browserState,
            engine, ownerUsername: account.username, accountId: account.id,
            locale: account.locale ?? undefined, timezoneId: account.timezoneId ?? undefined,
            triggerId: trigger.id, triggerName: trigger.name,
            followerPk: target.pk, followerUsername: target.username,
            text: text.trim(), image: willDM ? image : undefined,
            doFollow: willFollow, doLike: willLike,
            viewStories: willStory, storyLike: Boolean(storiesAct?.like), proxy: account.proxy,
            fallbackFollow, fallbackLike,
            // Все действия выполняет основной своей сессией (sessionData) — воркер/inline это и берут
            // по умолчанию. Отдельные likeSession/storySession больше не нужны (черновых нет).
          }

          if (dmQueue) {
            await dmQueue.add('send', job, {
              jobId: `dm:${account.id}:${trigger.id}:${target.pk}`,
              delay: Math.round(cursor), attempts: 1,
              removeOnComplete: true, removeOnFail: 100,
            })
            cursor += nextGap()
          } else {
            await runFollowerActionsInline(job)
            await randDelay(40, 90)
          }
          s.dmsQueued++
        }
      }
    }

    // Реальное число подписчиков — для спарклайна нужна лишь ОДНА точка в день.
    // Раньше запрос шёл КАЖДЫЙ цикл (до 48×/сутки на аккаунт) — лишняя нагрузка на IG.
    // Тянем только если сегодняшней точки ещё нет (или числа вообще нет).
    let realFollowers: number | undefined
    let followersHistory: any = undefined
    const today = new Date().toISOString().slice(0, 10)
    const histNow = Array.isArray(account.followersHistory) ? (account.followersHistory as any[]) : []
    const haveToday = histNow.length > 0 && histNow[histNow.length - 1].d === today && account.followers != null
    if (isManual || !haveToday) {
      // Реальное число подписчиков — через скрейпер-API по username (публичные данные,
      // работают независимо от движка входа). Раньше шло через account_info мёртвого
      // Python-воркера → всегда падало, поэтому метрика «Подписчики» и спарклайн были пусты.
      if (scraperConfigured()) {
        try { realFollowers = (await scrapeUserInfo(account.username)).follower_count }
        catch {}
      }
    }
    // Копим историю подписчиков (одна точка в день) для спарклайна прироста
    if (realFollowers !== undefined) {
      const hist = [...histNow]
      const last = hist[hist.length - 1]
      if (last && last.d === today) last.n = realFollowers
      else hist.push({ d: today, n: realFollowers })
      followersHistory = hist.slice(-30)
    }

    // Парсинг идёт через внешний скрейпер-API (не через сессию аккаунта), поэтому сбой парсинга —
    // это проблема API/сети, а НЕ бан основного: логируем предупреждение на аккаунт и тихо
    // пропускаем поток, НЕ трогая статус/счётчик ошибок основного (иначе временный сбой API
    // ставил бы здоровые аккаунты на паузу).
    const scrape = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn() }
      catch (e: any) {
        await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: `Парсинг через API для @${account.username} не удался: ${e?.message}` } }).catch(() => null)
        return null
      }
    }

    try {
      // ── Поток подписчиков ────────────────────────────────────────────────
      if (followerTriggers.length) {
        const scraped = await scrape(() => parseFollowersFor(account.username, parsingSource, getDraft, FOLLOWERS_FETCH_LIMIT))
        if (scraped) {
          const { followers } = scraped
          const snapFollowers = account.snapshots.find((sn) => sn.type === 'FOLLOWERS')
          const hadBaseline = Boolean(snapFollowers)
          const knownPks = extractKnownPks(snapFollowers?.data)
          // Первая проверка (нет снапшота) — только фиксируем базу, НЕ обрабатываем существующих
          // подписчиков (иначе на новом аккаунте будет массовая рассылка → бан).
          const { fresh, process } = selectTargets(followers, knownPks, hadBaseline, (f) => String(f.pk))

          await prisma.$transaction([
            prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'FOLLOWERS' } }),
            prisma.snapshot.create({ data: { accountId: account.id, type: 'FOLLOWERS', data: capPks(knownPks, SNAPSHOT_MAX) } }),
          ])

          s.totalFollowers = followers.length
          s.newFollowers = fresh.length

          // Подписчик уже подписан на нас — гейт не нужен
          await handleTargets(
            process.map((f) => ({ pk: String(f.pk), username: f.username })),
            followerTriggers, false,
          )
        }
      }

      // ── Поток лайков (отдельный кулдаун) ─────────────────────────────────
      const snapLikesMeta = account.snapshots.find((sn) => sn.type === 'LIKES')
      const likeElapsed = snapLikesMeta ? Date.now() - new Date(snapLikesMeta.createdAt).getTime() : Infinity
      if (likeTriggers.length && (isManual || likeElapsed >= LIKE_COOLDOWN_MS)) {
        const scraped = await scrape(() => parseLikersFor(account.username, parsingSource, getDraft, LIKERS_MEDIA_COUNT, LIKERS_PER_MEDIA))
        if (scraped) {
          const { likers } = scraped
          const hadBaseline = Boolean(snapLikesMeta)
          const knownL = extractKnownPks(snapLikesMeta?.data)
          const { fresh, process } = selectTargets(likers, knownL, hadBaseline, (l) => String(l.pk))

          await prisma.$transaction([
            prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'LIKES' } }),
            prisma.snapshot.create({ data: { accountId: account.id, type: 'LIKES', data: capPks(knownL, SNAPSHOT_MAX) } }),
          ])

          s.newLikers = fresh.length
          // Гейт: лайкнувший может быть не подписан → DM пропускается (лайк/подписка/сторис остаются)
          await handleTargets(
            process.map((l) => ({ pk: String(l.pk), username: l.username })),
            likeTriggers, true,
          )
        }
      }

      // ── Поток стори-событий: ответы на мои сторис + упоминания (сессией основного) ──
      const snapStoryMeta = account.snapshots.find((sn) => sn.type === 'STORY')
      const storyElapsed = snapStoryMeta ? Date.now() - new Date(snapStoryMeta.createdAt).getTime() : Infinity
      // Стори-события видит только ОСНОВНОЙ (это его личка). Браузерные аккаунты читают
      // инбокс своим Chromium (`/story-inbox`, веб-приватный API), legacy — instagrapi.
      const useBrowserForStories = engine === 'browser' && Boolean(account.browserState)
      if (storyTriggers.length && (useBrowserForStories || account.sessionData) && (isManual || storyElapsed >= STORY_COOLDOWN_MS)) {
        let events: Array<{ pk?: string | number; user_pk: string | number; username: string }> = []
        if (useBrowserForStories) {
          try {
            const r = await browserStoryEvents(
              { storageState: account.browserState as object, proxy: account.proxy ?? undefined, username: account.username, locale: account.locale ?? undefined, timezoneId: account.timezoneId ?? undefined },
              STORY_EVENTS_AMOUNT,
            )
            events = r.events ?? []
            // Сессия «дозрела» за чтение инбокса — сохраняем обновлённый storageState.
            if (r.browserState) await prisma.instagramAccount.update({ where: { id: account.id }, data: { browserState: r.browserState as any } }).catch(() => null)
          } catch (e: any) {
            await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: `Стори-инбокс (браузер) не прочитан: ${String(e?.message ?? e).slice(0, 120)}` } }).catch(() => null)
          }
        } else {
          const r = await getStoryEvents(session, proxy, STORY_EVENTS_AMOUNT)
          events = r.events
        }
        const hadBaseline = Boolean(snapStoryMeta)
        const knownS = extractKnownPks(snapStoryMeta?.data)
        const { fresh, process } = selectTargets(events, knownS, hadBaseline, (e) => (e.pk ? String(e.pk) : ''))

        await prisma.$transaction([
          prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'STORY' } }),
          prisma.snapshot.create({ data: { accountId: account.id, type: 'STORY', data: capPks(knownS, SNAPSHOT_MAX) } }),
        ])

        s.newStoryEvents = fresh.length
        await handleTargets(
          process.map((e) => ({ pk: String(e.user_pk), username: e.username })),
          storyTriggers, true,
        )
      }

      // ── Поток комментариев (отдельный кулдаун — реже чем подписчики) ────
      const snapCommentsMeta = account.snapshots.find((sn) => sn.type === 'COMMENTS')
      const commentElapsed = snapCommentsMeta
        ? Date.now() - new Date(snapCommentsMeta.createdAt).getTime()
        : Infinity
      // Браузерные аккаунты (нет sessionData) закрывают поток через постовой /comment|/reply-comment
      // воркера — postUrl строится из media_id (shortcode, lib/instagram/shortcode.ts). Реплай
      // браузером сейчас = обычный коммент к посту, НЕ тред-ответ конкретному комменту (см.
      // workers/browser/lib/actions.js replyComment — тред отложен на Фазу 4).
      const useBrowserForComments = engine === 'browser' && Boolean(account.browserState)
      if (commentTriggers.length && (useBrowserForComments || account.sessionData) && (isManual || commentElapsed >= COMMENT_COOLDOWN_MS)) {
        const scraped = await scrape(() => parseCommentsFor(account.username, parsingSource, getDraft, COMMENT_MEDIA_COUNT, COMMENT_PER_MEDIA))
        if (scraped) {
        const { comments } = scraped
        const hadBaseline = Boolean(snapCommentsMeta)
        const knownC = extractKnownPks(snapCommentsMeta?.data)
        // Первая проверка (нет снапшота) — только фиксируем базу, НЕ реагируем на старые комменты,
        // иначе бот разом ответит на все существующие. Реагируем только на появившиеся после базы.
        const { fresh, process: toProcess } = selectTargets(comments, knownC, hadBaseline, (c) => String(c.pk))

        await prisma.$transaction([
          prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'COMMENTS' } }),
          prisma.snapshot.create({ data: { accountId: account.id, type: 'COMMENTS', data: capPks(knownC, SNAPSHOT_MAX) } }),
        ])

        s.totalComments = comments.length
        s.newComments = fresh.length

        // Браузерная сессия «дозревает» между действиями — трекаем локально, пишем в БД
        // после каждой обработанной пары (коммент × триггер), как в runFollowerActionsInline.
        let cState: object | undefined = account.browserState as object | undefined
        const bctx = () => ({ storageState: cState as object, proxy: account.proxy ?? undefined, username: account.username, locale: account.locale ?? undefined, timezoneId: account.timezoneId ?? undefined })

        for (const c of toProcess) {
          for (const trigger of commentTriggers) {
            const actions = (trigger.actions ?? []) as any[]
            const isOn = (a: any) => a && a.enabled !== false
            // «Сигнал» — общее условие на весь триггер (хранится в conditions)
            const match = (trigger.conditions ?? {}) as any
            if (!matchPhrase(c.text, match)) continue

            const dm = actions.find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
            const reply = actions.find((a: any) => a.type === 'REPLY_COMMENT' && isOn(a))
            const legacyGate = actions.find((a: any) => a.type === 'COMMENT_GATE' && isOn(a))
            // Гейт подписки: новый формат — dm.gate {mode, inviteText}; старый — экшен COMMENT_GATE {text}
            const gateCfg: { mode: GateMode; inviteText: string } | null =
              dm?.gate ? { mode: (dm.gate.mode ?? 'followed_by'), inviteText: String(dm.gate.inviteText ?? '') }
              : legacyGate ? { mode: 'followed_by' as GateMode, inviteText: String(legacyGate.text ?? '') }
              : null
            // «Лайк» в триггере комментарий = лайкнуть посты автора (LIKE_MEDIA); LIKE_COMMENT — легаси (лайк коммента)
            const doLikePosts = actions.some((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))
            const likeCmt = actions.some((a: any) => a.type === 'LIKE_COMMENT' && isOn(a))
            const doFollow = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
            const storiesAct = actions.find((a: any) => a.type === 'VIEW_STORIES' && isOn(a))

            let fired = false
            let gatedStop = false
            const errors: string[] = []
            const incFired: Record<string, number> = {}   // «сработало» (попытки)
            const incDone: Record<string, number> = {}    // «выполнено» (успехи)
            const postUrl = mediaPostUrl(c.media_id)

            // Проверка подписки: если автор НЕ проходит гейт — только коммент-приглашение, стоп
            if (gateCfg) {
              const ok = await passesGateFor(c.user_pk, gateCfg.mode)

              if (!ok) {
                const gateText = gateCfg.inviteText.replace(/\{\{username\}\}/gi, c.username)
                if (gateText && use('comment')) {
                  incFired.comment = (incFired.comment || 0) + 1
                  try {
                    if (useBrowserForComments) { const r = await browserReply(bctx(), postUrl, gateText); if (r.browserState) cState = r.browserState; if (!r.ok) throw new Error(r.error ?? 'не отправлен') }
                    else await replyComment(session, c.media_id, gateText, c.pk, proxy)
                    fired = true; incDone.comment = (incDone.comment || 0) + 1
                  }
                  catch (e: any) { errors.push(`коммент-приглашение: ${e.message}`) }
                } else if (gateText) { s.limited = (s.limited ?? 0) + 1 }
                gatedStop = true
              }
            }

            // Подписан (или проверки нет): действия с паузами между ними + дневной лимит
            if (!gatedStop) {
              if (reply) {
                const variants: string[] = (reply.replies ?? []).filter(Boolean)
                if (variants.length && use('comment')) {
                  incFired.comment = (incFired.comment || 0) + 1
                  const pick = variants[Math.floor(Math.random() * variants.length)].replace(/\{\{username\}\}/gi, c.username)
                  try {
                    if (useBrowserForComments) { const r = await browserReply(bctx(), postUrl, pick); if (r.browserState) cState = r.browserState; if (!r.ok) throw new Error(r.error ?? 'не отправлен') }
                    else await replyComment(session, c.media_id, pick, c.pk, proxy)
                    fired = true; incDone.comment = (incDone.comment || 0) + 1
                  }
                  catch (e: any) { errors.push(`ответ: ${e.message}`) }
                }
              }
              if (doLikePosts && use('like', COMMENT_LIKE_POSTS)) {
                incFired.like = (incFired.like || 0) + 1
                await randDelay(2, 5)
                try {
                  if (useBrowserForComments) { const r = await browserLike(bctx(), c.username, COMMENT_LIKE_POSTS); if (r.browserState) cState = r.browserState; if (!r.ok) throw new Error(r.error ?? 'не лайкнуто') }
                  else await likeUserMedias(likeSess, c.user_pk, COMMENT_LIKE_POSTS, likePx)
                  fired = true; incDone.like = (incDone.like || 0) + 1
                }
                catch (e: any) { errors.push(`лайк постов: ${e.message}`) }
              }
              if (likeCmt && use('like')) {
                incFired.like = (incFired.like || 0) + 1
                await randDelay(1, 3)
                if (useBrowserForComments) {
                  // Лайк конкретного коммента браузером не реализован (нужен клик по коммент-нити — Фаза 4)
                  errors.push('лайк коммента: не поддерживается браузерным движком')
                } else {
                  try { await likeComment(likeSess, c.pk, likePx); fired = true; incDone.like = (incDone.like || 0) + 1 }
                  catch (e: any) { errors.push(`лайк коммента: ${e.message}`) }
                }
              }
              if (doFollow && use('follow')) {
                incFired.follow = (incFired.follow || 0) + 1
                await randDelay(2, 5)
                try {
                  if (useBrowserForComments) { const r = await browserFollow(bctx(), c.username); if (r.browserState) cState = r.browserState; if (!r.ok) throw new Error(r.error ?? 'не подписан') }
                  else await followUser(session, c.user_pk, proxy)
                  fired = true; incDone.follow = (incDone.follow || 0) + 1
                }
                catch (e: any) { errors.push(`подписка: ${e.message}`) }
              }
              if (dm?.templates?.[0] && use('dm')) {
                incFired.dm = (incFired.dm || 0) + 1
                await randDelay(3, 8)
                let text = String(dm.templates[0]).replace(/\{\{username\}\}/gi, c.username)
                if (dm.link?.enabled && dm.link.url) {
                  const lt = String(dm.link.text ?? '').replace(/\{\{username\}\}/gi, c.username)
                  text += `\n\n${lt ? lt + ': ' : ''}${dm.link.url}`
                }
                if (useBrowserForComments) {
                  try {
                    const r = await browserDM(bctx(), c.username, text.trim())
                    if (r.browserState) cState = r.browserState
                    if (r.ok) { fired = true; incDone.dm = (incDone.dm || 0) + 1 }
                    else if (r.closed) {
                      errors.push(`директ закрыт: ${r.error ?? 'closed'}`)
                      if (use('follow')) { incFired.follow = (incFired.follow || 0) + 1; try { const fr = await browserFollow(bctx(), c.username); if (fr.browserState) cState = fr.browserState; if (fr.ok) { fired = true; incDone.follow = (incDone.follow || 0) + 1 } } catch {} }
                      if (use('like'))   { incFired.like = (incFired.like || 0) + 1; await randDelay(2, 5); try { const lr = await browserLike(bctx(), c.username, 1); if (lr.browserState) cState = lr.browserState; if (lr.ok) { fired = true; incDone.like = (incDone.like || 0) + 1 } } catch {} }
                    } else {
                      throw new Error(r.error ?? 'не отправлен')
                    }
                  } catch (e: any) {
                    if (statusFromError(e.message)) throw e
                    errors.push(`директ: ${e.message}`)
                  }
                } else {
                  try {
                    await sendDM(session, c.user_pk, text.trim(), proxy); fired = true; incDone.dm = (incDone.dm || 0) + 1
                    if (dm.image?.enabled && dm.image.url) {
                      await randDelay(2, 4)
                      await sendDMPhoto(session, c.user_pk, dm.image.url, proxy)
                    }
                  } catch (e: any) {
                    if (statusFromError(e.message)) throw e  // бан/челлендж/лимит → основной на паузу
                    // Личка закрыта / не доставлено → мягкий контакт основным (follow + лайк)
                    errors.push(`директ закрыт: ${e.message}`)
                    if (use('follow')) { incFired.follow = (incFired.follow || 0) + 1; try { await followUser(session, c.user_pk, proxy); fired = true; incDone.follow = (incDone.follow || 0) + 1 } catch {} }
                    if (use('like'))   { incFired.like = (incFired.like || 0) + 1; await randDelay(2, 5); try { await likeLatestMedia(session, c.user_pk, proxy); fired = true; incDone.like = (incDone.like || 0) + 1 } catch {} }
                  }
                }
              }
              if (storiesAct && use('story')) {
                incFired.story = (incFired.story || 0) + 1
                await randDelay(3, 7)
                try {
                  if (useBrowserForComments) { const r = await browserStories(bctx(), c.username, Boolean(storiesAct.like)); if (r.browserState) cState = r.browserState; if (!r.ok) throw new Error(r.error ?? 'не просмотрено') }
                  else await viewStories(storySess, c.user_pk, Boolean(storiesAct.like), storyPx)
                  fired = true; incDone.story = (incDone.story || 0) + 1
                }
                catch (e: any) { errors.push(`сторис: ${e.message}`) }
              }
            }

            const attempted = Object.keys(incFired).length > 0
            if (attempted) {
              const level = fired ? (errors.length ? 'WARN' : 'SUCCESS') : 'ERROR'
              const message = fired
                ? `Коммент @${c.username} → «${trigger.name}»${gatedStop ? ' (не подписан → приглашение)' : ''}${errors.length ? ` (частично: ${errors.join('; ')})` : ''}`
                : `Коммент @${c.username} → «${trigger.name}»: действия не выполнены${errors.length ? ` (${errors.join('; ')})` : ''}`
              await Promise.all([
                prisma.log.create({ data: { accountId: account.id, level, message } }),
                prisma.triggerRule.update({ where: { id: trigger.id }, data: { fireCount: { increment: 1 }, stats: await mergeStats(trigger.id, incFired, incDone) } }),
                ...(useBrowserForComments && cState ? [prisma.instagramAccount.update({ where: { id: account.id }, data: { browserState: cState as any } })] : []),
              ])
              if (fired) s.commentActions++
            }
          }
        }
        }
      }

      // ── Прогрев + keep-alive браузерной сессии (по запросу пользователя) ──────────
      // Периодический живой заход с ТОГО ЖЕ прокси: сессия дозревает (свежий browserState),
      // аккаунт греется, Instagram видит активность и не «остужает» сессию. Гейт по кулдауну
      // (метка limits.lastWarmup) — не на каждый поллинг. Сбой прогрева НЕ роняет цикл.
      let warmedState: object | undefined
      if (engine === 'browser' && account.browserState) {
        const lastWarmup = Number((account.limits as any)?.lastWarmup || 0)
        if (isManual || Date.now() - lastWarmup >= WARMUP_KEEPALIVE_MS) {
          try {
            const w = await browserWarmup(account.browserState as object, proxy, account.username, account.locale ?? undefined, account.timezoneId ?? undefined)
            if (w.browserState) warmedState = w.browserState
            ;(counters as any).lastWarmup = Date.now()
            if (!w.alive) {
              await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: '⚠️ Прогрев: сессия не подтвердилась (возможно, остыла/отклонена IP). Если повторяется — нужен повторный вход.' } }).catch(() => null)
            }
          } catch { /* прогрев не критичен для цикла */ }
        }
      }

      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { lastChecked: new Date(), errorCount: 0, limits: counters as any, ...(warmedState ? { browserState: warmedState as any } : {}), ...(realFollowers !== undefined ? { followers: realFollowers, followersHistory } : {}) },
      })
      summary.push(s)
    } catch (e: any) {
      // Предохранитель: challenge/бан/ограничение → останавливаем аккаунт, чтобы не долбить его
      const brk = statusFromError(e.message)
      const nextErrors = (account.errorCount ?? 0) + 1
      const data: any = { errorCount: { increment: 1 }, limits: counters as any, lastChecked: new Date() }
      if (brk) data.status = brk
      else if (nextErrors >= ERROR_PAUSE_THRESHOLD) data.status = 'PAUSED'
      await prisma.instagramAccount.update({ where: { id: account.id }, data })
      await prisma.log.create({
        data: { accountId: account.id, level: 'ERROR', message: `Ошибка проверки: ${e.message}${data.status ? ` → аккаунт остановлен (${data.status})` : ''}` },
      })
      summary.push(s)
    }
  }

  if (dmQueue) await dmQueue.close()

  return NextResponse.json({ ok: true, summary })

  } finally {
    // Снимаем аренду лока — следующий цикл сможет стартовать сразу
    if (lockedByUs) await prisma.appLock.update({ where: { key: LOCK_KEY }, data: { lockedUntil: new Date(0) } }).catch(() => {})
  }
}

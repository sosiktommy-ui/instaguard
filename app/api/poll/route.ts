import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
// Парсинг подписчиков/комментариев/лайкнувших/подписок — через скрейпер-API (замена черновых).
// Формы ответов 1:1 совпадают со старыми getFollowers/getComments/getLikers/getFollowing.
import { scrapeFollowers, scrapeFollowing, scrapeComments, scrapeLikers } from '@/lib/scraper/hiker'
import { runFollowerActionsBrowser } from '@/lib/browser/actions'
import {
  browserComment, browserReply, browserFollow, browserLike, browserDM, browserStories,
  browserStoryEvents, browserWarmup, browserSelfEvents, browserAcceptFollowRequests,
  parseFollowersBrowser, parseCommentsBrowser, parseLikersBrowser,
} from '@/lib/browser/client'
import { pickDraft, markDraftUsed } from '@/lib/browser/draftPool'
import { acquireBrowserLock, releaseBrowserLock } from '@/lib/browserLock'
import { loadDelivery, deliveryUnhealthy, recordDelivery, DELIVERY_SLOWDOWN_FACTOR } from '@/lib/delivery'
import { mediaPostUrl } from '@/lib/instagram/shortcode'
import { Queue } from 'bullmq'
import { loadCounters, consume, warmupFactor, scaleCaps, mergeCaps, MAX_NEW_PER_POLL, type Counters, type ActionKind } from '@/lib/limits'
import { activityWindow } from '@/lib/activity'
import { getCurrentUser } from '@/lib/auth'
import { mergeStatsMap, logMeta } from '@/lib/stats'
import { matchPhrase } from '@/lib/match'
import { selectTargets } from '@/lib/targets'

// Интервал авто-проверки одного аккаунта — настройка владельца pollIntervalHours (дефолт 3ч),
// применяется через intervalMsOf() в цикле поллинга (заменил прежний фиксированный кулдаун).
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
const SELF_EVENTS_AMOUNT = 60   // plan4: сколько историй news/inbox читать за проверку (шире окно —
                                // при всплеске (много подписок/комментов разом) не теряем старые события;
                                // сами действия всё равно ограничены дневными лимитами + «дрипом»)
const ACCEPT_REQUESTS_LIMIT = 10 // §13.11: сколько входящих заявок в подписчики подтверждать за цикл (ban-safety)
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

async function parseFollowersFor(username: string, parsingSource: string, getDraft: DraftGetter, limit: number): Promise<{ followers: { pk: string; username: string; full_name?: string }[]; followerCount?: number | null; restricted?: boolean }> {
  if (parsingSource !== 'api') {
    const d = await getDraft()
    if (d) {
      try {
        const r = await parseFollowersBrowser({ storageState: d.browserState, proxy: d.proxy ?? undefined, username: d.username, locale: d.locale ?? undefined, timezoneId: d.timezoneId ?? undefined }, username, limit)
        await markDraftUsed(d.id)
        // Черновой даёт и число подписчиков, и признак ограничения (список скрыт от третьих сторон).
        return { followers: r.followers ?? [], followerCount: r.followerCount ?? null, restricted: Boolean(r.restricted) }
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
      followerUsername: job.followerUsername, text: job.text || undefined, image: job.image || undefined,
      doFollow: job.doFollow, doLike: job.doLike, likeCount: job.likeCount, viewStories: job.viewStories,
      storyLike: job.storyLike, storyCount: job.storyCount,
      fallbackFollow: job.fallbackFollow, fallbackLike: job.fallbackLike,
    })
    if (r.browserState) await prisma.instagramAccount.update({ where: { id: job.accountId }, data: { browserState: r.browserState as any } }).catch(() => null)
    // §4.6 — исход доставки директа (inline-путь без очереди — один процесс, гонки нет).
    if (r.incFired.dm) await recordDelivery(prisma, job.accountId, r.incFired.dm, r.incDone.dm || 0, Date.now())
    const attempted = Object.keys(r.incFired).length > 0
    const success = Object.keys(r.incDone).length > 0
    const impossible = r.impossible ?? []
    const hardError = r.errors.length > 0
    // §13.10 — «невозможно» (0 постов/0 сторис) НЕ ошибка. Триггер СРАБОТАЛ, если что-то выполнено
    // ИЛИ единственное, что «помешало» — невозможность действия (без реальных ошибок).
    const fired = success || (impossible.length > 0 && !hardError)
    if (attempted) {
      const parts: string[] = []
      if (r.errors.length) parts.push(r.errors.join('; '))
      if (impossible.length) parts.push(`невозможно: ${impossible.join('; ')}`)
      const tail = parts.length ? ` (${parts.join('; ')})` : ''
      const level = success ? (hardError ? 'WARN' : 'SUCCESS') : (hardError ? 'ERROR' : 'WARN')
      // Обогащаем строку журнала типом триггера и выполненными действиями (для колонок в LogModal)
      const meta = logMeta(job.triggerType, success ? Object.keys(r.incDone) : [])
      const message = success
        ? `Сработал триггер «${job.triggerName}» → @${job.followerUsername}${meta}${tail}`
        : (hardError
          ? `Триггер «${job.triggerName}» → @${job.followerUsername}: действия не выполнены${meta}${tail}`
          : `Триггер «${job.triggerName}» → @${job.followerUsername}: действие невозможно${meta}${tail}`)
      await Promise.all([
        prisma.log.create({ data: { accountId: job.accountId, level, message } }),
        // «Срабатывание» (fireCount) — при реально выполненном действии ИЛИ когда действие было
        // невозможным (нет постов/сторис) без ошибок (§13.10). Провал (директ не ушёл / таймаут) —
        // НЕ считается. stats пишем всегда (раздельно попытки/выполнено), чтобы всё было видно.
        prisma.triggerRule.update({ where: { id: job.triggerId }, data: { ...(fired ? { fireCount: { increment: 1 } } : {}), stats: await mergeStats(job.triggerId, r.incFired, r.incDone) } }),
      ])
    }
    if (r.brk) await prisma.instagramAccount.update({ where: { id: job.accountId }, data: { status: r.brk } }).catch(() => null)
    return
  }
  // Нет browserState — действовать браузером нечем. poll отсеивает такие аккаунты гардом [A1]
  // (метит CHALLENGE «нужен повторный вход»), сюда доходить не должно; на всякий случай — no-op.
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
    ? await prisma.userSettings.findMany({ where: { userId: { in: ownerIds } }, select: { userId: true, allowNoProxy: true, parsingSource: true, pollIntervalHours: true, dailyCaps: true } })
    : []
  const allowNoProxy = new Map(settingsRows.map((r) => [r.userId, r.allowNoProxy]))
  const parsingSourceOf = new Map(settingsRows.map((r) => [r.userId, r.parsingSource ?? 'api']))
  // Пользовательские дневные лимиты (override дефолтов, кламп в mergeCaps). Дефолт — DAILY_CAPS.
  const capsOf = (userId: string) => mergeCaps(settingsRows.find((r) => r.userId === userId)?.dailyCaps)
  // §10 настраиваемый интервал авто-проверки (раз в N часов на аккаунт). Дефолт 3ч; кламп 1..168.
  const intervalMsOf = (userId: string) =>
    Math.max(1, Math.min(168, settingsRows.find((r) => r.userId === userId)?.pollIntervalHours ?? 3)) * 60 * 60 * 1000
  // Прокси обязателен, если владелец НЕ включил «Работать без прокси» (по умолчанию — обязателен).
  const proxyRequired = (userId: string) => !allowNoProxy.get(userId)

  // Основные, у которых есть какая-либо сессия и активные триггеры. sessionData тут — только
  // «мост» для старых legacy-аккаунтов (instagrapi удалён, Фаза V): они пройдут этот фильтр и
  // ниже попадут под [A1]-гард, где честно пометятся CHALLENGE (нужен вход браузером), а не
  // молча пропадут. Реально действовать может лишь аккаунт с browserState.
  const workingMains = accounts.filter((a) => (a.sessionData || a.browserState) && a.triggersAsResponder.length)

  // plan4 (Фаза D): детект идёт через СВОИ уведомления (self-events) — HikerAPI/черновые НЕ нужны,
  // поэтому никого не блокируем. Счётчик подписчиков тоже растёт из self-events (новые подписчики
  // этого цикла), без HikerAPI.
  const blockedMains: typeof workingMains = []
  const blockedIds = new Set<string>()
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

    // Счётчик подписчиков растёт из САМИХ уведомлений аккаунта (self-events): каждый новый
    // подписчик, впервые замеченный в потоке ниже, прибавляется к счётчику (см. followersGained).
    // HikerAPI/апишки/черновые для метрики НЕ используются.

    // Владельцу нужен скрейпер-API (parsingSource 'api'/'drafts_then_api'), но ключ не задан —
    // уже уведомили выше, этого конкретного аккаунта просто пропускаем.
    if (blockedIds.has(account.id)) {
      summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: account.triggersAsResponder.length, totalComments: 0, newComments: 0, commentActions: 0, skipped: 'no-scraper' })
      continue
    }

    // Прокси обязателен и не задан → НЕ работаем этим аккаунтом (защита от мгновенного бана).
    // Отключается тумблером «Работать без прокси» в Настройках.
    if (proxyRequired(account.userId) && !account.proxy) {
      // Бот ПОСМОТРЕЛ аккаунт (но без прокси не действует) — отмечаем время проверки, чтобы в
      // Настройках «Последняя проверка» была честной (бот жив и проверяет), а не «6 ч назад».
      await prisma.instagramAccount.update({ where: { id: account.id }, data: { lastChecked: new Date() } }).catch(() => null)
      summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: account.triggersAsResponder.length, totalComments: 0, newComments: 0, commentActions: 0, skipped: 'no-proxy' })
      continue
    }

    // §10 Интервал авто-проверки: пропускаем, если аккаунт проверялся раньше, чем N часов назад
    // (N — настройка владельца «Интервал авто-проверки», дефолт 3ч). Ручной запуск игнорирует.
    if (!isManual && account.lastChecked) {
      const elapsed = Date.now() - account.lastChecked.getTime()
      if (elapsed < intervalMsOf(account.userId)) {
        summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: 0, totalComments: 0, newComments: 0, commentActions: 0, skipped: 'cooldown' })
        continue
      }
    }

    const triggers = account.triggersAsResponder
    const followerTriggers = triggers.filter((t) => t.triggerType === 'NEW_FOLLOWER')
    const commentTriggers = triggers.filter((t) => t.triggerType === 'NEW_COMMENT')
    // NEW_LIKE — бета («скоро»), НА ПАУЗЕ: self-уведомления о лайках АГРЕГИРУЮТСЯ Instagram
    // («X и ещё N лайкнули» → только топ-актор + счётчик, НЕ полный список лайкнувших), поэтому
    // триггер неполон до добора likers конкретного поста (plan4 Фаза F). Пустой список = поток
    // лайков не выполняется даже для существующих активных NEW_LIKE-кампаний.
    const LIKE_TRIGGER_BETA: boolean = true
    const likeTriggers = LIKE_TRIGGER_BETA ? [] : triggers.filter((t) => t.triggerType === 'NEW_LIKE')
    const storyTriggers = triggers.filter((t) => t.triggerType === 'STORY_MENTION')

    const proxy = account.proxy ?? undefined
    // [A1] Браузерный аккаунт БЕЗ браузерной сессии не может действовать (DM/лайк/подписка/сторис).
    // Честно метим CHALLENGE (нужен повторный вход браузером) и пропускаем — без инкремента ошибок.
    // Аккаунт с browserState (нормальный браузерный вход) сюда не попадает; все тут — status ACTIVE.
    if (!account.browserState) {
      await prisma.instagramAccount.update({ where: { id: account.id }, data: { status: 'CHALLENGE', lastChecked: new Date() } }).catch(() => null)
      await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: '⚠️ Нет браузерной сессии — переподключите аккаунт (вход браузером). Действия не выполняются, пока нет browserState.' } }).catch(() => null)
      summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: triggers.length, totalComments: 0, newComments: 0, commentActions: 0, skipped: 'no-browser-session' })
      continue
    }
    // §1.6/1.7 Суточный ритм: ночью / в «выходной» аккаунта по его таймзоне — ТИШИНА (живой
    // человек не активничает в 4 утра; бот 24/7 палится). Пропускаем весь аккаунт (в т.ч. парсинг
    // — не тратим API ночью; события останутся «новыми» и добьются утром). Ручная проверка
    // (isManual) ритм игнорирует — пользователь явно нажал «Проверить».
    if (!isManual) {
      const aw = activityWindow(account.timezoneId, account.username)
      if (!aw.active) {
        // Тихие часы (ночь/выходной по таймзоне аккаунта) — бот СОЗНАТЕЛЬНО молчит (анти-бан, §1.6).
        // Но проверку он выполнил → отмечаем lastChecked, чтобы «Последняя проверка» не выглядела
        // «зависшей» на 6 ч (первое утреннее действие сдвинется максимум на 1 интервал — естественно).
        await prisma.instagramAccount.update({ where: { id: account.id }, data: { lastChecked: new Date() } }).catch(() => null)
        summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: triggers.length, totalComments: 0, newComments: 0, commentActions: 0, skipped: aw.reason ?? 'quiet-hours' })
        continue
      }
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
    let browserLockHeld = false   // §4.8 — держим ли per-account лок браузерной сессии (release в finally)
    let cursor = (isManual ? 8 + Math.random() * 14 : 45 + Math.random() * 75) * 1000
    const nextGap = () => (45 + Math.random() * 70) * 1000

    // §1.8 «Дрип» новых целей: даже если за интервал накопилось много новых (10 подписок разом),
    // за ОДИН цикл обрабатываем лишь МАЛЕНЬКУЮ рандомную порцию (2–4), остальные остаются «свежими»
    // и добираются в следующих циклах — так серия действий не улетает залпом (топ-сигнал бана), но
    // никто не теряется (selectTargets помечает известными ТОЛЬКО обработанных). Ручной запуск —
    // обрабатывает больше (до MAX_NEW_PER_POLL): пользователь явно ждёт результат.
    const newCap = isManual ? MAX_NEW_PER_POLL : 2 + Math.floor(Math.random() * 3)

    // Прогрев: дневные лимиты ужимаются по возрасту основного аккаунта (свежий не срывается на полную).
    const warm = warmupFactor(account.createdAt)
    const caps = scaleCaps(warm, capsOf(account.userId))
    // §4.6 автоснижение: если директы сегодня систематически НЕ доходят (лички закрыты массово /
    // ограничение) — резко режем дневной лимит DM, чтобы не долбить аккаунт впустую (сам ban-сигнал).
    // Сбрасывается на следующий день (счётчик дневной). Комменты/лайки/сторис не трогаем.
    if (deliveryUnhealthy(loadDelivery(account.deliveryStats))) {
      caps.dm = Math.max(1, Math.floor(caps.dm * DELIVERY_SLOWDOWN_FACTOR))
    }
    const use = (k: ActionKind, n = 1) => consume(counters, k, n, caps)

    // Меж-потоковый дедуп ДИРЕКТА: один человек может попасть в НЕСКОЛЬКО потоков за цикл
    // (подписался + лайкнул + прокомментировал) → раньше получал ОТДЕЛЬНЫЙ директ из каждого
    // потока/кампании = спам-сигнал бана. Теперь — не более ОДНОГО директа на человека за цикл
    // (первый поток выигрывает). Лайк/подписка/сторис/ответ идемпотентны и не дедупятся.
    const dmedThisCycle = new Set<string>()
    const alreadyDmed = (u?: string) => Boolean(u) && dmedThisCycle.has(u!.toLowerCase())
    const markDmed = (u?: string) => { if (u) dmedThisCycle.add(u.toLowerCase()) }

    // ── Проверка подписки БЕЗ обращения к основному ──────────────────────────
    // Подписчиков/подписки основного тянет скрейпер-API (публичные данные) → гейт = принадлежность
    // множеству. Так проверка «подписан ли на нас» не грузит основной аккаунт вообще.
    let gateFollowers: Set<string> | null = null   // кто подписан на основной (followed_by)
    let gateFollowing: Set<string> | null = null   // на кого подписан основной (для mutual)
    // Свежие подписки ИЗ СОБСТВЕННЫХ уведомлений (self-events, type=follow) — заполняется в детекте
    // ниже. Это АВТОРИТЕТНЕЕ скрейпа: человек, который только что подписался (и тут же
    // прокомментировал), в скрейп/снапшот ещё не попал (лаг IG/кеш API) → гейт ложно решал «не
    // подписан» и слал приглашение «подпишись» уже подписавшемуся. Засеиваем гейт этими pk.
    const selfFollowedPks = new Set<string>()
    const ensureGateFollowers = async (): Promise<Set<string>> => {
      if (gateFollowers) return gateFollowers
      // Стартуем с накопленного снапшота подписчиков + добираем свежих через API
      const set = extractKnownPks(account.snapshots.find((sn) => sn.type === 'FOLLOWERS')?.data)
      try {
        const { followers } = await scrapeFollowers(account.username, GATE_FOLLOWERS_SCAN)
        followers.forEach((f) => set.add(String(f.pk)))
      } catch { /* не смогли добрать — используем что есть (гейт ошибётся в безопасную сторону) */ }
      selfFollowedPks.forEach((pk) => set.add(pk))   // только что подписавшиеся (из наших уведомлений) — точно followed_by
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
    // Возвращает МНОЖЕСТВО pk целей, по которым действие ТРАНЗИЕНТНО не удалось (таймаут визита/
    // сеть/воркер). Их снапшот НЕ пометит «известными» → они добьются в следующем цикле (§1.3/§2.3:
    // «не пропускать ни один аккаунт»). Сама функция НЕ бросает — сбой одной цели не роняет ни поток,
    // ни весь цикл (иначе таймаут в потоке подписчиков убивал детект комментариев/сторис).
    const handleTargets = async (
      targets: { pk: string; username: string }[],
      triggersForStream: typeof triggers,
      withGate: boolean,
    ): Promise<Set<string>> => {
      const failedPks = new Set<string>()
      for (const trigger of triggersForStream) {
        const actions = (trigger.actions ?? []) as any[]
        const isOn = (a: any) => a && a.enabled !== false
        const msgAction = actions.find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
        const doFollowT = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
        const likeAct = actions.find((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))
        const doLikeT = Boolean(likeAct)
        const storiesAct = actions.find((a: any) => a.type === 'VIEW_STORIES' && isOn(a))
        if (!msgAction?.templates?.[0] && !doFollowT && !doLikeT && !storiesAct) continue
        // §13.10 — сколько постов лайкать (1..10) / сколько кадров сторис смотреть (1..20).
        const likeCount = Math.min(10, Math.max(1, Number(likeAct?.count) || 1))
        const storyCount = Math.min(20, Math.max(1, Number(storiesAct?.count) || 4))

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
          // Меж-потоковый дедуп: этому человеку директ в этом цикле уже уходил → не дублируем
          // (проверяем ДО use('dm'), чтобы не списать бюджет на пропущенный директ).
          if (dmAllowed && alreadyDmed(target.username)) dmAllowed = false

          // ВСЕ действия делает основной (лимиты counters); черновой только парсил цель
          const willDM = dmAllowed && use('dm')
          if (willDM) markDmed(target.username)
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
          // Прозрачность на ручной проверке: почему настроенное действие НЕ выполнилось — почти
          // всегда это ДНЕВНОЙ ЛИМИТ (у молодого аккаунта прогрев ужимает подписки до 2–7/сутки),
          // а не баг. Иначе «подписался только директ» выглядит как поломка (жалоба пользователя).
          if (isManual) {
            const capped: string[] = []
            if (doFollowT && !willFollow && !fallbackFollow) capped.push('подписка')
            if (doLikeT && !willLike && !fallbackLike) capped.push('лайк')
            if (Boolean(storiesAct) && !willStory) capped.push('сторис')
            if (dmAllowed && !willDM) capped.push('директ')
            if (capped.length) await prisma.log.create({ data: { accountId: account.id, level: 'INFO', message: `@${target.username}: не выполнено из-за дневного лимита (${capped.join(', ')}) — сбросится завтра; у молодого аккаунта лимиты ниже (прогрев).` } }).catch(() => null)
          }
          if (!willDM && !willFollow && !willLike && !willStory) { s.limited = (s.limited ?? 0) + 1; continue }

          let text = willDM ? template.replace(/\{\{username\}\}/gi, target.username) : ''
          if (willDM && link?.enabled && link.url) {
            const lt = String(link.text ?? '').replace(/\{\{username\}\}/gi, target.username)
            text += `\n\n${lt ? lt + ': ' : ''}${link.url}`
          }

          const job = {
            browserState: account.browserState,
            engine: 'browser' as const, ownerUsername: account.username, accountId: account.id,
            locale: account.locale ?? undefined, timezoneId: account.timezoneId ?? undefined,
            triggerId: trigger.id, triggerName: trigger.name, triggerType: trigger.triggerType,
            followerPk: target.pk, followerUsername: target.username,
            text: text.trim(), image: willDM ? image : undefined,
            doFollow: willFollow, doLike: willLike, likeCount,
            viewStories: willStory, storyLike: Boolean(storiesAct?.like), storyCount, proxy: account.proxy,
            fallbackFollow, fallbackLike,
            // Все действия выполняет основной своей браузерной сессией (browserState).
          }

          // Ручная «Проверить подписчиков» (isManual) — выполняем ДЕЙСТВИЕ СРАЗУ (inline), а не
          // в отложенную очередь: пользователь жмёт кнопку и ждёт результат ЗДЕСЬ, и это не
          // зависит от фонового dm-воркера (если он в проде не крутится — очередь молча копится,
          // «0 срабатываний»). Авто-поллинг (много аккаунтов) по-прежнему через очередь с пейсингом.
          try {
            if (dmQueue && !isManual) {
              await dmQueue.add('send', job, {
                // BullMQ запрещает ':' в custom jobId → разделитель '_' (id — cuid/число, без '_').
                jobId: `dm_${account.id}_${trigger.id}_${target.pk}`,
                delay: Math.round(cursor), attempts: 1,
                removeOnComplete: true, removeOnFail: 100,
              })
              cursor += nextGap()
            } else {
              await runFollowerActionsInline(job)
              await randDelay(isManual ? 4 : 40, isManual ? 12 : 90)
            }
            s.dmsQueued++
          } catch (e: any) {
            // Транзиентный сбой (таймаут визита/сеть/воркер) — НЕ теряем цель и НЕ роняем поток/цикл:
            // помечаем на ретрай (снапшот не зафиксирует её «известной») и идём дальше.
            failedPks.add(target.pk)
            await prisma.log.create({ data: { accountId: account.id, level: 'ERROR', message: `Действие для @${target.username} не выполнено — повторим автоматически.` } }).catch(() => null)
          }
        }
      }
      return failedPks
    }

    // Число подписчиков растёт из САМИХ уведомлений (self-events): каждый НОВЫЙ подписчик, впервые
    // замеченный в потоке ниже, прибавляется к followersGained → к сохранённому счётчику. HikerAPI/
    // апишки/черновые для метрики больше НЕ используются (по решению — их нет в проекте).
    let realFollowers: number | undefined          // итог для записи (выставляется, если счётчик менялся)
    let followersHistory: any = undefined
    let followersGained = 0                         // сколько НОВЫХ подписчиков замечено в этом цикле
    const today = new Date().toISOString().slice(0, 10)
    const histNow = Array.isArray(account.followersHistory) ? (account.followersHistory as any[]) : []
    // Признак «список подписчиков скрыт» (verified/приватный) — заполняется парсингом черновым ниже.
    let parseBlocked: boolean | undefined
    // История подписчиков (одна точка в день) строится ПОСЛЕ потоков — realFollowers выставляется
    // из followersGained (см. ниже, перед сохранением аккаунта).
    const buildFollowersHistory = () => {
      if (realFollowers === undefined) return
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
      // ── plan4 (Фаза D): ЕДИНСТВЕННЫЙ источник детекта — СВОИ уведомления (news/inbox) ──
      // Один вызов на цикл под per-account локом (§4.8); события раскладываем по потокам
      // (follow/like/comment). Черновые/HikerAPI в детекте НЕ вызываются (мёртвый задел).
      // liveState/лок/re-read перенесены СЮДА (наверх), т.к. детект теперь тоже требует сессии.
      let originalState = account.browserState
      let liveState: object | undefined = (account.browserState as object) ?? undefined
      let skipBrowserSection = false
      // §1.1 — «сессия мертва» (нет sessionid → нужен повторный вход). Ловим на любом браузерном
      // шаге (авто-приём / уведомления / прогрев) и один раз помечаем аккаунт «Требует входа».
      let sessionDead = false
      let notifReadError: string | null = null   // реальная причина сбоя чтения уведомлений (для прозрачности ручной проверки)
      const SESSION_DEAD = (m: string) => /login_required|сессия недейств|нужен повторный вход|checkpoint|подтвердите вход/i.test(String(m || ''))
      let selfFollows: { pk: string; username: string }[] = []
      let selfLikes: { pk: string; username: string }[] = []
      let selfComments: { pk: string; user_pk: string; username: string; text: string; media_id: string }[] = []
      if (account.browserState) {
        browserLockHeld = await acquireBrowserLock(prisma, account.id)
        if (browserLockHeld) {
          const fresh = await prisma.instagramAccount.findUnique({ where: { id: account.id }, select: { browserState: true } }).catch(() => null)
          if (fresh?.browserState) { originalState = fresh.browserState; liveState = fresh.browserState as object }
          // §13.11 — приватный аккаунт: сперва подтвердить входящие заявки на подписку, иначе
          // новый «подписчик» остаётся заявкой и триггер «Новая подписка» по нему не сработает.
          // Идёт ДО чтения уведомлений, чтобы только что принятый подписчик попал в события follow.
          if (account.autoAcceptFollowers) {
            try {
              const ar = await browserAcceptFollowRequests({ storageState: liveState as object, proxy: account.proxy ?? undefined, username: account.username, locale: account.locale ?? undefined, timezoneId: account.timezoneId ?? undefined }, ACCEPT_REQUESTS_LIMIT)
              if (ar.browserState) liveState = ar.browserState
              if (ar.approved?.length) await prisma.log.create({ data: { accountId: account.id, level: 'SUCCESS', message: `Приняты заявки в подписчики: ${ar.approved.map((u) => '@' + u.username).join(', ')} (из ${ar.pendingCount} ожидавших)` } }).catch(() => null)
              else if (isManual) await prisma.log.create({ data: { accountId: account.id, level: 'INFO', message: `Заявок в подписчики нет (ожидающих: ${ar.pendingCount})` } }).catch(() => null)
            } catch (e: any) {
              const m = String(e?.message ?? e)
              if (SESSION_DEAD(m)) sessionDead = true   // мёртвая сессия — сообщим один раз ниже
              else await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: 'Не удалось принять заявки в подписчики — временный сбой, повторим автоматически.' } }).catch(() => null)
            }
          }
          try {
            const se = await browserSelfEvents({ storageState: liveState as object, proxy: account.proxy ?? undefined, username: account.username, locale: account.locale ?? undefined, timezoneId: account.timezoneId ?? undefined }, { amount: SELF_EVENTS_AMOUNT })
            if (se.browserState) liveState = se.browserState
            if (se.error) {
              if (SESSION_DEAD(se.error)) sessionDead = true   // мёртвая сессия — сообщим один раз ниже
              else {
                notifReadError = se.error
                await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: isManual ? `Уведомления не прочитаны: ${se.error}` : 'Уведомления не прочитаны — временный сбой, повторим автоматически.' } }).catch(() => null)
              }
            }
            const evs = se.events ?? []
            selfFollows = evs.filter((e) => e.type === 'follow').map((e) => ({ pk: e.pk, username: e.username }))
            selfFollows.forEach((f) => selfFollowedPks.add(String(f.pk)))   // засеиваем гейт: только что подписавшиеся точно followed_by
            selfLikes = evs.filter((e) => e.type === 'like').map((e) => ({ pk: e.pk, username: e.username }))
            selfComments = evs.filter((e) => e.type === 'comment').map((e) => ({ pk: `${e.pk}_${e.media_id ?? ''}`, user_pk: e.pk, username: e.username, text: e.text ?? '', media_id: e.media_id ?? '' }))
            // Диагностика (только ручная проверка, чтобы не засорять авто-логи): что реально
            // прочитано из уведомлений. Если тут «подписки 0», а подписчик точно новый —
            // проблема в ЧТЕНИИ/разборе уведомлений (self-events), а не в действиях.
            if (isManual) await prisma.log.create({ data: { accountId: account.id, level: 'INFO', message: `Уведомления прочитаны: всего ${evs.length} (подписки ${selfFollows.length} · лайки ${selfLikes.length} · комменты ${selfComments.length})` } }).catch(() => null)
          } catch (e: any) {
            const m = String(e?.message ?? e)
            if (SESSION_DEAD(m)) sessionDead = true   // мёртвая сессия — сообщим один раз ниже
            else {
              notifReadError = m
              await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: isManual ? `Уведомления не прочитаны: ${m}` : 'Уведомления не прочитаны — временный сбой, повторим автоматически.' } }).catch(() => null)
            }
          }
        } else {
          skipBrowserSection = true
          await prisma.log.create({ data: { accountId: account.id, level: 'INFO', message: 'Аккаунт занят отправкой сообщений — проверка отложена до следующего цикла.' } }).catch(() => null)
        }
      }
      // §1.1 — сессия мертва: помечаем аккаунт «Требует входа» (видно на карточке + кнопка «Войти
      // заново») и НЕ пытаемся действовать этим аккаунтом в этом цикле (всё равно упадёт).
      if (sessionDead) {
        await prisma.instagramAccount.update({ where: { id: account.id }, data: { status: 'CHALLENGE', lastChecked: new Date() } }).catch(() => null)
        await prisma.log.create({ data: { accountId: account.id, level: 'ERROR', message: 'Аккаунт вышел из сессии Instagram — войдите заново (кнопка «Войти заново» на карточке аккаунта).' } }).catch(() => null)
      }
      const canDetect = browserLockHeld && !skipBrowserSection && !sessionDead

      // ── Поток подписчиков (детект из self-events: type=follow) ───────────────
      if (followerTriggers.length && canDetect) {
        {
          const followers = selfFollows
          const snapFollowers = account.snapshots.find((sn) => sn.type === 'FOLLOWERS')
          const hadBaseline = Boolean(snapFollowers)
          const knownPks = extractKnownPks(snapFollowers?.data)
          const prevKnownForCount = new Set(knownPks)   // до selectTargets — для счётчика новых подписчиков
          // Первая проверка (нет снапшота) — только фиксируем базу, НЕ обрабатываем существующих
          // подписчиков (иначе на новом аккаунте будет массовая рассылка → бан).
          const { fresh, process } = selectTargets(followers, knownPks, hadBaseline, (f) => String(f.pk), newCap)

          if (isManual) {
            const msg = !hadBaseline
              ? `Первый проход (базлайн): записано ${followers.length} подписок, действий 0 — новые ловятся со следующей проверки. Чтобы сработать на текущих — нажмите «Сбросить».`
              : fresh.length === 0
                ? `Новых подписок нет (в уведомлениях ${followers.length}, все уже обработаны).`
                : `Новых подписок: ${fresh.length}, обрабатываю ${process.length}.`
            await prisma.log.create({ data: { accountId: account.id, level: 'INFO', message: msg } }).catch(() => null)
          }

          s.totalFollowers = followers.length
          s.newFollowers = fresh.length

          // Подписчик уже подписан на нас — гейт не нужен
          const failed = await handleTargets(
            process.map((f) => ({ pk: String(f.pk), username: f.username })),
            followerTriggers, false,
          )
          // §2.3 — транзиентно-провалившиеся цели НЕ фиксируем «известными»: добьются в след. цикле.
          failed.forEach((pk) => knownPks.delete(pk))

          // Счётчик подписчиков: считаем НОВЫЕ pk, впервые попавшие в «известные» этот цикл (после
          // снятия провалившихся) — каждый новый подписчик учитывается РОВНО ОДИН раз (устойчиво к
          // дрип-обработке и ретраям). На базлайне (первый проход) НЕ считаем — там лишь фиксируется
          // текущая база, а не «новые».
          if (hadBaseline) {
            let gained = 0
            knownPks.forEach((pk) => { if (!prevKnownForCount.has(pk)) gained++ })
            if (gained > 0) followersGained += gained
          }

          // Снапшот сохраняем ПОСЛЕ действий (без провалившихся) — иначе таймаут визита терял цель.
          await prisma.$transaction([
            prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'FOLLOWERS' } }),
            prisma.snapshot.create({ data: { accountId: account.id, type: 'FOLLOWERS', data: capPks(knownPks, SNAPSHOT_MAX) } }),
          ])
        }
      }

      // ── Поток лайков (отдельный кулдаун) ─────────────────────────────────
      const snapLikesMeta = account.snapshots.find((sn) => sn.type === 'LIKES')
      const likeElapsed = snapLikesMeta ? Date.now() - new Date(snapLikesMeta.createdAt).getTime() : Infinity
      if (likeTriggers.length && canDetect && (isManual || likeElapsed >= LIKE_COOLDOWN_MS)) {
        {
          const likers = selfLikes
          const hadBaseline = Boolean(snapLikesMeta)
          const knownL = extractKnownPks(snapLikesMeta?.data)
          const { fresh, process } = selectTargets(likers, knownL, hadBaseline, (l) => String(l.pk), newCap)

          s.newLikers = fresh.length
          // Гейт: лайкнувший может быть не подписан → DM пропускается (лайк/подписка/сторис остаются)
          const failed = await handleTargets(
            process.map((l) => ({ pk: String(l.pk), username: l.username })),
            likeTriggers, true,
          )
          failed.forEach((pk) => knownL.delete(pk))   // §2.3 — провалившиеся добьются в след. цикле

          await prisma.$transaction([
            prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'LIKES' } }),
            prisma.snapshot.create({ data: { accountId: account.id, type: 'LIKES', data: capPks(knownL, SNAPSHOT_MAX) } }),
          ])
        }
      }

      // ── Поток стори-событий: ответы на мои сторис + упоминания (сессией основного) ──
      const snapStoryMeta = account.snapshots.find((sn) => sn.type === 'STORY')
      const storyElapsed = snapStoryMeta ? Date.now() - new Date(snapStoryMeta.createdAt).getTime() : Infinity
      // Стори-события видит только ОСНОВНОЙ (его личка) — читаем инбокс своим Chromium под ТЕМ ЖЕ
      // локом (§4.8), что и self-events выше. liveState/originalState/skipBrowserSection/лок —
      // уже взяты в начале цикла (наверху). Здесь только используем canDetect.
      const useBrowserForStories = canDetect
      if (storyTriggers.length && useBrowserForStories && (isManual || storyElapsed >= STORY_COOLDOWN_MS)) {
        let events: Array<{ pk?: string | number; user_pk: string | number; username: string }> = []
        try {
          const r = await browserStoryEvents(
            { storageState: account.browserState as object, proxy: account.proxy ?? undefined, username: account.username, locale: account.locale ?? undefined, timezoneId: account.timezoneId ?? undefined },
            STORY_EVENTS_AMOUNT,
          )
          events = r.events ?? []
          // Сессия «дозрела» за чтение инбокса — сохраняем обновлённый storageState
          // и переносим в liveState (§4.8), чтобы прогрев/финальный апдейт не откатили.
          if (r.browserState) { liveState = r.browserState; await prisma.instagramAccount.update({ where: { id: account.id }, data: { browserState: r.browserState as any } }).catch(() => null) }
        } catch (e: any) {
          await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: `Стори-инбокс (браузер) не прочитан: ${String(e?.message ?? e).slice(0, 120)}` } }).catch(() => null)
        }
        const hadBaseline = Boolean(snapStoryMeta)
        const knownS = extractKnownPks(snapStoryMeta?.data)
        const { fresh, process } = selectTargets(events, knownS, hadBaseline, (e) => (e.pk ? String(e.pk) : ''), newCap)

        s.newStoryEvents = fresh.length
        const failed = await handleTargets(
          process.map((e) => ({ pk: String(e.user_pk), username: e.username })),
          storyTriggers, true,
        )
        // §2.3 — снапшот стори ключуется по pk СОБЫТИЯ, а цели — по user_pk; провалившиеся события
        // (их user_pk в failed) убираем из «известных» по pk события, чтобы добить в след. цикле.
        process.forEach((e) => { if (e.pk && failed.has(String(e.user_pk))) knownS.delete(String(e.pk)) })

        await prisma.$transaction([
          prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'STORY' } }),
          prisma.snapshot.create({ data: { accountId: account.id, type: 'STORY', data: capPks(knownS, SNAPSHOT_MAX) } }),
        ])
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
      const useBrowserForComments = canDetect
      if (commentTriggers.length && useBrowserForComments && (isManual || commentElapsed >= COMMENT_COOLDOWN_MS)) {
        {
        const comments = selfComments   // plan4: комментарии к моим постам из self-events (type=comment)
        const hadBaseline = Boolean(snapCommentsMeta)
        const knownC = extractKnownPks(snapCommentsMeta?.data)
        // Первая проверка (нет снапшота) — только фиксируем базу, НЕ реагируем на старые комменты,
        // иначе бот разом ответит на все существующие. Реагируем только на появившиеся после базы.
        const { fresh, process: toProcess } = selectTargets(comments, knownC, hadBaseline, (c) => String(c.pk), newCap)
        const failedComments = new Set<string>()   // §2.3 — транзиентно провалившиеся комменты (ретрай)

        if (isManual) {
          const cmsg = !hadBaseline
            ? `Первый проход (базлайн): записано ${comments.length} комментариев, действий 0 — новые ловятся со следующей проверки.`
            : fresh.length === 0
              ? `Новых комментариев нет (в уведомлениях ${comments.length}, все уже обработаны).`
              : `Новых комментариев: ${fresh.length}, обрабатываю ${toProcess.length}.`
          await prisma.log.create({ data: { accountId: account.id, level: 'INFO', message: cmsg } }).catch(() => null)
        }

        s.totalComments = comments.length
        s.newComments = fresh.length

        // Браузерная сессия «дозревает» между действиями — трекаем локально, пишем в БД
        // после каждой обработанной пары (коммент × триггер), как в runFollowerActionsInline.
        let cState: object | undefined = liveState
        const bctx = () => ({ storageState: cState as object, proxy: account.proxy ?? undefined, username: account.username, locale: account.locale ?? undefined, timezoneId: account.timezoneId ?? undefined })
        let cmtDmTried = 0, cmtDmOk = 0   // §4.6 — исход доставки директов коммент-потока (запишем разом под локом)

        for (const c of toProcess) {
          if (sessionDead) break   // аккаунт остановлен (бан/челлендж) — не обрабатываем дальше в этом цикле
          let firedForComment = false
          try {
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
            const likeAct = actions.find((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))
            const doLikePosts = Boolean(likeAct)
            const likeCmt = actions.some((a: any) => a.type === 'LIKE_COMMENT' && isOn(a))
            const doFollow = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
            const storiesAct = actions.find((a: any) => a.type === 'VIEW_STORIES' && isOn(a))
            // §13.10 — сколько постов лайкать (1..10) / кадров сторис смотреть (1..20).
            const likeCount = Math.min(10, Math.max(1, Number(likeAct?.count) || 1))
            const storyCount = Math.min(20, Math.max(1, Number(storiesAct?.count) || 4))

            let fired = false
            let gatedStop = false
            const errors: string[] = []
            const impossible: string[] = []                // §13.10 — 0 постов/0 сторис (не ошибка)
            const incFired: Record<string, number> = {}   // «сработало» (попытки)
            const incDone: Record<string, number> = {}    // «выполнено» (успехи)
            // Ответ в комментах требует URL поста. media_id берётся из уведомления (self-events);
            // если его нет — НЕ строим битый `/p//` (навигация туда всегда проваливала реплай),
            // а честно помечаем реплай невозможным (см. лог ниже).
            const postUrl = c.media_id ? mediaPostUrl(c.media_id) : ''

            // Проверка подписки: если автор НЕ проходит гейт — только коммент-приглашение, стоп
            if (gateCfg) {
              const ok = await passesGateFor(c.user_pk, gateCfg.mode)

              if (!ok) {
                const gateBase = gateCfg.inviteText.replace(/\{\{username\}\}/gi, c.username)
                // Адресуем ответ автору коммента через @упоминание (иначе это «общий» коммент к посту,
                // а не ответ конкретному человеку — жалоба пользователя). Тред-ответ = отдельная правка воркера.
                const gateText = gateBase && !gateBase.includes('@' + c.username) ? `@${c.username} ${gateBase}` : gateBase
                if (gateText && !postUrl) {
                  errors.push('коммент-приглашение: не удалось определить пост для ответа (в уведомлении нет media_id)')
                } else if (gateText && use('comment')) {
                  incFired.comment = (incFired.comment || 0) + 1
                  try {
                    { const r = await browserReply(bctx(), postUrl, gateText); if (r.browserState) cState = r.browserState; if (!r.ok) throw new Error(r.error ?? 'не отправлен') }
                    fired = true; incDone.comment = (incDone.comment || 0) + 1
                  }
                  catch (e: any) { errors.push(`коммент-приглашение: ${e.message}`) }
                } else if (gateText) { s.limited = (s.limited ?? 0) + 1 }
                gatedStop = true
              }
            }

            // Подписан (или проверки нет): §13.9 — ФИКСИРОВАННЫЙ порядок действий с паузами между
            // ними + дневной лимит: подписка → лайк → коммент-ответ → сторис → ДИРЕКТ (последним).
            if (!gatedStop) {
              // 1) Подписка — первой (на случай закрытого аккаунта / SMS при взаимной подписке).
              if (doFollow) {
                if (use('follow')) {
                  incFired.follow = (incFired.follow || 0) + 1
                  await randDelay(2, 5)
                  try {
                    { const r = await browserFollow(bctx(), c.username); if (r.browserState) cState = r.browserState; if (!r.ok) throw new Error(r.error ?? 'не подписан') }
                    fired = true; incDone.follow = (incDone.follow || 0) + 1
                  }
                  catch (e: any) { errors.push(`подписка: ${e.message}`) }
                } else { errors.push('подписка: дневной лимит подписок исчерпан') }
              }
              // 2) Лайк постов автора — §13.10: ОДИН бюджет на цель (не по постам), лайкаем до N;
              //    0 постов у автора = НЕВОЗМОЖНО (не ошибка).
              if (doLikePosts && use('like')) {
                incFired.like = (incFired.like || 0) + 1
                await randDelay(2, 5)
                try {
                  const r = await browserLike(bctx(), c.username, likeCount)
                  if (r.browserState) cState = r.browserState
                  if (r.ok) { fired = true; incDone.like = (incDone.like || 0) + 1 }
                  else if ((r as any).impossible) impossible.push('лайк: у аккаунта нет постов')
                  else throw new Error(r.error ?? 'не лайкнуто')
                }
                catch (e: any) { errors.push(`лайк постов: ${e.message}`) }
              }
              if (likeCmt && use('like')) {
                incFired.like = (incFired.like || 0) + 1
                await randDelay(1, 3)
                // LIKE_COMMENT — legacy-тип (лайк КОНКРЕТНОГО коммента): браузерным движком не
                // реализован (нужен клик по коммент-нити, [A4]). Новые кампании его не создают.
                errors.push('лайк коммента: не поддерживается (legacy-тип, используйте «Лайк постов»)')
              }
              // 3) Ответ в комментариях под МОИМ постом.
              if (reply) {
                const variants: string[] = (reply.replies ?? []).filter(Boolean)
                if (!variants.length) {
                  errors.push('ответ в комментах: не задан ни один вариант ответа (добавьте текст в кампании)')
                } else if (!postUrl) {
                  errors.push('ответ в комментах: не удалось определить пост для ответа (в уведомлении нет media_id)')
                } else if (use('comment')) {
                  incFired.comment = (incFired.comment || 0) + 1
                  const pickBase = variants[Math.floor(Math.random() * variants.length)].replace(/\{\{username\}\}/gi, c.username)
                  // Адресуем ответ автору коммента через @упоминание (не «общий» коммент к посту).
                  const pick = pickBase.includes('@' + c.username) ? pickBase : `@${c.username} ${pickBase}`
                  try {
                    { const r = await browserReply(bctx(), postUrl, pick); if (r.browserState) cState = r.browserState; if (!r.ok) throw new Error(r.error ?? 'не отправлен') }
                    fired = true; incDone.comment = (incDone.comment || 0) + 1
                  }
                  catch (e: any) { errors.push(`ответ: ${e.message}`) }
                } else { errors.push('ответ в комментах: дневной лимит комментариев исчерпан') }
              }
              // 4) Сторис — §13.10: смотрим до N кадров; 0 активных сторис = НЕВОЗМОЖНО (не ошибка).
              if (storiesAct && use('story')) {
                incFired.story = (incFired.story || 0) + 1
                await randDelay(3, 7)
                try {
                  const r = await browserStories(bctx(), c.username, Boolean(storiesAct.like), storyCount)
                  if (r.browserState) cState = r.browserState
                  if (r.ok) { fired = true; incDone.story = (incDone.story || 0) + 1 }
                  else if ((r as any).impossible) impossible.push('сторис: нет активных сторис')
                  else throw new Error(r.error ?? 'не просмотрено')
                }
                catch (e: any) { errors.push(`сторис: ${e.message}`) }
              }
              // 5) ДИРЕКТ — последним, после «прогрева» цели. Идёт НЕЗАВИСИМО от исхода прошлых
              //    действий. Меж-потоковый дедуп: если директ этому автору в цикле уже уходил
              //    (напр. он же новый подписчик) — не дублируем. Проверка ДО use.
              if (dm?.templates?.[0] && !alreadyDmed(c.username) && use('dm')) {
                markDmed(c.username)
                incFired.dm = (incFired.dm || 0) + 1
                await randDelay(3, 8)
                let text = String(dm.templates[0]).replace(/\{\{username\}\}/gi, c.username)
                if (dm.link?.enabled && dm.link.url) {
                  const lt = String(dm.link.text ?? '').replace(/\{\{username\}\}/gi, c.username)
                  text += `\n\n${lt ? lt + ': ' : ''}${dm.link.url}`
                }
                try {
                  const r = await browserDM(bctx(), c.username, text.trim(), dm.image?.enabled ? dm.image.url : undefined)
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
              }
            }

            cmtDmTried += incFired.dm || 0   // §4.6 — учёт доставки директов коммент-потока
            cmtDmOk += incDone.dm || 0
            const attempted = Object.keys(incFired).length > 0
            const hardError = errors.length > 0
            // §13.10 — «невозможно» (0 постов/0 сторис) не ошибка; засчитываем срабатывание, если
            // что-то выполнено ИЛИ единственная помеха — невозможность действия (без реальных ошибок).
            const firedOrImpossible = fired || (impossible.length > 0 && !hardError)
            if (attempted) {
              const parts: string[] = []
              if (errors.length) parts.push(errors.join('; '))
              if (impossible.length) parts.push(`невозможно: ${impossible.join('; ')}`)
              const tail = parts.length ? ` (${parts.join('; ')})` : ''
              const level = fired ? (hardError ? 'WARN' : 'SUCCESS') : (hardError ? 'ERROR' : 'WARN')
              const cmtMeta = logMeta('NEW_COMMENT', fired ? Object.keys(incDone) : [])
              const message = fired
                ? `Коммент @${c.username} → «${trigger.name}»${gatedStop ? ' (не подписан → приглашение)' : ''}${cmtMeta}${tail}`
                : (hardError
                  ? `Коммент @${c.username} → «${trigger.name}»: действия не выполнены${cmtMeta}${tail}`
                  : `Коммент @${c.username} → «${trigger.name}»: действие невозможно${cmtMeta}${tail}`)
              await Promise.all([
                prisma.log.create({ data: { accountId: account.id, level, message } }),
                // fireCount — при выполненном действии ИЛИ «невозможно» без ошибок (§13.10).
                prisma.triggerRule.update({ where: { id: trigger.id }, data: { ...(firedOrImpossible ? { fireCount: { increment: 1 } } : {}), stats: await mergeStats(trigger.id, incFired, incDone) } }),
                ...(useBrowserForComments && cState ? [prisma.instagramAccount.update({ where: { id: account.id }, data: { browserState: cState as any } })] : []),
              ])
              if (firedOrImpossible) { s.commentActions++; firedForComment = true }
            }
          }
          } catch (e: any) {
            const m = String(e?.message ?? e)
            failedComments.add(String(c.pk))   // не теряем цель — добьётся в след. цикле
            const st = statusFromError(m)        // CHALLENGE/PAUSED = бан/челлендж/лимит Instagram
            if (st) {
              // Реальное ограничение/бан аккаунта — останавливаем аккаунт и прекращаем цикл (не долбим).
              await prisma.instagramAccount.update({ where: { id: account.id }, data: { status: st as any } }).catch(() => null)
              sessionDead = true
              await prisma.log.create({ data: { accountId: account.id, level: 'ERROR', message: st === 'CHALLENGE' ? 'Аккаунт требует подтверждения входа — войдите заново.' : 'Instagram временно ограничил аккаунт — бот сделал паузу, чтобы не навредить.' } }).catch(() => null)
            } else {
              // Транзиентный сбой (таймаут/сеть) — НЕ роняем цикл: прогрев/сохранение сессии выполнятся.
              await prisma.log.create({ data: { accountId: account.id, level: 'ERROR', message: `Ответ на комментарий @${c.username} не выполнен — повторим автоматически.` } }).catch(() => null)
            }
          }
          // [A2] Пауза МЕЖДУ комментами (как inline-путь потока подписчиков, randDelay 40–90с):
          // не выпускать серию директов/подписок/лайков залпом на весь батч авторов за один
          // поллинг — это топ-сигнал бана. Пауза только если по комменту реально что-то сработало.
          if (firedForComment) await randDelay(isManual ? 8 : 40, isManual ? 20 : 90)
        }
        // §4.8 — накопленное дозревание сессии за поток комментов переносим в liveState
        // (его же прогреет и запишет финальный апдейт — без отката к «старому» стейту).
        liveState = cState
        // §4.6 — исход доставки директов коммент-потока в дневной счётчик (под browserLock — гонки нет).
        if (cmtDmTried) await recordDelivery(prisma, account.id, cmtDmTried, cmtDmOk, Date.now())
        // §2.3 — снапшот комментов сохраняем ПОСЛЕ обработки (без провалившихся) — не теряем цели.
        failedComments.forEach((pk) => knownC.delete(pk))
        await prisma.$transaction([
          prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'COMMENTS' } }),
          prisma.snapshot.create({ data: { accountId: account.id, type: 'COMMENTS', data: capPks(knownC, SNAPSHOT_MAX) } }),
        ])
        }
      }

      // ── Прогрев + keep-alive браузерной сессии (по запросу пользователя) ──────────
      // Периодический живой заход с ТОГО ЖЕ прокси: сессия дозревает (свежий browserState),
      // аккаунт греется, Instagram видит активность и не «остужает» сессию. Гейт по кулдауну
      // (метка limits.lastWarmup) — не на каждый поллинг. Сбой прогрева НЕ роняет цикл.
      // Пропускаем прогрев, если сессия уже помечена мёртвой (§1.1) — иначе он упадёт тем же
      // login_required и продублирует сообщение; аккаунт уже помечен «Требует входа».
      if (liveState && !skipBrowserSection && !sessionDead) {
        const lastWarmup = Number((account.limits as any)?.lastWarmup || 0)
        if (isManual || Date.now() - lastWarmup >= WARMUP_KEEPALIVE_MS) {
          try {
            // §4.8 — прогрев стартует с САМОГО свежего liveState (после стори/комментов),
            // а не со «старого» account.browserState → не откатывает дозревание сессии.
            const w = await browserWarmup(liveState, proxy, account.username, account.locale ?? undefined, account.timezoneId ?? undefined)
            if (w.browserState) liveState = w.browserState
            ;(counters as any).lastWarmup = Date.now()
            if (!w.alive) {
              await prisma.log.create({ data: { accountId: account.id, level: 'WARN', message: 'Не удалось подтвердить сессию при разогреве — если повторится, войдите в аккаунт заново.' } }).catch(() => null)
            }
          } catch { /* прогрев не критичен для цикла */ }
        }
      }

      // Счётчик подписчиков += замеченные этим циклом новые подписчики (self-events). Пишем только
      // при реальном приросте, чтобы не трогать поле зря.
      if (followersGained > 0) realFollowers = (account.followers ?? 0) + followersGained
      buildFollowersHistory()   // одна точка истории в день (значение = актуальный счётчик)
      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { lastChecked: new Date(), errorCount: 0, limits: counters as any, ...(liveState && liveState !== originalState ? { browserState: liveState as any } : {}), ...(realFollowers !== undefined ? { followers: realFollowers, followersHistory } : {}), ...(parseBlocked !== undefined ? { parseBlocked } : {}) },
      })
      // Ручная проверка — ПОНЯТНЫЙ итог по аккаунту (чтобы «Проверить сейчас» не был чёрным ящиком:
      // видно, что проверка ДОШЛА до аккаунта и что именно случилось — детект отложен / сбой чтения /
      // сколько новых событий). Пишем всегда на isManual, даже когда нового ничего нет.
      if (isManual) {
        let outcome: string
        if (!canDetect) outcome = skipBrowserSection ? 'сессия занята другим процессом — детект отложен' : 'детект не выполнен'
        else if (notifReadError) outcome = `не удалось прочитать уведомления (${notifReadError})`
        else outcome = `уведомления прочитаны (подписки ${selfFollows.length}, комменты ${selfComments.length}${selfLikes.length ? `, лайки ${selfLikes.length}` : ''}); новые — обработаны, старые пропущены`
        await prisma.log.create({ data: { accountId: account.id, level: notifReadError ? 'WARN' : 'INFO', message: `Ручная проверка завершена — ${outcome}.` } }).catch(() => null)
      }
      summary.push(s)
    } catch (e: any) {
      // Предохранитель: challenge/бан/ограничение → останавливаем аккаунт, чтобы не долбить его
      const brk = statusFromError(e.message)
      const nextErrors = (account.errorCount ?? 0) + 1
      const data: any = { errorCount: { increment: 1 }, limits: counters as any, lastChecked: new Date() }
      if (brk) data.status = brk
      else if (nextErrors >= ERROR_PAUSE_THRESHOLD) data.status = 'PAUSED'
      // ⚠️ КРИТИЧНО: и update, и log ОБЯЗАТЕЛЬНО с .catch — иначе сбой БД в обработчике ошибки
      // одного аккаунта пробросится во внешний try и оборвёт проверку ВСЕХ следующих аккаунтов
      // («следующий аккаунт пропустился и не проверился»). Один плохой аккаунт не роняет остальные.
      await prisma.instagramAccount.update({ where: { id: account.id }, data }).catch(() => null)
      await prisma.log.create({
        data: { accountId: account.id, level: 'ERROR', message: `Ошибка проверки: ${e.message}${data.status ? ` → аккаунт остановлен (${data.status})` : ''}` },
      }).catch(() => null)
      summary.push(s)
    } finally {
      // §4.8 — освобождаем per-account лок браузерной сессии (если брали), чтобы dm-воркер мог работать.
      // .catch — release тоже не должен пробросить исключение в внешний try (иначе оборвёт цикл).
      if (browserLockHeld) await releaseBrowserLock(prisma, account.id).catch(() => {})
    }
  }

  // ── §5.1 [H1] Прогрев ЧЕРНОВЫХ (HELPER) + [H2] health ───────────────────────
  // Основной цикл греет только RESPONDER/BOTH; черновые в него не входят → их сессии стынут
  // → частые ре-логины → выше риск бана черновых. Отдельный проход: активные HELPER с
  // browserState, прогрев которых устарел (WARMUP_KEEPALIVE_MS), в «дневном» окне их таймзоны.
  // [H2]: если сессия не подтвердилась при прогреве — метим CHALLENGE (нужен повторный вход).
  {
    const helpers = await prisma.instagramAccount.findMany({
      where: { role: 'HELPER', status: 'ACTIVE', ...scope },
      select: { id: true, userId: true, username: true, browserState: true, proxy: true, locale: true, timezoneId: true, limits: true },
    })
    for (const hlp of helpers) {
      if (!hlp.browserState) continue
      if (proxyRequired(hlp.userId) && !hlp.proxy) continue
      const lastW = Number((hlp.limits as any)?.lastWarmup || 0)
      if (!isManual && Date.now() - lastW < WARMUP_KEEPALIVE_MS) continue
      if (!isManual && !activityWindow(hlp.timezoneId, hlp.username).active) continue
      try {
        const w = await browserWarmup(hlp.browserState as object, hlp.proxy ?? undefined, hlp.username, hlp.locale ?? undefined, hlp.timezoneId ?? undefined)
        const lim = loadCounters(hlp.limits)
        ;(lim as any).lastWarmup = Date.now()
        await prisma.instagramAccount.update({
          where: { id: hlp.id },
          data: { limits: lim as any, ...(w.browserState ? { browserState: w.browserState as any } : {}), ...(w.alive ? {} : { status: 'CHALLENGE' as any }) },
        }).catch(() => null)
        if (!w.alive) await prisma.log.create({ data: { accountId: hlp.id, level: 'WARN', message: '⚠️ Черновой: сессия не подтвердилась при прогреве — нужен повторный вход (вход браузером).' } }).catch(() => null)
      } catch { /* прогрев чернового не критичен для цикла */ }
    }
  }

  if (dmQueue) await dmQueue.close()

  // Ручной запуск («Проверить сейчас») — понятный итог для кнопки в Настройках, чтобы он НЕ был
  // чёрным ящиком. Красные (CHALLENGE/PAUSED) в выборку не попадают → тут их нет: если проверять
  // некого, честно об этом говорим. Детали по каждому аккаунту — в его журнале.
  let message: string | undefined
  if (isManual) {
    const skipCodes: Record<string, string> = {
      cooldown: 'интервал', 'no-proxy': 'нет прокси', 'no-browser-session': 'требует входа',
      'quiet-hours': 'тихие часы', weekend: 'выходной', 'no-scraper': 'нет API-ключа',
    }
    const done = summary.filter((x) => !x.skipped)
    const skipped = summary.filter((x) => x.skipped)
    if (!summary.length) message = 'Нет активных аккаунтов для проверки (красные/на паузе пропускаются).'
    else {
      const parts: string[] = [`проверено ${done.length}`]
      if (skipped.length) {
        const byReason = skipped.reduce((m: Record<string, number>, x) => { const r = skipCodes[x.skipped!] ?? x.skipped!; m[r] = (m[r] ?? 0) + 1; return m }, {})
        parts.push('пропущено ' + Object.entries(byReason).map(([r, n]) => `${n} (${r})`).join(', '))
      }
      message = `Проверка выполнена: ${parts.join('; ')}. Подробности — в журнале аккаунта.`
    }
  }

  return NextResponse.json({ ok: true, summary, ...(message ? { message } : {}) })

  } finally {
    // Снимаем аренду лока — следующий цикл сможет стартовать сразу
    if (lockedByUs) await prisma.appLock.update({ where: { key: LOCK_KEY }, data: { lockedUntil: new Date(0) } }).catch(() => {})
  }
}

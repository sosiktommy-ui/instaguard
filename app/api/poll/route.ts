import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  getFollowers, getComments, sendDM, sendDMPhoto, replyComment, likeComment,
  getFriendship, viewStories, followUser, likeLatestMedia, likeUserMedias,
} from '@/lib/instagram/client'
import { Queue } from 'bullmq'
import { loadCounters, consume, MAX_NEW_PER_POLL, type Counters } from '@/lib/limits'

// Сколько последних постов автора комментария лайкать (действие «Лайк» в триггере «Комментарий»)
const COMMENT_LIKE_POSTS = 3
// Минимум 20 минут между автоматическими проверками одного аккаунта
const POLL_COOLDOWN_MS = 20 * 60 * 1000
// Комментарии проверяем реже — раз в 60 минут (они меняются медленнее)
const COMMENT_COOLDOWN_MS = 60 * 60 * 1000
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
// Определяет по тексту ошибки, нужно ли остановить аккаунт (challenge/бан/ограничение)
function statusFromError(msg: string): 'CHALLENGE' | 'PAUSED' | null {
  const m = (msg || '').toLowerCase()
  if (/challenge|checkpoint|verify|подтвержд/.test(m)) return 'CHALLENGE'
  if (/feedback_required|feedbackrequired|spam|blocked|action.?block|429|login_required|loginrequired|please wait|few minutes/.test(m)) return 'PAUSED'
  return null
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

// Выполняет действия триггера-подписки для одного подписчика синхронно
async function runFollowerActionsInline(job: any) {
  const session = job.sessionData as object          // основной: DM/фото
  const proxy = job.proxy ?? undefined
  const draftSession = (job.draftSessionData ?? job.sessionData) as object  // черновой: подписка/лайк/сторис
  const draftProxy = job.draftProxy ?? proxy
  let success = false
  const errors: string[] = []

  if (job.text)   { try { await sendDM(session, job.followerPk, job.text, proxy); success = true } catch (e: any) { errors.push(`DM: ${e.message}`) } }
  if (job.image)  { await randDelay(2, 5); try { await sendDMPhoto(session, job.followerPk, job.image, proxy); success = true } catch (e: any) { errors.push(`фото: ${e.message}`) } }
  if (job.doFollow) { await randDelay(3, 7); try { await followUser(draftSession, job.followerPk, draftProxy); success = true } catch (e: any) { errors.push(`подписка: ${e.message}`) } }
  if (job.doLike)   { await randDelay(3, 8); try { await likeLatestMedia(draftSession, job.followerPk, draftProxy); success = true } catch (e: any) { errors.push(`лайк: ${e.message}`) } }
  if (job.viewStories) { await randDelay(4, 10); try { await viewStories(draftSession, job.followerPk, job.storyLike, draftProxy); success = true } catch (e: any) { errors.push(`сторис: ${e.message}`) } }

  if (success) {
    await Promise.all([
      prisma.log.create({ data: { accountId: job.accountId, level: errors.length ? 'WARN' : 'SUCCESS', message: `Сработал триггер «${job.triggerName}» → @${job.followerUsername}${errors.length ? ` (частично: ${errors.join('; ')})` : ''}` } }),
      prisma.triggerRule.update({ where: { id: job.triggerId }, data: { fireCount: { increment: 1 } } }),
    ])
  } else if (errors.length) {
    await prisma.log.create({ data: { accountId: job.accountId, level: 'ERROR', message: `@${job.followerUsername}: ${errors.join('; ')}` } })
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
  limited?: number      // пропущено из-за дневного лимита
  skipped?: string
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { accountId?: string; manual?: boolean }
  const { accountId } = body
  // Ручная проверка: указан конкретный аккаунт ИЛИ явный флаг manual (кнопка «Проверить»)
  const isManual = Boolean(accountId) || body.manual === true

  // Основные аккаунты (отправители): исключаем черновых (HELPER) — те только парсят.
  const where: any = accountId
    ? { id: accountId, status: 'ACTIVE' as const }
    : { status: 'ACTIVE' as const, role: { in: ['RESPONDER', 'BOTH'] } }

  const accounts = await prisma.instagramAccount.findMany({
    where,
    include: {
      triggersAsResponder: { where: { isActive: true } },
      snapshots: { orderBy: { createdAt: 'desc' } },
    },
  })

  // Пул черновых (HELPER) аккаунтов-парсеров: активные, с живой сессией. LRU — кто дольше не работал.
  const draftPool = (await prisma.instagramAccount.findMany({
    where: { role: 'HELPER', status: 'ACTIVE' },
    orderBy: { lastChecked: 'asc' },
  })).filter((d) => d.sessionData)

  // Основные, которым реально есть что делать (есть активные триггеры)
  const workingMains = accounts.filter((a) => a.sessionData && a.triggersAsResponder.length)

  // ФОЛБЭК: черновых нет / все забанены → НЕ парсим основными (защита от бана) + тревога владельцу.
  if (workingMains.length && draftPool.length === 0) {
    await notifyOwner(
      workingMains.map((a) => a.id),
      '🚨 Нет доступных черновых аккаунтов (все забанены/на паузе). Парсинг основными остановлен — срочно добавьте черновой аккаунт, иначе основной под угрозой бана.'
    )
    return NextResponse.json({
      ok: true, alert: 'no-drafts',
      message: 'Нет черновых аккаунтов — парсинг остановлен для защиты основных.',
      summary: workingMains.map((a) => ({
        accountId: a.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0,
        triggersFound: a.triggersAsResponder.length, totalComments: 0, newComments: 0,
        commentActions: 0, skipped: 'no-draft',
      })),
    })
  }

  // Round-robin по пулу черновых + отдельные дневные счётчики на каждый черновой.
  let draftCursor = 0
  const nextDraft = () => (draftPool.length ? draftPool[draftCursor++ % draftPool.length] : null)
  const draftCounters = new Map<string, Counters>()
  const getDraftCounters = (d: { id: string; limits: unknown }): Counters => {
    if (!draftCounters.has(d.id)) draftCounters.set(d.id, loadCounters(d.limits))
    return draftCounters.get(d.id)!
  }
  const usedDraftIds = new Set<string>()

  const summary: PollSummary[] = []
  const dmQueue = getDmQueue()

  for (const account of accounts) {
    if (!account.sessionData) continue

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

    const session = account.sessionData as object
    const proxy = account.proxy ?? undefined
    const s: PollSummary = {
      accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0,
      triggersFound: triggers.length, totalComments: 0, newComments: 0, commentActions: 0, limited: 0,
    }

    // Дневные счётчики действий (защита от бана)
    const counters: Counters = loadCounters(account.limits)
    // Разнесённые задержки: первое действие скоро, дальше с интервалом ~45–115с
    let cursor = (isManual ? 8 + Math.random() * 14 : 45 + Math.random() * 75) * 1000
    const nextGap = () => (45 + Math.random() * 70) * 1000
    // Кэш «подписан ли на нас» в рамках одной проверки (без повторных запросов к IG)
    const friendshipCache = new Map<string, boolean>()

    // Черновой-парсер для этого основного (round-robin). Пул тут гарантированно непуст.
    const draft = nextDraft()
    if (!draft) { s.skipped = 'no-draft'; summary.push(s); continue }
    usedDraftIds.add(draft.id)
    const dc = getDraftCounters(draft)          // дневные лимиты чернового
    const parseSession = draft.sessionData as object   // сессия чернового: парсинг + лайк/подписка/сторис
    const parseProxy = draft.proxy ?? undefined

    try {
      // ── Поток подписчиков ────────────────────────────────────────────────
      if (followerTriggers.length) {
        const { followers } = await getFollowers(parseSession, account.username, parseProxy, FOLLOWERS_FETCH_LIMIT)
        const snapFollowers = account.snapshots.find((sn) => sn.type === 'FOLLOWERS')
        const hadBaseline = Boolean(snapFollowers)
        const knownPks = extractKnownPks(snapFollowers?.data)
        // Первая проверка (нет снапшота) — только фиксируем базу, НЕ обрабатываем существующих
        // подписчиков (иначе на новом аккаунте будет массовая рассылка → бан).
        let newFollowers = hadBaseline ? followers.filter((f) => !knownPks.has(String(f.pk))) : []
        followers.forEach((f) => knownPks.add(String(f.pk)))

        await prisma.$transaction([
          prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'FOLLOWERS' } }),
          prisma.snapshot.create({ data: { accountId: account.id, type: 'FOLLOWERS', data: capPks(knownPks, SNAPSHOT_MAX) } }),
        ])

        s.totalFollowers = followers.length
        s.newFollowers = newFollowers.length
        // Не обрабатываем больше N новых за одну проверку (защита от всплеска)
        if (newFollowers.length > MAX_NEW_PER_POLL) newFollowers = newFollowers.slice(0, MAX_NEW_PER_POLL)

        for (const trigger of followerTriggers) {
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

          for (const follower of newFollowers) {
            // Резервируем дневной бюджет по каждому действию — что не влезло, пропускаем
            // DM — лимит основного; лайк/подписка/сторис — лимит чернового (их делает он)
            const willDM = Boolean(msgAction?.templates?.[0]) && consume(counters, 'dm')
            const willFollow = doFollowT && consume(dc, 'follow')
            const willLike = doLikeT && consume(dc, 'like')
            const willStory = Boolean(storiesAct) && consume(dc, 'story')
            if (!willDM && !willFollow && !willLike && !willStory) { s.limited = (s.limited ?? 0) + 1; continue }

            let text = willDM ? template.replace(/\{\{username\}\}/gi, follower.username) : ''
            if (willDM && link?.enabled && link.url) {
              const lt = String(link.text ?? '').replace(/\{\{username\}\}/gi, follower.username)
              text += `\n\n${lt ? lt + ': ' : ''}${link.url}`
            }

            const job = {
              sessionData: account.sessionData, accountId: account.id,
              triggerId: trigger.id, triggerName: trigger.name,
              followerPk: follower.pk, followerUsername: follower.username,
              text: text.trim(), image: willDM ? image : undefined,
              doFollow: willFollow, doLike: willLike,
              viewStories: willStory, storyLike: Boolean(storiesAct?.like), proxy: account.proxy,
              // Сессия чернового: подписку/лайк/сторис исполняет он, не основной
              draftSessionData: draft.sessionData, draftProxy: draft.proxy,
            }

            // Всегда через очередь с разнесёнными задержками (безопасно + без таймаута запроса).
            // Инлайн — только если нет Redis.
            if (dmQueue) {
              // jobId — идемпотентность: один и тот же (аккаунт+триггер+подписчик) не задвоится;
              // attempts:1 — без авто-ретрая, чтобы упавший воркер не отправил DM повторно.
              await dmQueue.add('send', job, {
                jobId: `dm:${account.id}:${trigger.id}:${follower.pk}`,
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

      // ── Поток комментариев (отдельный кулдаун — реже чем подписчики) ────
      const snapCommentsMeta = account.snapshots.find((sn) => sn.type === 'COMMENTS')
      const commentElapsed = snapCommentsMeta
        ? Date.now() - new Date(snapCommentsMeta.createdAt).getTime()
        : Infinity
      if (commentTriggers.length && (isManual || commentElapsed >= COMMENT_COOLDOWN_MS)) {
        const { comments } = await getComments(parseSession, account.username, parseProxy, COMMENT_MEDIA_COUNT, COMMENT_PER_MEDIA)
        const hadBaseline = Boolean(snapCommentsMeta)
        const knownC = extractKnownPks(snapCommentsMeta?.data)
        // Первая проверка (нет снапшота) — только фиксируем базу, НЕ реагируем на старые комменты,
        // иначе бот разом ответит на все существующие. Реагируем только на появившиеся после базы.
        const newComments = hadBaseline ? comments.filter((c) => !knownC.has(String(c.pk))) : []
        comments.forEach((c) => knownC.add(String(c.pk)))

        await prisma.$transaction([
          prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'COMMENTS' } }),
          prisma.snapshot.create({ data: { accountId: account.id, type: 'COMMENTS', data: capPks(knownC, SNAPSHOT_MAX) } }),
        ])

        s.totalComments = comments.length
        s.newComments = newComments.length
        const toProcess = newComments.slice(0, MAX_NEW_PER_POLL)

        for (const c of toProcess) {
          for (const trigger of commentTriggers) {
            const actions = (trigger.actions ?? []) as any[]
            const isOn = (a: any) => a && a.enabled !== false
            // «Сигнал» — общее условие на весь триггер (хранится в conditions)
            const match = (trigger.conditions ?? {}) as any
            if (!matchPhrase(c.text, match)) continue

            const dm = actions.find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
            const reply = actions.find((a: any) => a.type === 'REPLY_COMMENT' && isOn(a))
            const gate = actions.find((a: any) => a.type === 'COMMENT_GATE' && isOn(a))
            // «Лайк» в триггере комментарий = лайкнуть посты автора (LIKE_MEDIA); LIKE_COMMENT — легаси (лайк коммента)
            const doLikePosts = actions.some((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))
            const likeCmt = actions.some((a: any) => a.type === 'LIKE_COMMENT' && isOn(a))
            const doFollow = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
            const storiesAct = actions.find((a: any) => a.type === 'VIEW_STORIES' && isOn(a))

            let fired = false
            let gatedStop = false
            const errors: string[] = []

            // Проверка подписки: если автор НЕ подписан — только коммент-приглашение, стоп
            if (gate) {
              let isFollower = false
              if (friendshipCache.has(c.user_pk)) {
                isFollower = friendshipCache.get(c.user_pk)!
              } else {
                try {
                  const fs = await getFriendship(session, c.user_pk, proxy)
                  isFollower = Boolean(fs.followed_by)
                  friendshipCache.set(c.user_pk, isFollower)
                } catch (e: any) { errors.push(`проверка подписки: ${e.message}`) }
              }

              if (!isFollower) {
                const gateText = String(gate.text ?? '').replace(/\{\{username\}\}/gi, c.username)
                if (gateText && consume(counters, 'comment')) {
                  try { await replyComment(session, c.media_id, gateText, c.pk, proxy); fired = true }
                  catch (e: any) { errors.push(`коммент-приглашение: ${e.message}`) }
                } else if (gateText) { s.limited = (s.limited ?? 0) + 1 }
                gatedStop = true
              }
            }

            // Подписан (или проверки нет): действия с паузами между ними + дневной лимит
            if (!gatedStop) {
              if (reply) {
                const variants: string[] = (reply.replies ?? []).filter(Boolean)
                if (variants.length && consume(counters, 'comment')) {
                  const pick = variants[Math.floor(Math.random() * variants.length)].replace(/\{\{username\}\}/gi, c.username)
                  try { await replyComment(session, c.media_id, pick, c.pk, proxy); fired = true }
                  catch (e: any) { errors.push(`ответ: ${e.message}`) }
                }
              }
              if (doLikePosts && consume(dc, 'like')) {
                await randDelay(2, 5)
                try { await likeUserMedias(parseSession, c.user_pk, COMMENT_LIKE_POSTS, parseProxy); fired = true }
                catch (e: any) { errors.push(`лайк постов: ${e.message}`) }
              }
              if (likeCmt && consume(dc, 'like')) {
                await randDelay(1, 3)
                try { await likeComment(parseSession, c.pk, parseProxy); fired = true }
                catch (e: any) { errors.push(`лайк коммента: ${e.message}`) }
              }
              if (doFollow && consume(dc, 'follow')) {
                await randDelay(2, 5)
                try { await followUser(parseSession, c.user_pk, parseProxy); fired = true }
                catch (e: any) { errors.push(`подписка: ${e.message}`) }
              }
              if (dm?.templates?.[0] && consume(counters, 'dm')) {
                await randDelay(3, 8)
                let text = String(dm.templates[0]).replace(/\{\{username\}\}/gi, c.username)
                if (dm.link?.enabled && dm.link.url) {
                  const lt = String(dm.link.text ?? '').replace(/\{\{username\}\}/gi, c.username)
                  text += `\n\n${lt ? lt + ': ' : ''}${dm.link.url}`
                }
                try {
                  await sendDM(session, c.user_pk, text.trim(), proxy); fired = true
                  if (dm.image?.enabled && dm.image.url) {
                    await randDelay(2, 4)
                    await sendDMPhoto(session, c.user_pk, dm.image.url, proxy)
                  }
                } catch (e: any) { errors.push(`DM: ${e.message}`) }
              }
              if (storiesAct && consume(dc, 'story')) {
                await randDelay(3, 7)
                try { await viewStories(parseSession, c.user_pk, Boolean(storiesAct.like), parseProxy); fired = true }
                catch (e: any) { errors.push(`сторис: ${e.message}`) }
              }
            }

            if (fired) {
              await Promise.all([
                prisma.log.create({ data: { accountId: account.id, level: errors.length ? 'WARN' : 'SUCCESS', message: `Коммент @${c.username} → «${trigger.name}»${gatedStop ? ' (не подписан → приглашение)' : ''}${errors.length ? ` (частично: ${errors.join('; ')})` : ''}` } }),
                prisma.triggerRule.update({ where: { id: trigger.id }, data: { fireCount: { increment: 1 } } }),
              ])
              s.commentActions++
            } else if (errors.length) {
              await prisma.log.create({ data: { accountId: account.id, level: 'ERROR', message: `Коммент @${c.username}: ${errors.join('; ')}` } })
            }
          }
        }
      }

      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { lastChecked: new Date(), errorCount: 0, limits: counters as any },
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

  // Сохраняем дневные счётчики черновых и метку использования (для LRU-ротации между запусками)
  await Promise.all([...usedDraftIds].map((id) =>
    prisma.instagramAccount.update({
      where: { id },
      data: { limits: draftCounters.get(id) as any, lastChecked: new Date() },
    }).catch(() => null)
  ))

  if (dmQueue) await dmQueue.close()

  return NextResponse.json({ ok: true, summary })
}

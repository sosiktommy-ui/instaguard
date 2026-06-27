import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  getFollowers, getComments, sendDM, sendDMPhoto, replyComment, likeComment,
  getFriendship, viewStories, followUser, likeLatestMedia,
} from '@/lib/instagram/client'
import { Queue } from 'bullmq'

// Минимум 10 минут между автоматическими проверками одного аккаунта
const POLL_COOLDOWN_MS = 10 * 60 * 1000
// Сколько последних подписчиков запрашивать у Instagram (лимит безопасности)
const FOLLOWERS_FETCH_LIMIT = 50
// Сколько последних постов и комментариев под каждым сканировать
const COMMENT_MEDIA_COUNT = 4
const COMMENT_PER_MEDIA = 20

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
  const session = job.sessionData as object
  const proxy = job.proxy ?? undefined
  let success = false
  const errors: string[] = []

  if (job.text)   { try { await sendDM(session, job.followerPk, job.text, proxy); success = true } catch (e: any) { errors.push(`DM: ${e.message}`) } }
  if (job.image)  { try { await sendDMPhoto(session, job.followerPk, job.image, proxy); success = true } catch (e: any) { errors.push(`фото: ${e.message}`) } }
  if (job.doFollow) { try { await followUser(session, job.followerPk, proxy); success = true } catch (e: any) { errors.push(`подписка: ${e.message}`) } }
  if (job.doLike)   { try { await likeLatestMedia(session, job.followerPk, proxy); success = true } catch (e: any) { errors.push(`лайк: ${e.message}`) } }
  if (job.viewStories) { try { await viewStories(session, job.followerPk, job.storyLike, proxy); success = true } catch (e: any) { errors.push(`сторис: ${e.message}`) } }

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
  skipped?: string
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { accountId?: string; manual?: boolean }
  const { accountId } = body
  // Ручная проверка: указан конкретный аккаунт ИЛИ явный флаг manual (кнопка «Проверить»)
  const isManual = Boolean(accountId) || body.manual === true

  const where = accountId
    ? { id: accountId, status: 'ACTIVE' as const }
    : { status: 'ACTIVE' as const }

  const accounts = await prisma.instagramAccount.findMany({
    where,
    include: {
      triggersAsResponder: { where: { isActive: true } },
      snapshots: { orderBy: { createdAt: 'desc' } },
    },
  })

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
      triggersFound: triggers.length, totalComments: 0, newComments: 0, commentActions: 0,
    }

    try {
      // ── Поток подписчиков ────────────────────────────────────────────────
      if (followerTriggers.length) {
        const { followers } = await getFollowers(session, account.username, proxy, FOLLOWERS_FETCH_LIMIT)
        const snapFollowers = account.snapshots.find((sn) => sn.type === 'FOLLOWERS')
        const knownPks = extractKnownPks(snapFollowers?.data)
        const newFollowers = followers.filter((f) => !knownPks.has(String(f.pk)))
        followers.forEach((f) => knownPks.add(String(f.pk)))

        await prisma.$transaction([
          prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'FOLLOWERS' } }),
          prisma.snapshot.create({ data: { accountId: account.id, type: 'FOLLOWERS', data: Array.from(knownPks) } }),
        ])

        s.totalFollowers = followers.length
        s.newFollowers = newFollowers.length

        for (const trigger of followerTriggers) {
          const actions = (trigger.actions ?? []) as any[]
          const isOn = (a: any) => a && a.enabled !== false
          const msgAction = actions.find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
          const doFollow = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
          const doLike = actions.some((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))
          const storiesAct = actions.find((a: any) => a.type === 'VIEW_STORIES' && isOn(a))
          const viewS = Boolean(storiesAct)
          const storyLike = Boolean(storiesAct?.like)
          if (!msgAction?.templates?.[0] && !doFollow && !doLike && !viewS) continue

          const template: string = msgAction?.templates?.[0] ?? ''
          const delayMin: number = msgAction?.delayMin ?? 45
          const delayMax: number = msgAction?.delayMax ?? 180
          const link = msgAction?.link
          const image: string | undefined = msgAction?.image?.enabled ? msgAction.image.url : undefined

          for (const follower of newFollowers) {
            let text = template.replace(/\{\{username\}\}/gi, follower.username)
            if (link?.enabled && link.url) text += `\n\n${link.text ? link.text + ': ' : ''}${link.url}`
            const delayMs = Math.round((delayMin + Math.random() * (delayMax - delayMin)) * 1000)

            const job = {
              sessionData: account.sessionData, accountId: account.id,
              triggerId: trigger.id, triggerName: trigger.name,
              followerPk: follower.pk, followerUsername: follower.username,
              text: text.trim(), image, doFollow, doLike,
              viewStories: viewS, storyLike, proxy: account.proxy,
            }

            if (dmQueue && !isManual) {
              await dmQueue.add('send', job, { delay: delayMs, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } })
            } else {
              await runFollowerActionsInline(job)
            }
            s.dmsQueued++
          }
        }
      }

      // ── Поток комментариев ───────────────────────────────────────────────
      if (commentTriggers.length) {
        const { comments } = await getComments(session, account.username, proxy, COMMENT_MEDIA_COUNT, COMMENT_PER_MEDIA)
        const snapComments = account.snapshots.find((sn) => sn.type === 'COMMENTS')
        const hadBaseline = Boolean(snapComments)
        const knownC = extractKnownPks(snapComments?.data)
        // Первая проверка (нет снапшота) — только фиксируем базу, НЕ реагируем на старые комменты,
        // иначе бот разом ответит на все существующие. Реагируем только на появившиеся после базы.
        const newComments = hadBaseline ? comments.filter((c) => !knownC.has(String(c.pk))) : []
        comments.forEach((c) => knownC.add(String(c.pk)))

        await prisma.$transaction([
          prisma.snapshot.deleteMany({ where: { accountId: account.id, type: 'COMMENTS' } }),
          prisma.snapshot.create({ data: { accountId: account.id, type: 'COMMENTS', data: Array.from(knownC) } }),
        ])

        s.totalComments = comments.length
        s.newComments = newComments.length

        for (const c of newComments) {
          for (const trigger of commentTriggers) {
            const actions = (trigger.actions ?? []) as any[]
            const isOn = (a: any) => a && a.enabled !== false
            // «Сигнал» — общее условие на весь триггер (хранится в conditions)
            const match = (trigger.conditions ?? {}) as any
            if (!matchPhrase(c.text, match)) continue

            const dm = actions.find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
            const reply = actions.find((a: any) => a.type === 'REPLY_COMMENT' && isOn(a))
            const gate = actions.find((a: any) => a.type === 'COMMENT_GATE' && isOn(a))
            const likeCmt = actions.some((a: any) => a.type === 'LIKE_COMMENT' && isOn(a))
            const doFollow = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
            const storiesAct = actions.find((a: any) => a.type === 'VIEW_STORIES' && isOn(a))

            let fired = false
            let gatedStop = false
            const errors: string[] = []

            // Проверка подписки: если автор НЕ подписан — только коммент-приглашение, стоп
            if (gate) {
              let isFollower = false
              try {
                const fs = await getFriendship(session, c.user_pk, proxy)
                isFollower = Boolean(fs.followed_by)
              } catch (e: any) { errors.push(`проверка подписки: ${e.message}`) }

              if (!isFollower) {
                const gateText = String(gate.text ?? '').replace(/\{\{username\}\}/gi, c.username)
                if (gateText) {
                  try { await replyComment(session, c.media_id, gateText, c.pk, proxy); fired = true }
                  catch (e: any) { errors.push(`коммент-приглашение: ${e.message}`) }
                }
                gatedStop = true
              }
            }

            // Подписан (или проверки нет): сначала коммент, потом подписка, потом DM, потом сторис
            if (!gatedStop) {
              if (reply) {
                const variants: string[] = (reply.replies ?? []).filter(Boolean)
                if (variants.length) {
                  const pick = variants[Math.floor(Math.random() * variants.length)].replace(/\{\{username\}\}/gi, c.username)
                  try { await replyComment(session, c.media_id, pick, c.pk, proxy); fired = true }
                  catch (e: any) { errors.push(`ответ: ${e.message}`) }
                }
              }
              if (likeCmt) {
                try { await likeComment(session, c.pk, proxy); fired = true }
                catch (e: any) { errors.push(`лайк коммента: ${e.message}`) }
              }
              if (doFollow) {
                try { await followUser(session, c.user_pk, proxy); fired = true }
                catch (e: any) { errors.push(`подписка: ${e.message}`) }
              }
              if (dm?.templates?.[0]) {
                let text = String(dm.templates[0]).replace(/\{\{username\}\}/gi, c.username)
                if (dm.link?.enabled && dm.link.url) text += `\n\n${dm.link.text ? dm.link.text + ': ' : ''}${dm.link.url}`
                try {
                  await sendDM(session, c.user_pk, text.trim(), proxy); fired = true
                  if (dm.image?.enabled && dm.image.url) await sendDMPhoto(session, c.user_pk, dm.image.url, proxy)
                } catch (e: any) { errors.push(`DM: ${e.message}`) }
              }
              if (storiesAct) {
                try { await viewStories(session, c.user_pk, Boolean(storiesAct.like), proxy); fired = true }
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
        data: { lastChecked: new Date(), errorCount: 0 },
      })
      summary.push(s)
    } catch (e: any) {
      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { errorCount: { increment: 1 } },
      })
      await prisma.log.create({
        data: { accountId: account.id, level: 'ERROR', message: `Ошибка проверки: ${e.message}` },
      })
      summary.push(s)
    }
  }

  if (dmQueue) await dmQueue.close()

  return NextResponse.json({ ok: true, summary })
}

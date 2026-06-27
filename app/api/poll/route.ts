import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getFollowers } from '@/lib/instagram/client'
import { Queue } from 'bullmq'

// Минимум 10 минут между автоматическими проверками одного аккаунта
const POLL_COOLDOWN_MS = 10 * 60 * 1000
// Сколько последних подписчиков запрашивать у Instagram (лимит безопасности)
const FOLLOWERS_FETCH_LIMIT = 50

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

// Выполняет все действия триггера для одного подписчика синхронно (когда нет Redis-очереди)
async function runActionsInline(job: any) {
  const { sendDM, sendDMPhoto, followUser, likeLatestMedia } = await import('@/lib/instagram/client')
  const session = job.sessionData as object
  const proxy = job.proxy ?? undefined
  let success = false
  const errors: string[] = []

  if (job.text) {
    try { await sendDM(session, job.followerPk, job.text, proxy); success = true }
    catch (e: any) { errors.push(`DM: ${e.message}`) }
  }
  if (job.image) {
    try { await sendDMPhoto(session, job.followerPk, job.image, proxy); success = true }
    catch (e: any) { errors.push(`фото: ${e.message}`) }
  }
  if (job.doFollow) {
    try { await followUser(session, job.followerPk, proxy); success = true }
    catch (e: any) { errors.push(`подписка: ${e.message}`) }
  }
  if (job.doLike) {
    try { await likeLatestMedia(session, job.followerPk, proxy); success = true }
    catch (e: any) { errors.push(`лайк: ${e.message}`) }
  }

  if (success) {
    await Promise.all([
      prisma.log.create({ data: { accountId: job.accountId, level: 'SUCCESS', message: `Сработал триггер «${job.triggerName}» → @${job.followerUsername}` } }),
      prisma.triggerRule.update({ where: { id: job.triggerId }, data: { fireCount: { increment: 1 } } }),
    ])
  }
  if (errors.length) {
    await prisma.log.create({ data: { accountId: job.accountId, level: errors.length && !success ? 'ERROR' : 'WARN', message: `@${job.followerUsername}: ${errors.join('; ')}` } })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { accountId?: string }
  const { accountId } = body
  const isManual = Boolean(accountId) // ручная проверка конкретного аккаунта

  const where = accountId
    ? { id: accountId, status: 'ACTIVE' as const }
    : { status: 'ACTIVE' as const }

  const accounts = await prisma.instagramAccount.findMany({
    where,
    include: {
      triggersAsResponder: { where: { isActive: true, triggerType: 'NEW_FOLLOWER' } },
      snapshots: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  const summary: {
    accountId: string
    totalFollowers: number
    newFollowers: number
    dmsQueued: number
    triggersFound: number
    skipped?: string
  }[] = []

  const dmQueue = getDmQueue()

  for (const account of accounts) {
    if (!account.sessionData) continue

    // Кулдаун: пропускаем авто-поллинг если аккаунт проверялся недавно
    if (!isManual && account.lastChecked) {
      const elapsed = Date.now() - account.lastChecked.getTime()
      if (elapsed < POLL_COOLDOWN_MS) {
        summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: 0, skipped: 'cooldown' })
        continue
      }
    }

    try {
      // Запрашиваем только последние N подписчиков (не всех — это риск бана)
      const { followers } = await getFollowers(
        account.sessionData as object,
        account.username,
        account.proxy ?? undefined,
        FOLLOWERS_FETCH_LIMIT
      )

      // Восстанавливаем множество известных pk из снапшота (любой формат)
      const knownPks = extractKnownPks(account.snapshots[0]?.data)

      // Новые = те кого раньше не видели
      const newFollowers = followers.filter((f) => !knownPks.has(String(f.pk)))

      // Обновляем множество: добавляем всех только что полученных
      followers.forEach((f) => knownPks.add(String(f.pk)))

      // Заменяем снапшот атомарно: удаляем старый, создаём новый с накопленными pk
      await prisma.$transaction([
        prisma.snapshot.deleteMany({ where: { accountId: account.id } }),
        prisma.snapshot.create({
          data: { accountId: account.id, type: 'FOLLOWERS', data: Array.from(knownPks) },
        }),
      ])

      let dmsQueued = 0
      const triggersFound = account.triggersAsResponder.length

      for (const trigger of account.triggersAsResponder) {
        const actions = (trigger.actions ?? []) as any[]
        // Поддержка старого формата (без поля enabled) и нового
        const isOn = (a: any) => a && a.enabled !== false
        const msgAction = actions.find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
        const doFollow = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
        const doLike = actions.some((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))

        // Нет ни одного действия — пропускаем триггер
        if (!msgAction?.templates?.[0] && !doFollow && !doLike) continue

        const template: string = msgAction?.templates?.[0] ?? ''
        const delayMin: number = msgAction?.delayMin ?? 45
        const delayMax: number = msgAction?.delayMax ?? 180
        const link = msgAction?.link
        const image: string | undefined = msgAction?.image?.enabled ? msgAction.image.url : undefined

        for (const follower of newFollowers) {
          let text = template.replace(/\{\{username\}\}/gi, follower.username)
          // Instagram DM не поддерживает inline-кнопки — ссылка добавляется текстом (IG делает её кликабельной)
          if (link?.enabled && link.url) {
            text += `\n\n${link.text ? link.text + ': ' : ''}${link.url}`
          }
          const delayMs = Math.round((delayMin + Math.random() * (delayMax - delayMin)) * 1000)

          const job = {
            sessionData: account.sessionData,
            accountId: account.id,
            triggerId: trigger.id,
            triggerName: trigger.name,
            followerPk: follower.pk,
            followerUsername: follower.username,
            text: text.trim(),
            image,
            doFollow,
            doLike,
            proxy: account.proxy,
          }

          // Ручная проверка — отправляем СРАЗУ и синхронно (без зависимости от фонового
          // BullMQ-воркера), чтобы пользователь видел результат немедленно.
          // Авто-поллинг — кладём в очередь с задержкой 45–180с (безопаснее для аккаунта).
          if (dmQueue && !isManual) {
            await dmQueue.add('send', job, { delay: delayMs, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } })
          } else {
            await runActionsInline(job)
          }

          dmsQueued++
        }
      }

      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { lastChecked: new Date(), errorCount: 0 },
      })

      summary.push({ accountId: account.id, totalFollowers: followers.length, newFollowers: newFollowers.length, dmsQueued, triggersFound })
    } catch (e: any) {
      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { errorCount: { increment: 1 } },
      })
      await prisma.log.create({
        data: { accountId: account.id, level: 'ERROR', message: `Ошибка проверки: ${e.message}` },
      })
      summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, triggersFound: 0 })
    }
  }

  if (dmQueue) await dmQueue.close()

  return NextResponse.json({ ok: true, summary })
}

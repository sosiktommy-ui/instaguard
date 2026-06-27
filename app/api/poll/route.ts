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
    skipped?: string
  }[] = []

  const dmQueue = getDmQueue()

  for (const account of accounts) {
    if (!account.sessionData) continue

    // Кулдаун: пропускаем авто-поллинг если аккаунт проверялся недавно
    if (!isManual && account.lastChecked) {
      const elapsed = Date.now() - account.lastChecked.getTime()
      if (elapsed < POLL_COOLDOWN_MS) {
        summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0, skipped: 'cooldown' })
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

      if (newFollowers.length > 0 && account.triggersAsResponder.length > 0) {
        for (const trigger of account.triggersAsResponder) {
          const actions = (trigger.actions ?? []) as any[]
          const msgAction = actions.find((a: any) => a.type === 'SEND_MESSAGE')
          if (!msgAction?.templates?.[0]) continue

          const template: string = msgAction.templates[0]
          const delayMin: number = msgAction.delayMin ?? 45
          const delayMax: number = msgAction.delayMax ?? 180

          for (const follower of newFollowers) {
            // Защита от дубликатов: проверяем лог
            const alreadySent = await prisma.log.findFirst({
              where: {
                accountId: account.id,
                level: 'SUCCESS',
                message: { startsWith: `DM @${follower.username}` },
              },
            })
            if (alreadySent) continue

            const text = template.replace(/\{\{username\}\}/gi, follower.username)
            const delayMs = Math.round((delayMin + Math.random() * (delayMax - delayMin)) * 1000)

            if (dmQueue) {
              // Ставим в очередь с задержкой (BullMQ обработает асинхронно)
              await dmQueue.add(
                'send',
                {
                  sessionData: account.sessionData,
                  accountId: account.id,
                  triggerId: trigger.id,
                  triggerName: trigger.name,
                  followerPk: follower.pk,
                  followerUsername: follower.username,
                  text,
                  proxy: account.proxy,
                },
                { delay: delayMs, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } }
              )
            } else {
              // Fallback без Redis: отправляем напрямую (без задержки)
              const { sendDM } = await import('@/lib/instagram/client')
              try {
                await sendDM(account.sessionData as object, follower.pk, text, account.proxy ?? undefined)
                await Promise.all([
                  prisma.log.create({ data: { accountId: account.id, level: 'SUCCESS', message: `DM @${follower.username} (${trigger.name})` } }),
                  prisma.triggerRule.update({ where: { id: trigger.id }, data: { fireCount: { increment: 1 } } }),
                ])
              } catch (e: any) {
                await prisma.log.create({ data: { accountId: account.id, level: 'ERROR', message: `Ошибка DM @${follower.username}: ${e.message}` } })
              }
            }

            dmsQueued++
          }
        }
      }

      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { lastChecked: new Date(), errorCount: 0 },
      })

      summary.push({ accountId: account.id, totalFollowers: followers.length, newFollowers: newFollowers.length, dmsQueued })
    } catch (e: any) {
      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { errorCount: { increment: 1 } },
      })
      await prisma.log.create({
        data: { accountId: account.id, level: 'ERROR', message: `Ошибка проверки: ${e.message}` },
      })
      summary.push({ accountId: account.id, totalFollowers: 0, newFollowers: 0, dmsQueued: 0 })
    }
  }

  if (dmQueue) await dmQueue.close()

  return NextResponse.json({ ok: true, summary })
}

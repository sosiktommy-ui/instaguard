import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getFollowers, sendDM } from '@/lib/instagram/client'

export async function POST(req: NextRequest) {
  const { accountId } = await req.json().catch(() => ({})) as { accountId?: string }

  const where = accountId
    ? { id: accountId, status: 'ACTIVE' as const }
    : { status: 'ACTIVE' as const }

  const accounts = await prisma.instagramAccount.findMany({
    where,
    include: {
      triggersAsResponder: { where: { isActive: true } },
      snapshots: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })

  const summary: { accountId: string; newFollowers: number; dmsSent: number }[] = []

  for (const account of accounts) {
    if (!account.sessionData) continue

    try {
      const { followers } = await getFollowers(
        account.sessionData as object,
        account.username,
        account.proxy ?? undefined
      )

      const prevIds = new Set<string>(
        account.snapshots[0]
          ? ((account.snapshots[0].data as any[]) ?? []).map((f: any) => String(f.pk))
          : []
      )
      const newFollowers = followers.filter((f) => !prevIds.has(String(f.pk)))

      await prisma.snapshot.create({
        data: { accountId: account.id, type: 'FOLLOWERS', data: followers },
      })

      let dmsSent = 0

      for (const trigger of account.triggersAsResponder) {
        if (trigger.triggerType !== 'NEW_FOLLOWER') continue

        const actions = (trigger.actions ?? []) as any[]
        const msgAction = actions.find((a: any) => a.type === 'SEND_MESSAGE')
        if (!msgAction?.templates?.[0]) continue

        const template: string = msgAction.templates[0]

        for (const follower of newFollowers) {
          const text = template.replace(/\{\{username\}\}/gi, follower.username)
          try {
            await sendDM(account.sessionData as object, follower.pk, text, account.proxy ?? undefined)
            await Promise.all([
              prisma.log.create({
                data: { accountId: account.id, level: 'SUCCESS', message: `DM отправлен @${follower.username}` },
              }),
              prisma.triggerRule.update({
                where: { id: trigger.id },
                data: { fireCount: { increment: 1 } },
              }),
            ])
            dmsSent++
          } catch (e: any) {
            await prisma.log.create({
              data: { accountId: account.id, level: 'ERROR', message: `Ошибка DM @${follower.username}: ${e.message}` },
            })
          }
        }
      }

      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { lastChecked: new Date() },
      })

      summary.push({ accountId: account.id, newFollowers: newFollowers.length, dmsSent })
    } catch (e: any) {
      await prisma.instagramAccount.update({
        where: { id: account.id },
        data: { errorCount: { increment: 1 } },
      })
      await prisma.log.create({
        data: { accountId: account.id, level: 'ERROR', message: `Ошибка проверки: ${e.message}` },
      })
    }
  }

  return NextResponse.json({ ok: true, summary })
}

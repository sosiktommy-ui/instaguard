import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

const TYPE_MAP: Record<string, string> = {
  FOLLOW: 'NEW_FOLLOWER',
  COMMENT: 'NEW_COMMENT',
  LIKE: 'NEW_LIKE',
  STORY_REPLY: 'STORY_MENTION',
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json([], { status: 401 })

  const triggers = await prisma.triggerRule.findMany({
    where: { userId: user.id },
    include: { responder: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(triggers)
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, accountIds, type, conditions, message, delayMin, delayMax } = await req.json()
  if (!name || !accountIds?.length || !type) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const triggerType = TYPE_MAP[type]
  if (!triggerType) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const actions = [{ type: 'SEND_MESSAGE', templates: [message ?? ''], delayMin: delayMin ?? 45, delayMax: delayMax ?? 180 }]

  const created = await Promise.all(
    (accountIds as string[]).map((responderId) =>
      prisma.triggerRule.create({
        data: {
          userId: user.id,
          responderId,
          name,
          triggerType: triggerType as any,
          conditions: conditions ?? [],
          actions,
        },
      })
    )
  )

  return NextResponse.json({ ok: true, count: created.length })
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

const TYPE_MAP: Record<string, string> = {
  FOLLOW: 'NEW_FOLLOWER',
  COMMENT: 'NEW_COMMENT',
  LIKE: 'NEW_LIKE',
  STORY_REPLY: 'STORY_MENTION',
}

export async function GET() {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json([], { status: 401 })

  const triggers = await prisma.triggerRule.findMany({
    where: { userId: user.id },
    include: { responder: { select: { id: true, username: true, status: true, errorCount: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(triggers)
}

export async function POST(req: NextRequest) {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json({ error: 'Нет пользователя в БД' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { name, accountIds, type, conditions } = body
  if (!name || !accountIds?.length || !type) {
    return NextResponse.json({ error: 'Заполните название и выберите аккаунты' }, { status: 400 })
  }

  const triggerType = TYPE_MAP[type]
  if (!triggerType) return NextResponse.json({ error: 'Неизвестный тип события' }, { status: 400 })
  // Исполняемые типы: подписка, комментарий, лайк, ответ/упоминание в сторис
  const SUPPORTED = ['NEW_FOLLOWER', 'NEW_COMMENT', 'NEW_LIKE', 'STORY_MENTION']
  if (!SUPPORTED.includes(triggerType)) {
    return NextResponse.json({ error: 'Этот тип триггера пока не поддерживается (скоро)' }, { status: 400 })
  }

  // actions может прийти готовым массивом (новый UI) либо из плоских полей (старый UI)
  let actions: any[]
  if (Array.isArray(body.actions) && body.actions.length) {
    actions = body.actions
  } else {
    actions = [{
      type: 'SEND_MESSAGE',
      enabled: true,
      templates: [body.message ?? ''],
      delayMin: body.delayMin ?? 45,
      delayMax: body.delayMax ?? 180,
    }]
  }

  try {
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
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Не удалось создать триггер' }, { status: 400 })
  }
}

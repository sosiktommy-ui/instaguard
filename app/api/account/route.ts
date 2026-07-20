import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

// Профиль пользователя для личного кабинета. Скоуп строго по сессии (getCurrentUser).
// ВАЖНО (безопасность): здесь НЕЛЬЗЯ менять `plan` — тариф меняется только вебхуком
// платёжной системы (Фаза 3). PATCH правит лишь имя.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, name: true, plan: true, createdAt: true },
  })
  if (!dbUser) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const accountCount = await prisma.instagramAccount.count({ where: { userId: user.id } })

  return NextResponse.json({
    email: dbUser.email,
    name: dbUser.name,
    plan: dbUser.plan,
    createdAt: dbUser.createdAt,
    accountCount,
  })
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name } = await req.json().catch(() => ({}))
  if (typeof name !== 'string') {
    return NextResponse.json({ error: 'Некорректное имя' }, { status: 400 })
  }
  const clean = name.trim().slice(0, 80)
  await prisma.user.update({ where: { id: user.id }, data: { name: clean || null } })
  return NextResponse.json({ ok: true, name: clean || null })
}

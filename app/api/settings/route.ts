import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

// Настройки пользователя (пока — только «аккаунтов на прокси»; задел под этап 9).
export async function GET() {
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json({ accountsPerProxy: 3 })
    const s = await prisma.userSettings.findUnique({ where: { userId: user.id } })
    return NextResponse.json({ accountsPerProxy: s?.accountsPerProxy ?? 3 })
  } catch {
    return NextResponse.json({ accountsPerProxy: 3 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { accountsPerProxy } = await req.json().catch(() => ({}))
  const n = Math.max(1, Math.min(100, Math.round(Number(accountsPerProxy) || 3)))
  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, accountsPerProxy: n },
    update: { accountsPerProxy: n },
  })
  return NextResponse.json({ ok: true, accountsPerProxy: n })
}

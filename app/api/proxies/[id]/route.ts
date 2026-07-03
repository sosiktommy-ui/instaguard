import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

// DELETE — удалить прокси. Привязанные аккаунты не удаляются: proxyId у них обнуляется
// (ON DELETE SET NULL). Строковый account.proxy остаётся, чтобы воркеры не потеряли адрес сразу.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await prisma.proxy.deleteMany({ where: { id, userId: user.id } })
  return NextResponse.json({ ok: true })
}

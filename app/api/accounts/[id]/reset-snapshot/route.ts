import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Только владелец аккаунта может сбросить его снапшот
  const acc = await prisma.instagramAccount.findFirst({ where: { id, userId: user.id }, select: { id: true } })
  if (!acc) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
  await prisma.snapshot.deleteMany({ where: { accountId: id } })
  return NextResponse.json({ ok: true })
}

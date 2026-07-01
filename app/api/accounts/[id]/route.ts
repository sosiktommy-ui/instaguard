import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    // FK стоят RESTRICT — сначала удаляем дочерние записи, потом сам аккаунт (в транзакции)
    await prisma.$transaction([
      prisma.log.deleteMany({ where: { accountId: id } }),
      prisma.event.deleteMany({ where: { accountId: id } }),
      prisma.snapshot.deleteMany({ where: { accountId: id } }),
      prisma.triggerRule.deleteMany({ where: { OR: [{ responderId: id }, { helperId: id }] } }),
      prisma.instagramAccount.delete({ where: { id } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Не удалось удалить аккаунт' }, { status: 400 })
  }
}

// Разрешаем менять только безопасные поля (не sessionData/userId/role/username)
const PATCHABLE = new Set(['proxy', 'status'])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json().catch(() => ({}))
    const data: Record<string, unknown> = {}
    for (const k of Object.keys(body)) {
      if (PATCHABLE.has(k)) data[k] = body[k]
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Нет полей для обновления' }, { status: 400 })
    }
    const account = await prisma.instagramAccount.update({ where: { id }, data })
    return NextResponse.json({ id: account.id, username: account.username, status: account.status })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Не удалось обновить' }, { status: 400 })
  }
}

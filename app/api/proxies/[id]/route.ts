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

// PATCH — привязать/отвязать аккаунт к прокси (для приватных/уникальных прокси).
// body: { action: 'attach' | 'detach', accountId }
// attach: у аккаунта проставляются и proxyId (связь), и строковый proxy (для воркеров).
// detach: оба поля обнуляются (только если аккаунт действительно на этом прокси).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { action, accountId } = await req.json().catch(() => ({}))
  if (!accountId) return NextResponse.json({ error: 'Не указан аккаунт' }, { status: 400 })

  const proxy = await prisma.proxy.findFirst({ where: { id, userId: user.id } })
  if (!proxy) return NextResponse.json({ error: 'Прокси не найден' }, { status: 404 })

  const acc = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId: user.id }, select: { id: true } })
  if (!acc) return NextResponse.json({ error: 'Аккаунт не найден' }, { status: 404 })

  if (action === 'detach') {
    await prisma.instagramAccount.updateMany({
      where: { id: accountId, userId: user.id, proxyId: proxy.id },
      data: { proxyId: null, proxy: null },
    })
    return NextResponse.json({ ok: true })
  }

  // action === 'attach' (по умолчанию)
  await prisma.instagramAccount.update({
    where: { id: accountId },
    data: { proxyId: proxy.id, proxy: proxy.url },
  })
  return NextResponse.json({ ok: true })
}

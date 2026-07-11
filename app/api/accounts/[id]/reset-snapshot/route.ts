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
  // РАНЬШЕ просто удаляли снапшоты → следующий поллинг считал это ПЕРВЫМ заходом и заново
  // фиксировал базу (0 новых) → кнопка «не работала» (обещала «все снова будут новыми», а по
  // факту ничего не срабатывало). Теперь ставим ПУСТЫЕ снапшоты: базлайн ЕСТЬ (hadBaseline=true),
  // но известных pk нет → все ТЕКУЩИЕ подписчики/комменты/лайки становятся «новыми» и
  // обрабатываются на следующей проверке — В ПРЕДЕЛАХ дневных лимитов (не залпом).
  const types = ['FOLLOWERS', 'LIKES', 'COMMENTS', 'STORY'] as const
  await prisma.$transaction([
    prisma.snapshot.deleteMany({ where: { accountId: id } }),
    ...types.map((type) => prisma.snapshot.create({ data: { accountId: id, type, data: [] } })),
  ])
  return NextResponse.json({ ok: true })
}

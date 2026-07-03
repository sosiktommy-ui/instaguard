import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

// DELETE — удалить раздел. Подразделы каскадно удаляются (FK CASCADE),
// у аккаунтов sectionId обнуляется (FK SET NULL) — сами аккаунты не трогаем.
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json({ error: 'Нет пользователя' }, { status: 500 })

    const section = await prisma.section.findFirst({ where: { id, userId: user.id }, select: { id: true } })
    if (!section) return NextResponse.json({ error: 'Раздел не найден' }, { status: 404 })

    await prisma.section.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Не удалось удалить раздел' }, { status: 400 })
  }
}

// PATCH — переименовать раздел. { name }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json({ error: 'Нет пользователя' }, { status: 500 })

    const { name } = await req.json().catch(() => ({}))
    const clean = typeof name === 'string' ? name.trim() : ''
    if (!clean) return NextResponse.json({ error: 'Введите название' }, { status: 400 })

    const section = await prisma.section.findFirst({ where: { id, userId: user.id }, select: { id: true } })
    if (!section) return NextResponse.json({ error: 'Раздел не найден' }, { status: 404 })

    const updated = await prisma.section.update({ where: { id }, data: { name: clean }, select: { id: true, parentId: true, name: true } })
    return NextResponse.json(updated)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Не удалось обновить' }, { status: 400 })
  }
}

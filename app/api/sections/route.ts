import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

// GET — плоский список разделов пользователя (раздел + подраздел) со счётчиком аккаунтов.
// Фронтенд собирает из parentId двухуровневое дерево.
export async function GET() {
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json([])

    const sections = await prisma.section.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, parentId: true, name: true,
        _count: { select: { accounts: true } },
      },
    })
    return NextResponse.json(
      sections.map((s) => ({ id: s.id, parentId: s.parentId, name: s.name, accountCount: s._count.accounts }))
    )
  } catch {
    return NextResponse.json([])
  }
}

// POST — создать раздел или подраздел. { name, parentId? }
export async function POST(req: NextRequest) {
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json({ error: 'Нет пользователя' }, { status: 500 })

    const { name, parentId } = await req.json().catch(() => ({}))
    const clean = typeof name === 'string' ? name.trim() : ''
    if (!clean) return NextResponse.json({ error: 'Введите название' }, { status: 400 })

    // Ограничиваем двумя уровнями: родитель подраздела должен быть корневым разделом этого юзера.
    let parent: string | null = null
    if (parentId) {
      const p = await prisma.section.findFirst({ where: { id: parentId, userId: user.id }, select: { id: true, parentId: true } })
      if (!p) return NextResponse.json({ error: 'Родительский раздел не найден' }, { status: 400 })
      if (p.parentId) return NextResponse.json({ error: 'Нельзя вкладывать глубже двух уровней' }, { status: 400 })
      parent = p.id
    }

    const section = await prisma.section.create({
      data: { userId: user.id, name: clean, parentId: parent },
      select: { id: true, parentId: true, name: true },
    })
    return NextResponse.json({ ...section, accountCount: 0 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Ошибка сервера' }, { status: 500 })
  }
}

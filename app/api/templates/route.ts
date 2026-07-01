import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

// Шаблоны триггеров. Весь черновик (тип, действия, текст, ссылка, картинка,
// диалог, задержки) сериализуется в JSON-строку поля content.
export async function GET() {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json([], { status: 401 })

  const templates = await prisma.template.findMany({
    where: { userId: user.id, category: 'trigger' },
    orderBy: { id: 'desc' },
  })

  return NextResponse.json(templates.map((t) => {
    let draft: any = null
    try { draft = JSON.parse(t.content) } catch {}
    return { id: t.id, name: t.name, usageCount: t.usageCount, draft }
  }))
}

export async function POST(req: NextRequest) {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json({ error: 'Нет пользователя в БД' }, { status: 401 })

  const { name, draft } = await req.json().catch(() => ({}))
  if (!name?.trim()) return NextResponse.json({ error: 'Укажите название шаблона' }, { status: 400 })

  const tpl = await prisma.template.create({
    data: {
      userId: user.id,
      name: name.trim(),
      content: JSON.stringify(draft ?? {}),
      category: 'trigger',
    },
  })

  return NextResponse.json({ ok: true, id: tpl.id })
}

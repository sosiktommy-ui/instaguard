import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  await prisma.triggerRule.deleteMany({ where: { id, userId: user.id } })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const data: { isActive?: boolean; name?: string; conditions?: any; actions?: any; fireCount?: number; stats?: any } = {}
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.name === 'string') data.name = body.name
  if (body.conditions !== undefined) data.conditions = body.conditions
  if (body.actions !== undefined) data.actions = body.actions
  // Сброс статистики (по требованию редактирования): обнуляем срабатывания и счётчики действий.
  if (body.resetStats === true) { data.fireCount = 0; data.stats = {} }

  // Правки «содержимого» (имя/сигнал/действия) запрещены на запущенной кампании —
  // сначала её нужно остановить (план §D1). Разрешаем, если в этом же запросе выключаем.
  const editingContent = data.name !== undefined || data.conditions !== undefined || data.actions !== undefined
  if (editingContent) {
    const cur = await prisma.triggerRule.findFirst({ where: { id, userId: user.id }, select: { isActive: true } })
    if (!cur) return NextResponse.json({ error: 'Кампания не найдена' }, { status: 404 })
    if (cur.isActive && data.isActive !== false) {
      return NextResponse.json({ error: 'Остановите кампанию перед редактированием' }, { status: 409 })
    }
  }

  await prisma.triggerRule.updateMany({ where: { id, userId: user.id }, data })
  return NextResponse.json({ ok: true })
}

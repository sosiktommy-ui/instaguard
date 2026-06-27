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
  const data: { isActive?: boolean; name?: string; conditions?: any; actions?: any } = {}
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.name === 'string') data.name = body.name
  if (body.conditions !== undefined) data.conditions = body.conditions
  if (body.actions !== undefined) data.actions = body.actions
  await prisma.triggerRule.updateMany({ where: { id, userId: user.id }, data })
  return NextResponse.json({ ok: true })
}

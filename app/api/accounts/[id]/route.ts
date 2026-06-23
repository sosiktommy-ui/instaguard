import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.instagramAccount.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await req.json()
  const account = await prisma.instagramAccount.update({ where: { id }, data })
  return NextResponse.json({ id: account.id, username: account.username, status: account.status })
}

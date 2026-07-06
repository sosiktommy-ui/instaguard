import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json([], { status: 401 })

    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId') ?? undefined
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 80))

    const logs = await prisma.log.findMany({
      where: { account: { userId: user.id }, ...(accountId ? { accountId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { account: { select: { username: true } } },
    })
    return NextResponse.json(logs)
  } catch {
    return NextResponse.json([])
  }
}

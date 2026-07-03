import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json([], { status: 401 })

    const logs = await prisma.log.findMany({
      where: { account: { userId: user.id } },
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: { account: { select: { username: true } } },
    })
    return NextResponse.json(logs)
  } catch {
    return NextResponse.json([])
  }
}

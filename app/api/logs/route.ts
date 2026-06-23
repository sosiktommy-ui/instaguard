import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const logs = await prisma.log.findMany({
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: { account: { select: { username: true } } },
    })
    return NextResponse.json(logs)
  } catch {
    return NextResponse.json([])
  }
}

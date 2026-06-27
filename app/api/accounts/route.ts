import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const accounts = await prisma.instagramAccount.findMany({
      orderBy: { id: 'desc' },
      select: {
        id: true, username: true, status: true,
        lastChecked: true, errorCount: true, proxy: true,
        snapshots: { orderBy: { createdAt: 'desc' }, take: 1, select: { data: true } },
      },
    })
    return NextResponse.json(accounts.map((a) => ({
      id: a.id,
      username: a.username,
      status: a.status,
      lastChecked: a.lastChecked,
      errorCount: a.errorCount,
      proxy: a.proxy,
      followerCount: Array.isArray(a.snapshots[0]?.data) ? (a.snapshots[0].data as string[]).length : 0,
    })))
  } catch {
    return NextResponse.json([])
  }
}

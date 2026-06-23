import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const accounts = await prisma.instagramAccount.findMany({
      orderBy: { id: 'desc' },
      select: { id: true, username: true, status: true, lastChecked: true, errorCount: true, proxy: true },
    })
    return NextResponse.json(accounts)
  } catch {
    return NextResponse.json([])
  }
}

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json([], { status: 401 })

    const accounts = await prisma.instagramAccount.findMany({
      where: { userId: user.id },
      orderBy: { id: 'desc' },
      select: {
        id: true, username: true, status: true, role: true,
        lastChecked: true, errorCount: true, proxy: true, followers: true, limits: true, followersHistory: true,
        sectionId: true, proxyId: true, sessionData: true,
        snapshots: { orderBy: { createdAt: 'desc' }, take: 1, select: { data: true } },
      },
    })
    return NextResponse.json(accounts.map((a) => {
      const tracked = Array.isArray(a.snapshots[0]?.data) ? (a.snapshots[0].data as string[]).length : 0
      return {
        id: a.id,
        username: a.username,
        status: a.status,
        role: a.role,
        lastChecked: a.lastChecked,
        errorCount: a.errorCount,
        proxy: a.proxy,
        followers: a.followers ?? null,   // реальное число (из account_info); null пока не спарсили
        followerCount: tracked,           // отслеживается в базе
        limits: a.limits ?? null,         // счётчики действий за сегодня
        followersHistory: a.followersHistory ?? null,  // для спарклайна прироста
        sectionId: a.sectionId ?? null,   // раздел/подраздел (папка)
        proxyId: a.proxyId ?? null,       // к какому прокси привязан (для вкладки «Прокси»)
        hasSession: Boolean(a.sessionData),   // жива ли сессия Instagram (для «Индекса безопасности»); сам sessionData наружу не отдаём
      }
    }))
  } catch {
    return NextResponse.json([])
  }
}

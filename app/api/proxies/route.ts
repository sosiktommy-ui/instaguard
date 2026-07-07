import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

// GET — список прокси пользователя (с числом привязанных аккаунтов) + настройка «аккаунтов на прокси».
export async function GET() {
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json({ accountsPerProxy: 3, proxies: [] })
    const [settings, proxies] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId: user.id } }),
      prisma.proxy.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, url: true, kind: true, label: true,
          status: true, lastCheckedAt: true, ip: true, country: true, isp: true, scheme: true,
          datacenter: true, vpn: true, mobile: true, flagged: true, igBlocked: true,
          accounts: { select: { id: true, username: true, role: true, status: true }, orderBy: { username: 'asc' } },
        },
      }),
    ])
    return NextResponse.json({
      accountsPerProxy: settings?.accountsPerProxy ?? 3,
      proxies: proxies.map((p) => ({
        id: p.id, url: p.url, kind: p.kind, label: p.label,
        status: p.status, lastCheckedAt: p.lastCheckedAt,
        ip: p.ip, country: p.country, isp: p.isp, scheme: p.scheme,
        datacenter: p.datacenter, vpn: p.vpn, mobile: p.mobile, flagged: p.flagged, igBlocked: p.igBlocked,
        accountCount: p.accounts.length,
        accounts: p.accounts.map((a) => ({ id: a.id, username: a.username, role: a.role, status: a.status })),
      })),
    })
  } catch {
    return NextResponse.json({ accountsPerProxy: 3, proxies: [] })
  }
}

// POST — добавить прокси (по одному на строку/через запятую).
// { url, kind } — kind: 'pool' (общий, авто-привязка) | 'individual' (приватный, для одного аккаунта)
export async function POST(req: NextRequest) {
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json({ error: 'Нет пользователя' }, { status: 500 })
    const { url, kind } = await req.json().catch(() => ({}))
    const k = kind === 'individual' ? 'individual' : 'pool'
    const urls = String(url ?? '').split(/[\n,]/).map((u) => u.trim()).filter(Boolean)
    if (!urls.length) return NextResponse.json({ error: 'Введите адрес прокси' }, { status: 400 })
    await prisma.proxy.createMany({ data: urls.map((u) => ({ userId: user.id, url: u, kind: k })) })
    return NextResponse.json({ ok: true, added: urls.length })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Ошибка сервера' }, { status: 500 })
  }
}

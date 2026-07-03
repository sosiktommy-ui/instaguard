import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

const DEFAULTS = { accountsPerProxy: 3, allowNoProxy: false, allowNoDrafts: false }

export async function GET() {
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json(DEFAULTS)
    const s = await prisma.userSettings.findUnique({ where: { userId: user.id } })
    return NextResponse.json({
      accountsPerProxy: s?.accountsPerProxy ?? DEFAULTS.accountsPerProxy,
      allowNoProxy: s?.allowNoProxy ?? DEFAULTS.allowNoProxy,
      allowNoDrafts: s?.allowNoDrafts ?? DEFAULTS.allowNoDrafts,
    })
  } catch {
    return NextResponse.json(DEFAULTS)
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const data: { accountsPerProxy?: number; allowNoProxy?: boolean; allowNoDrafts?: boolean } = {}
  if (body.accountsPerProxy !== undefined) data.accountsPerProxy = Math.max(1, Math.min(100, Math.round(Number(body.accountsPerProxy) || 3)))
  if (typeof body.allowNoProxy === 'boolean') data.allowNoProxy = body.allowNoProxy
  if (typeof body.allowNoDrafts === 'boolean') data.allowNoDrafts = body.allowNoDrafts

  const s = await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  })
  return NextResponse.json({ ok: true, accountsPerProxy: s.accountsPerProxy, allowNoProxy: s.allowNoProxy, allowNoDrafts: s.allowNoDrafts })
}

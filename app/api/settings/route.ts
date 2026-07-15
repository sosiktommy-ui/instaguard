import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'
import { DAILY_CAPS, normalizeCaps } from '@/lib/limits'

const PARSING = ['api', 'drafts', 'drafts_then_api']

const DEFAULTS = {
  accountsPerProxy: 3, allowNoProxy: false,
  parsingSource: 'api', browserHeadful: false, pollIntervalHours: 3,
  dailyCaps: DAILY_CAPS,
}

export async function GET() {
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json(DEFAULTS)
    const s = await prisma.userSettings.findUnique({ where: { userId: user.id } })
    return NextResponse.json({
      accountsPerProxy: s?.accountsPerProxy ?? DEFAULTS.accountsPerProxy,
      allowNoProxy: s?.allowNoProxy ?? DEFAULTS.allowNoProxy,
      parsingSource: s?.parsingSource ?? DEFAULTS.parsingSource,
      browserHeadful: s?.browserHeadful ?? DEFAULTS.browserHeadful,
      pollIntervalHours: s?.pollIntervalHours ?? DEFAULTS.pollIntervalHours,
      dailyCaps: normalizeCaps(s?.dailyCaps),   // числа + флаг off (для UI-тумблера)
    })
  } catch {
    return NextResponse.json(DEFAULTS)
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getUserOrFirst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const data: {
    accountsPerProxy?: number; allowNoProxy?: boolean
    parsingSource?: string; browserHeadful?: boolean; pollIntervalHours?: number; dailyCaps?: any
  } = {}
  if (body.accountsPerProxy !== undefined) data.accountsPerProxy = Math.max(1, Math.min(100, Math.round(Number(body.accountsPerProxy) || 3)))
  if (typeof body.allowNoProxy === 'boolean') data.allowNoProxy = body.allowNoProxy
  if (typeof body.parsingSource === 'string' && PARSING.includes(body.parsingSource)) data.parsingSource = body.parsingSource
  if (typeof body.browserHeadful === 'boolean') data.browserHeadful = body.browserHeadful
  if (body.pollIntervalHours !== undefined) data.pollIntervalHours = Math.max(1, Math.min(168, Math.round(Number(body.pollIntervalHours) || 3)))
  // Дневные лимиты: клампим числа в [0, CAP_MAX] + флаг off (отключить лимиты) — храним как есть.
  if (body.dailyCaps !== undefined) data.dailyCaps = normalizeCaps(body.dailyCaps)

  const s = await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  })
  return NextResponse.json({
    ok: true, accountsPerProxy: s.accountsPerProxy, allowNoProxy: s.allowNoProxy,
    parsingSource: s.parsingSource, browserHeadful: s.browserHeadful,
    pollIntervalHours: s.pollIntervalHours, dailyCaps: normalizeCaps(s.dailyCaps),
  })
}

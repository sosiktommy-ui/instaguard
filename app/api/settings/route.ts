import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getUserOrFirst } from '@/lib/auth'

const PARSING = ['api', 'drafts', 'drafts_then_api']
const ENGINE = ['browser', 'legacy']

const DEFAULTS = {
  accountsPerProxy: 3, allowNoProxy: false, allowNoDrafts: false, likeByDraft: false, storyByDraft: false,
  parsingSource: 'api', actionEngine: 'browser', browserHeadful: false,
}

export async function GET() {
  try {
    const user = await getUserOrFirst()
    if (!user) return NextResponse.json(DEFAULTS)
    const s = await prisma.userSettings.findUnique({ where: { userId: user.id } })
    return NextResponse.json({
      accountsPerProxy: s?.accountsPerProxy ?? DEFAULTS.accountsPerProxy,
      allowNoProxy: s?.allowNoProxy ?? DEFAULTS.allowNoProxy,
      allowNoDrafts: s?.allowNoDrafts ?? DEFAULTS.allowNoDrafts,
      likeByDraft: s?.likeByDraft ?? DEFAULTS.likeByDraft,
      storyByDraft: s?.storyByDraft ?? DEFAULTS.storyByDraft,
      parsingSource: s?.parsingSource ?? DEFAULTS.parsingSource,
      actionEngine: s?.actionEngine ?? DEFAULTS.actionEngine,
      browserHeadful: s?.browserHeadful ?? DEFAULTS.browserHeadful,
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
    accountsPerProxy?: number; allowNoProxy?: boolean; allowNoDrafts?: boolean; likeByDraft?: boolean; storyByDraft?: boolean
    parsingSource?: string; actionEngine?: string; browserHeadful?: boolean
  } = {}
  if (body.accountsPerProxy !== undefined) data.accountsPerProxy = Math.max(1, Math.min(100, Math.round(Number(body.accountsPerProxy) || 3)))
  if (typeof body.allowNoProxy === 'boolean') data.allowNoProxy = body.allowNoProxy
  if (typeof body.allowNoDrafts === 'boolean') data.allowNoDrafts = body.allowNoDrafts
  if (typeof body.likeByDraft === 'boolean') data.likeByDraft = body.likeByDraft
  if (typeof body.storyByDraft === 'boolean') data.storyByDraft = body.storyByDraft
  if (typeof body.parsingSource === 'string' && PARSING.includes(body.parsingSource)) data.parsingSource = body.parsingSource
  if (typeof body.actionEngine === 'string' && ENGINE.includes(body.actionEngine)) data.actionEngine = body.actionEngine
  if (typeof body.browserHeadful === 'boolean') data.browserHeadful = body.browserHeadful

  const s = await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  })
  return NextResponse.json({
    ok: true, accountsPerProxy: s.accountsPerProxy, allowNoProxy: s.allowNoProxy, allowNoDrafts: s.allowNoDrafts,
    likeByDraft: s.likeByDraft, storyByDraft: s.storyByDraft,
    parsingSource: s.parsingSource, actionEngine: s.actionEngine, browserHeadful: s.browserHeadful,
  })
}

// plan4 Фаза B — ПРОБА self-events: дёргает свою ленту уведомлений (news/inbox) сессией
// аккаунта и возвращает нормализованные события + СЫРОЙ payload (для снятия формата на живом).
// Ban-safe: только ЧТЕНИЕ своих уведомлений, ничего не отправляет. Owner-scoped.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { browserConfigured, browserSelfEvents } from '@/lib/browser/client'

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!browserConfigured()) return NextResponse.json({ error: 'Браузерный воркер не настроен (BROWSER_WORKER_URL)' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { accountId?: string; raw?: boolean; amount?: number }
  if (!body.accountId) return NextResponse.json({ error: 'нужен accountId' }, { status: 400 })

  const account = await prisma.instagramAccount.findFirst({
    where: { id: body.accountId, userId: user.id },
    select: { id: true, username: true, browserState: true, proxy: true, locale: true, timezoneId: true },
  })
  if (!account) return NextResponse.json({ error: 'аккаунт не найден' }, { status: 404 })
  if (!account.browserState) {
    return NextResponse.json({ error: 'у аккаунта нет активной сессии — сначала войдите (браузером)' }, { status: 400 })
  }

  try {
    const r = await browserSelfEvents(
      { storageState: account.browserState as object, proxy: account.proxy ?? undefined, username: account.username, locale: account.locale ?? undefined, timezoneId: account.timezoneId ?? undefined },
      { raw: body.raw !== false, amount: body.amount ?? 30 },
    )
    return NextResponse.json({ ok: !r.error, username: account.username, events: r.events ?? [], raw: r.raw, error: r.error })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? 'ошибка воркера') }, { status: 502 })
  }
}

// §10.3 СУХОЙ ПРОГОН (dry-run) — безопасный тест флоу на ЖИВОМ аккаунте БЕЗ финального клика.
// Прогоняет реальный браузерный путь (сессия → навигация к цели → поиск кнопки действия),
// но НЕ отправляет директ/не подписывается/не лайкает и НЕ трогает бюджет/снапшоты/доставку.
// Цель — убедиться, что вход жив, прокси носит трафик, селекторы находят кнопки. Ban-safe.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { browserConfigured, browserDM, browserFollow, browserLike, browserStories, type ActionResult } from '@/lib/browser/client'
import { scrapeFollowers, scraperConfigured } from '@/lib/scraper/hiker'

type Ctx = { storageState: object; proxy?: string; username?: string; locale?: string; timezoneId?: string }
const ACTIONS = ['dm', 'follow', 'like', 'story'] as const
type ActionType = typeof ACTIONS[number]

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!browserConfigured()) return NextResponse.json({ error: 'Браузерный воркер не настроен (BROWSER_WORKER_URL)' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as {
    accountId?: string; targetUsername?: string; actions?: string[]
  }
  if (!body.accountId) return NextResponse.json({ error: 'нужен accountId' }, { status: 400 })

  const account = await prisma.instagramAccount.findFirst({
    where: { id: body.accountId, userId: user.id },
    select: { id: true, username: true, browserState: true, proxy: true, locale: true, timezoneId: true },
  })
  if (!account) return NextResponse.json({ error: 'аккаунт не найден' }, { status: 404 })
  if (!account.browserState) {
    return NextResponse.json({ error: 'у аккаунта нет активной сессии — сначала войдите (браузером)' }, { status: 400 })
  }

  // Цель: явная из запроса ИЛИ первый подписчик через HikerAPI (реалистичная живая цель).
  let target = String(body.targetUsername || '').replace(/^@/, '').trim().toLowerCase()
  let targetSource = target ? 'задана вручную' : ''
  if (!target) {
    if (!scraperConfigured()) {
      return NextResponse.json({ error: 'укажите targetUsername (HikerAPI не настроен для авто-подбора)' }, { status: 400 })
    }
    try {
      const { followers } = await scrapeFollowers(account.username, 5)
      target = followers.find((f) => f.username)?.username?.toLowerCase() || ''
      targetSource = 'подписчик из HikerAPI'
    } catch {}
    if (!target) return NextResponse.json({ error: 'не удалось подобрать цель — укажите targetUsername' }, { status: 400 })
  }

  const want: ActionType[] = (Array.isArray(body.actions) && body.actions.length
    ? body.actions.filter((a): a is ActionType => (ACTIONS as readonly string[]).includes(a))
    : [...ACTIONS])

  const ctx: Ctx = {
    storageState: account.browserState as object,
    proxy: account.proxy ?? undefined,
    username: account.username,
    locale: account.locale ?? undefined,
    timezoneId: account.timezoneId ?? undefined,
  }

  // Прогоняем выбранные действия в dry-run (последовательно — одна сессия, без спешки).
  const results: Record<string, { ok: boolean; reached?: any; error?: string; closed?: boolean; already?: boolean }> = {}
  const run = async (type: ActionType, call: () => Promise<ActionResult>) => {
    try {
      const r = await call()
      results[type] = { ok: Boolean(r.ok), reached: r.reached, error: r.error, closed: r.closed, already: r.already }
    } catch (e: any) {
      results[type] = { ok: false, error: String(e?.message ?? e).slice(0, 200) }
    }
  }

  if (want.includes('dm')) await run('dm', () => browserDM(ctx, target, '', undefined, true))
  if (want.includes('follow')) await run('follow', () => browserFollow(ctx, target, true))
  if (want.includes('like')) await run('like', () => browserLike(ctx, target, 1, true))
  if (want.includes('story')) await run('story', () => browserStories(ctx, target, false, true))

  const reachedAny = Object.values(results).some((r) => r.ok || r.already)
  // Лог — как «инфо», НЕ как срабатывание кампании (не влияет на статистику/бюджет).
  await prisma.log.create({
    data: {
      accountId: account.id, level: reachedAny ? 'INFO' : 'WARN',
      message: `🧪 Сухой прогон @${account.username} → @${target} (${targetSource}): ${
        Object.entries(results).map(([k, v]) => `${k}:${v.ok ? '✓' : v.already ? 'уже' : v.closed ? 'закрыто' : '✗'}`).join(' · ')
      }`,
    },
  }).catch(() => null)

  return NextResponse.json({
    ok: true, dryRun: true, account: account.username, target, targetSource,
    note: 'Финальный клик НЕ выполнялся: директ не отправлен, подписка/лайк не сделаны. Только проверка сессии/навигации/селекторов.',
    results,
  })
}

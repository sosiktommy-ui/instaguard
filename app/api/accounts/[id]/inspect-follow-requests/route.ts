import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { browserAcceptFollowRequests } from '@/lib/browser/client'

// Диагностика авто-приёма заявок в подписчики (`autoAcceptFollowers`): по запросу пользователя
// («бот не принимает подписки автоматически») — реальный прогон ТОГО ЖЕ действия, что выполняет
// poll, с полной диагностикой (панель открылась?, сколько заявок, скрин экрана В МОМЕНТ проверки,
// реальные nav-иконки/диалоги/кнопки) — чтобы по одному прогону было видно, где именно рвётся
// цепочка (панель не открылась / заявок нет / кнопка не найдена), а не гадать по логам поллинга.
// НЕ dry-run: если есть реальные ожидающие заявки — они будут ПОДТВЕРЖДЕНЫ (это и есть проверяемое
// поведение). Owner-scoped, требует сохранённой сессии (browserState).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const acc = await prisma.instagramAccount.findFirst({ where: { id, userId: user.id } })
  if (!acc) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
  if (!acc.browserState) return NextResponse.json({ error: 'У аккаунта нет сохранённой сессии (browserState) — сначала войдите' }, { status: 400 })

  try {
    const result = await browserAcceptFollowRequests(
      { storageState: acc.browserState as object, proxy: acc.proxy ?? undefined, username: acc.username, locale: acc.locale ?? undefined, timezoneId: acc.timezoneId ?? undefined },
      10,
    )
    if (result.browserState) {
      await prisma.instagramAccount.update({ where: { id: acc.id }, data: { browserState: result.browserState as any } }).catch(() => null)
    }
    return NextResponse.json({
      ok: true,
      autoAcceptEnabled: acc.autoAcceptFollowers,
      pendingCount: result.pendingCount,
      approved: result.approved,
      errors: result.errors ?? [],
      panelOpened: result.panelOpened ?? false,
      fetchFailed: result.fetchFailed ?? false,
      sample: result.sample ?? '',
      screenshot: result.screenshot ?? null,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Ошибка воркера', screenshot: e?.diag?.screenshot ?? null }, { status: 400 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { browserDiagnoseActions } from '@/lib/browser/client'

// 🔬 Диагностика действий (запрос пользователя: «дм/лайк не срабатывают, непонятно почему»).
// Бот берёт РЕАЛЬНЫХ подписчиков аккаунта (DOM-список «Читачі» на своём профиле) и по каждому
// прогоняет ПРОБУ каждого действия (follow/like/story/dm) через dryRun — реальная навигация к
// профилю + проверка «дойдёт ли до кнопки», БЕЗ финального клика (не спамит, повторяемо). По ответу
// видно ТОЧНУЮ причину на действие: подписка (уже/кнопка), лайк (сколько постов / «нет постов»),
// сторис (есть?), директ (композер открывается / личка закрыта / блип). Owner-scoped, нужен browserState.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const acc = await prisma.instagramAccount.findFirst({ where: { id, userId: user.id } })
  if (!acc) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
  if (!acc.browserState) return NextResponse.json({ error: 'У аккаунта нет сохранённой сессии (browserState) — сначала войдите' }, { status: 400 })

  try {
    const result = await browserDiagnoseActions(
      { storageState: acc.browserState as object, proxy: acc.proxy ?? undefined, username: acc.username, locale: acc.locale ?? undefined, timezoneId: acc.timezoneId ?? undefined },
      3,
    )
    if (result.browserState) {
      await prisma.instagramAccount.update({ where: { id: acc.id }, data: { browserState: result.browserState as any } }).catch(() => null)
    }
    return NextResponse.json({
      ok: true,
      followers: result.followers ?? [],
      opened: result.opened ?? false,
      results: result.results ?? [],
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Ошибка воркера' }, { status: 400 })
  }
}

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

  // Источник подписчиков — ПОДПИСЧИКИ, НА КОТОРЫХ БОТ УЖЕ ТРИГГЕРИЛСЯ (из журнала): сообщения
  // «… → @username» (сработавший триггер) и «Приняты заявки в подписчики: @a, @b». Это ровно те,
  // кого бот занёс в БД, — надёжнее хрупкого DOM-скрейпа модалки «Читачі» (тот лишь резерв в воркере).
  const logs = await prisma.log.findMany({
    where: { accountId: acc.id, message: { contains: '@' } },
    orderBy: { createdAt: 'desc' }, take: 300, select: { message: true },
  }).catch(() => [] as { message: string }[])
  const names = new Set<string>()
  for (const l of logs) {
    for (const m of l.message.matchAll(/@([A-Za-z0-9._]+)/g)) {
      const u = m[1].toLowerCase()
      if (u && u !== acc.username.toLowerCase()) names.add(u)
    }
    if (names.size >= 12) break
  }
  const usernames = Array.from(names).slice(0, 5)

  try {
    const result = await browserDiagnoseActions(
      { storageState: acc.browserState as object, proxy: acc.proxy ?? undefined, username: acc.username, locale: acc.locale ?? undefined, timezoneId: acc.timezoneId ?? undefined },
      Math.max(3, usernames.length), usernames,
    )
    const patch: any = {}
    // browserState сохраняем ТОЛЬКО если воркер вернул живой стейт (worker не отдаёт его при мёртвой
    // сессии) — иначе затёрли бы хороший browserState разлогиненным (отравление сессии).
    if (result.browserState) patch.browserState = result.browserState
    // Чиним «врущий» счётчик: реальное число подписчиков с профиля — источник истины (кумулятивный
    // followersGained в poll дрейфует). Только если сессия жива (иначе число могло не прочитаться).
    if (!result.sessionDead && typeof result.followerCount === 'number' && result.followerCount >= 0) patch.followers = result.followerCount
    // Сессия мертва → честно помечаем «Требует входа» (на карточке появится кнопка «Войти заново»).
    // Статус был ACTIVE, хотя сессия в браузере разлогинена — вот источник «дм не отправляется».
    if (result.sessionDead) patch.status = 'CHALLENGE'
    if (Object.keys(patch).length) await prisma.instagramAccount.update({ where: { id: acc.id }, data: patch }).catch(() => null)

    return NextResponse.json({
      ok: true,
      followers: result.followers ?? [],
      opened: result.opened ?? false,
      followerCount: result.followerCount ?? null,
      sessionDead: result.sessionDead ?? false,
      source: usernames.length ? 'db' : 'dom',
      results: result.results ?? [],
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Ошибка воркера' }, { status: 400 })
  }
}

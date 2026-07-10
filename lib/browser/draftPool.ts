// Подбор чернового (HELPER) аккаунта для парсинга браузером — plan.md §5.
// Простейшая стратегия: активный HELPER с живым browserState, наименее недавно
// использованный (round-robin по lastChecked). Черновые логинятся тем же браузерным
// /login, что и основные (accounts/auth, accounts/import с role='HELPER').
import { prisma } from '@/lib/prisma'
import { browserTestSession } from '@/lib/browser/client'

export interface DraftAccount {
  id: string
  username: string
  browserState: object
  proxy: string | null
  locale: string | null      // гео отпечатка чернового (plan.md §349) — свой прокси, своя страна
  timezoneId: string | null
}

// Подбор чернового с ПРОВЕРКОЙ живости сессии (plan.md §4.4/§5.2 [H2]): перебираем кандидатов
// (LRU), у каждого с `browserState` пробуем `testSession`; первый живой → берём. Мёртвого метим
// `CHALLENGE` (нужен повторный вход) + WARN и переходим к следующему — поток парсинга не
// «застревает» на черновом с протухшей сессией.
export async function pickDraft(userId: string): Promise<DraftAccount | null> {
  const list = await prisma.instagramAccount.findMany({
    where: { userId, role: 'HELPER', status: 'ACTIVE' },
    orderBy: { lastChecked: 'asc' },
    select: { id: true, username: true, browserState: true, proxy: true, locale: true, timezoneId: true },
    take: 5,
  })
  for (const a of list) {
    if (!a.browserState) continue
    const state = a.browserState as object
    const alive = await browserTestSession(state, a.proxy ?? undefined, a.username).catch(() => false)
    if (alive) return { id: a.id, username: a.username, browserState: state, proxy: a.proxy, locale: a.locale, timezoneId: a.timezoneId }
    await Promise.all([
      prisma.instagramAccount.update({ where: { id: a.id }, data: { status: 'CHALLENGE' } }).catch(() => null),
      prisma.log.create({ data: { accountId: a.id, level: 'WARN', message: `Черновой @${a.username}: сессия недействительна → нужен повторный вход (пропущен для парсинга)` } }).catch(() => null),
    ])
  }
  return null
}

export async function markDraftUsed(id: string): Promise<void> {
  await prisma.instagramAccount.update({ where: { id }, data: { lastChecked: new Date() } }).catch(() => null)
}

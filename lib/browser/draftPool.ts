// Подбор чернового (HELPER) аккаунта для парсинга браузером — plan.md §5.
// Простейшая стратегия: активный HELPER с живым browserState, наименее недавно
// использованный (round-robin по lastChecked). Черновые логинятся тем же браузерным
// /login, что и основные (accounts/auth, accounts/import с role='HELPER').
import { prisma } from '@/lib/prisma'

export interface DraftAccount {
  id: string
  username: string
  browserState: object
  proxy: string | null
}

export async function pickDraft(userId: string): Promise<DraftAccount | null> {
  const list = await prisma.instagramAccount.findMany({
    where: { userId, role: 'HELPER', status: 'ACTIVE' },
    orderBy: { lastChecked: 'asc' },
    select: { id: true, username: true, browserState: true, proxy: true },
    take: 5,
  })
  const a = list.find((x) => x.browserState)
  if (!a || !a.browserState) return null
  return { id: a.id, username: a.username, browserState: a.browserState as object, proxy: a.proxy }
}

export async function markDraftUsed(id: string): Promise<void> {
  await prisma.instagramAccount.update({ where: { id }, data: { lastChecked: new Date() } }).catch(() => null)
}

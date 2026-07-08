import { prisma } from '@/lib/prisma'
import { browserConfigured } from '@/lib/browser/client'

export type Engine = 'browser' | 'legacy'

/**
 * Какой движок входа/действий использовать для пользователя.
 * Правило (plan.md §0 «каждая фаза оставляет приложение рабочим»):
 * если браузерный воркер НЕ задеплоен (нет BROWSER_WORKER_URL) — всегда legacy (instagrapi),
 * чтобы вход не сломался до появления воркера. Иначе — по настройке actionEngine (default browser).
 */
export async function resolveEngine(userId: string): Promise<Engine> {
  if (!browserConfigured()) return 'legacy'
  try {
    const s = await prisma.userSettings.findUnique({ where: { userId }, select: { actionEngine: true } })
    return s?.actionEngine === 'legacy' ? 'legacy' : 'browser'
  } catch {
    return 'browser'
  }
}

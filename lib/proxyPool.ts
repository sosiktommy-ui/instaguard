import { prisma } from '@/lib/prisma'
import { pickProxy } from '@/lib/instagram/client'

/**
 * Подбор пулового прокси для подключения аккаунта.
 * Логика: берём свободные (по ёмкости accountsPerProxy) пуловые прокси, отдаём воркеру
 * на проверку — он ПРОПУСКАЕТ мёртвые (не коннектятся) и предпочитает «чистые» по репутации,
 * но флагнутый рабочий тоже вернёт (флаг datacenter от чекеров ненадёжен — ISP часто ложно
 * метятся как DC). Так плохие/мёртвые не используются, когда есть рабочие, и наглухо не залочит.
 */
export type PoolPick =
  | { ok: true; url: string; id: string; flagged: boolean }
  | { ok: false; reason: 'no-capacity' | 'all-dead' }

const MAX_CANDIDATES = 4   // ограничиваем число проверок, чтобы не упереться в таймаут воркера

export async function pickPoolProxy(userId: string, cap: number): Promise<PoolPick> {
  const pool = await prisma.proxy.findMany({
    where: { userId, kind: 'pool' },
    select: { id: true, url: true, _count: { select: { accounts: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const free = pool
    .filter((p) => p._count.accounts < cap)
    .sort((a, b) => a._count.accounts - b._count.accounts)
  if (!free.length) return { ok: false, reason: 'no-capacity' }

  const candidates = free.slice(0, MAX_CANDIDATES)
  try {
    const res = await pickProxy(candidates.map((p) => p.url))
    if (res.chosen) {
      const p = candidates.find((f) => f.url === res.chosen) ?? free[0]
      return { ok: true, url: p.url, id: p.id, flagged: Boolean(res.flagged) }
    }
    return { ok: false, reason: 'all-dead' }
  } catch {
    // Воркер недоступен для проверки — НЕ блокируем вход: берём наименее занятый (как раньше).
    return { ok: true, url: free[0].url, id: free[0].id, flagged: false }
  }
}

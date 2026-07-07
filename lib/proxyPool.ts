import { prisma } from '@/lib/prisma'
import { pickProxy } from '@/lib/instagram/client'

/**
 * Подбор пулового прокси для подключения аккаунта.
 *
 * Опирается на СОХРАНЁННОЕ здоровье прокси (результат кнопки «Проверить все» на вкладке «Прокси»):
 *  1. Заведомо годный (status=alive, не датацентр) берётся СРАЗУ, без обращения к воркеру —
 *     это убирает главный баг входа: при мёртвых кандидатах live-проверка упиралась в таймаут
 *     воркера (75с), и pickPoolProxy молча брал первый попавшийся (часто датацентр) прокси →
 *     вход падал в blacklist. Теперь известный-годный прокси = быстрый путь без таймаута.
 *  2. Заведомо мёртвые (status=dead) исключаются полностью — не пытаемся входить через мёртвый IP.
 *  3. Непроверенные (status=unknown) проверяются вживую воркером; узнанное здоровье тут же
 *     сохраняется в БД, чтобы в следующий раз сработал быстрый путь (без «Проверить все» вручную).
 *  4. Если остались только флагнутые (датацентр/VPN) — берём наименее занятый, но честно flagged=true.
 */
export type PoolPick =
  | { ok: true; url: string; id: string; flagged: boolean }
  | { ok: false; reason: 'no-capacity' | 'all-dead' }

const MAX_CANDIDATES = 30   // сколько непроверенных максимум отдаём воркеру за раз

type Cand = { id: string; url: string; status: string | null; flagged: boolean | null; load: number }

export async function pickPoolProxy(userId: string, cap: number, excludeIds: string[] = []): Promise<PoolPick> {
  const pool = await prisma.proxy.findMany({
    where: { userId, kind: 'pool', ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}) },
    select: { id: true, url: true, status: true, flagged: true, _count: { select: { accounts: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const free: Cand[] = pool
    .filter((p) => p._count.accounts < cap)
    .map((p) => ({ id: p.id, url: p.url, status: p.status, flagged: p.flagged, load: p._count.accounts }))
    .sort((a, b) => a.load - b.load)   // наименее занятый — первым
  if (!free.length) return { ok: false, reason: 'no-capacity' }

  const aliveClean = free.filter((p) => p.status === 'alive' && p.flagged !== true)
  const unknown    = free.filter((p) => p.status !== 'alive' && p.status !== 'dead')  // 'unknown' / null
  const aliveFlag  = free.filter((p) => p.status === 'alive' && p.flagged === true)
  // status === 'dead' — исключаем полностью

  // 1) Быстрый путь — заведомо годный прокси, без обращения к воркеру (нет риска таймаута).
  if (aliveClean.length) {
    const p = aliveClean[0]
    return { ok: true, url: p.url, id: p.id, flagged: false }
  }

  // 2) Непроверенные — проверяем вживую (воркер пропускает мёртвые, предпочитает чистый).
  if (unknown.length) {
    const idByUrl = new Map(free.map((p) => [p.url, p.id]))
    try {
      const res = await pickProxy(unknown.slice(0, MAX_CANDIDATES).map((p) => p.url))
      void persistChecked(res.checked, idByUrl)   // запоминаем здоровье → в следующий раз быстрый путь
      if (res.chosen) {
        const p = unknown.find((f) => f.url === res.chosen) ?? unknown[0]
        return { ok: true, url: p.url, id: p.id, flagged: Boolean(res.flagged) }
      }
      // все непроверенные оказались мертвы → падаем ниже (флагнутые / all-dead)
    } catch {
      // Воркер недоступен — НЕ блокируем вход: берём наименее занятый непроверенный.
      // Заведомо мёртвые уже исключены по сохранённому статусу, так что это не хуже прежнего фолбэка.
      const p = unknown[0]
      return { ok: true, url: p.url, id: p.id, flagged: false }
    }
  }

  // 3) Остались только флагнутые (датацентр/VPN) — лучше, чем ничего, но честно помечаем flagged.
  if (aliveFlag.length) {
    const p = aliveFlag[0]
    return { ok: true, url: p.url, id: p.id, flagged: true }
  }

  // 4) Всё мёртвое
  return { ok: false, reason: 'all-dead' }
}

// Сохранить в БД здоровье прокси, узнанное воркером при live-подборе (status/ip/страна/репутация).
// Обновляем ТОЛЬКО по известным id (прокси текущего пользователя) — не задевая чужие записи.
async function persistChecked(
  checked: Array<{ url: string; ok: boolean; ip?: string; country?: string; datacenter?: boolean | null; vpn?: boolean | null }>,
  idByUrl: Map<string, string>,
): Promise<void> {
  try {
    await Promise.all((checked ?? []).map((c) => {
      const id = idByUrl.get(c.url)
      if (!id) return null
      const flagged = c.ok ? Boolean(c.datacenter || c.vpn) : null
      return prisma.proxy.update({
        where: { id },
        data: c.ok
          ? { status: 'alive', lastCheckedAt: new Date(), ip: c.ip ?? null, country: c.country ?? null, datacenter: c.datacenter ?? null, vpn: c.vpn ?? null, flagged }
          : { status: 'dead', lastCheckedAt: new Date(), flagged: null },
      }).catch(() => null)
    }))
  } catch { /* сохранение здоровья не критично для входа */ }
}

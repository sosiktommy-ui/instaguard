import { prisma } from '@/lib/prisma'
import { browserPickProxy } from '@/lib/browser/client'

/**
 * Подбор пулового прокси для подключения аккаунта.
 *
 * Опирается на СОХРАНЁННОЕ здоровье прокси:
 *  1. Заведомо годный (status=alive, не датацентр, не выжжен Instagram) берётся СРАЗУ, без
 *     обращения к воркеру — убирает главный баг: при мёртвых кандидатах live-проверка упиралась
 *     в таймаут (75с), и подбор молча брал первый попавшийся (часто датацентр) прокси.
 *  2. РОТАЦИЯ среди равнозагруженных годных: раньше всегда возвращался «первый годный», поэтому
 *     ВСЕ аккаунты шли через один и тот же IP — если он выжжен Instagram, умирали все подряд.
 *     Теперь выбор случайный среди наименее занятых → аккаунты распределяются по разным IP.
 *  3. Заведомо мёртвые (status=dead) и выжженные Instagram (igBlocked) исключаются.
 *  4. Непроверенные (status=unknown) проверяются вживую; узнанное здоровье сохраняется в БД.
 */
export type PoolPick =
  | { ok: true; url: string; id: string; flagged: boolean; country: string | null }
  | { ok: false; reason: 'no-capacity' | 'all-dead' }

const MAX_CANDIDATES = 30

type Cand = { id: string; url: string; status: string | null; flagged: boolean | null; igBlocked: boolean | null; country: string | null; load: number }

// «Instagram выжег этот IP»: ТОЛЬКО явный сигнал про IP («change your IP … blacklist»).
// НЕ ловим UserInvalidCredentials — это общий exception_name Instagram и для «аккаунт не
// найден», и для неверного пароля. Раньше по нему ошибочно метились как «выжженные» ХОРОШИЕ
// свежие прокси на ошибке уровня аккаунта (баг: ошибка аккаунта ≠ бан IP).
export function isInstagramBlacklist(msg: string): boolean {
  return /чёрном списке|blacklist|blocklist|change your ip/i.test(msg || '')
}

// «Instagram не находит аккаунт» (invalid_user) — проблема АККАУНТА (отключён / удалён /
// переименован ИЛИ анти-бот-заглушка), а НЕ прокси. Такой ответ не должен метить IP.
export function isAccountNotFound(msg: string): boolean {
  return /can'?t find (an )?account|find an account with|invalid_user|switch_to_signup_flow/i.test(msg || '')
}

// Пометить прокси как выжженный Instagram — подбор перестанет его предлагать.
export async function markProxyBlocked(id: string | null | undefined): Promise<void> {
  if (!id) return
  await prisma.proxy.update({ where: { id }, data: { igBlocked: true, lastCheckedAt: new Date() } }).catch(() => null)
}

// Случайный среди наименее занятых — ротация, чтобы не сажать все аккаунты на один IP.
function pickRotating(list: Cand[]): Cand {
  const minLoad = Math.min(...list.map((p) => p.load))
  const least = list.filter((p) => p.load === minLoad)
  return least[Math.floor(Math.random() * least.length)]
}

export async function pickPoolProxy(userId: string, cap: number, excludeIds: string[] = []): Promise<PoolPick> {
  const pool = await prisma.proxy.findMany({
    where: { userId, kind: 'pool', ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}) },
    select: { id: true, url: true, status: true, flagged: true, igBlocked: true, country: true, _count: { select: { accounts: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const free: Cand[] = pool
    .filter((p) => p._count.accounts < cap)
    .map((p) => ({ id: p.id, url: p.url, status: p.status, flagged: p.flagged, igBlocked: p.igBlocked, country: p.country, load: p._count.accounts }))
  if (!free.length) return { ok: false, reason: 'no-capacity' }

  const notBurned = free.filter((p) => !p.igBlocked)
  const aliveClean = notBurned.filter((p) => p.status === 'alive' && p.flagged !== true)
  const unknown    = notBurned.filter((p) => p.status !== 'alive' && p.status !== 'dead')
  const aliveFlag  = notBurned.filter((p) => p.status === 'alive' && p.flagged === true)
  const burned     = free.filter((p) => p.igBlocked)
  // status === 'dead' — исключаем полностью

  // 1) Годный (не датацентр, не IG-бан) — сразу, с ротацией, без обращения к воркеру.
  if (aliveClean.length) {
    const p = pickRotating(aliveClean)
    return { ok: true, url: p.url, id: p.id, flagged: false, country: p.country }
  }

  // 2) Непроверенные — live-проверка (воркер пропустит мёртвые), с сохранением здоровья.
  if (unknown.length) {
    const idByUrl = new Map(free.map((p) => [p.url, p.id]))
    try {
      const res = await browserPickProxy(unknown.slice(0, MAX_CANDIDATES).map((p) => p.url))
      void persistChecked(res.checked, idByUrl)
      if (res.chosen) {
        const p = unknown.find((f) => f.url === res.chosen) ?? unknown[0]
        const chk = res.checked.find((c) => c.url === res.chosen)
        return { ok: true, url: p.url, id: p.id, flagged: Boolean(res.flagged), country: chk?.country ?? p.country }
      }
    } catch {
      const p = pickRotating(unknown)
      return { ok: true, url: p.url, id: p.id, flagged: false, country: p.country }
    }
  }

  // 3) Только датацентр/VPN (не IG-бан) — с ротацией, честно flagged.
  if (aliveFlag.length) {
    const p = pickRotating(aliveFlag)
    return { ok: true, url: p.url, id: p.id, flagged: true, country: p.country }
  }

  // 4) Остались только выжженные Instagram — последний шанс (вдруг IG снял бан); честно flagged.
  if (burned.length) {
    const p = pickRotating(burned)
    return { ok: true, url: p.url, id: p.id, flagged: true, country: p.country }
  }

  return { ok: false, reason: 'all-dead' }
}

// Сохранить в БД здоровье, узнанное воркером при live-подборе. Обновляем только по известным id.
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

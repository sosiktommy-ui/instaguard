/**
 * §4.6 — здоровье ДОСТАВКИ директов на аккаунт. Только подтверждённая доставка (§4.6:
 * confirmDelivered в воркере) считается успехом; систематическая недоставка = лички закрыты
 * массово / мягкое ограничение Instagram → нужно (а) уведомить владельца, (б) СНИЗИТЬ темп DM,
 * чтобы не долбить аккаунт впустую (сам по себе ban-сигнал).
 *
 * Счётчик дневной (сброс по дате, как limits). Пишется read-modify-write ИЗ ДВУХ процессов
 * (poll — коммент-поток, dm-воркер — поток подписчиков), но ВСЕГДА под per-account browserLock
 * (§4.8) — оба DM-пути держат этот лок во время отправки, поэтому RMW здесь гонки не имеет.
 */
import { dayKey } from './limits'

export interface DeliveryStats {
  date: string
  tried: number       // сколько директов пытались отправить сегодня
  ok: number          // сколько ПОДТВЕРЖДЁННО доставлено
  lastAlert?: number  // ts последнего алерта владельцу (троттлинг)
}

// Ниже MIN_SAMPLE выборка мала — не судим (иначе 1 закрытая личка = «нездорово»).
export const DELIVERY_MIN_SAMPLE = 6
// Доля доставленных ниже этого = нездорово (>60% директов не дошли).
export const DELIVERY_MIN_OK_RATIO = 0.4
// Не чаще одного алерта в 3 часа на аккаунт.
export const DELIVERY_ALERT_THROTTLE_MS = 3 * 60 * 60 * 1000
// Во сколько раз резать дневной лимит DM, пока доставка нездорова.
export const DELIVERY_SLOWDOWN_FACTOR = 0.3

export function loadDelivery(raw: unknown): DeliveryStats {
  const today = dayKey()
  const r = (raw ?? {}) as Record<string, unknown>
  const lastAlert = Number(r.lastAlert) || 0
  if (r.date !== today) return { date: today, tried: 0, ok: 0, lastAlert }
  return { date: today, tried: Number(r.tried) || 0, ok: Number(r.ok) || 0, lastAlert }
}

/** true — доставка систематически проваливается (достаточно попыток И низкая доля успеха). */
export function deliveryUnhealthy(d: DeliveryStats): boolean {
  return d.tried >= DELIVERY_MIN_SAMPLE && d.ok / d.tried < DELIVERY_MIN_OK_RATIO
}

type DeliveryDb = {
  instagramAccount: {
    findUnique(args: any): Promise<{ deliveryStats: unknown } | null>
    update(args: any): Promise<unknown>
  }
  log: { create(args: any): Promise<unknown> }
}

/**
 * Записывает исход отправки (tried/ok) в дневной счётчик аккаунта и, если доставка стала
 * нездоровой, шлёт троттлированный WARN-алерт владельцу. Вызывать ТОЛЬКО под browserLock
 * (§4.8) — иначе RMW между процессами потеряет инкременты. now — Date.now() вызывающего.
 */
export async function recordDelivery(db: DeliveryDb, accountId: string, tried: number, ok: number, now: number): Promise<void> {
  if (tried <= 0) return
  const acc = await db.instagramAccount.findUnique({ where: { id: accountId }, select: { deliveryStats: true } }).catch(() => null)
  const d = loadDelivery(acc?.deliveryStats)
  d.tried += tried
  d.ok += ok
  let alert = false
  if (deliveryUnhealthy(d) && now - (d.lastAlert ?? 0) >= DELIVERY_ALERT_THROTTLE_MS) {
    d.lastAlert = now
    alert = true
  }
  await db.instagramAccount.update({ where: { id: accountId }, data: { deliveryStats: d as any } }).catch(() => null)
  if (alert) {
    const pct = Math.round((1 - d.ok / d.tried) * 100)
    await db.log.create({
      data: {
        accountId, level: 'WARN',
        message: `⚠️ Директы не доходят: ${pct}% недоставлено сегодня (${d.tried - d.ok} из ${d.tried}). Вероятно, лички закрыты массово или мягкое ограничение Instagram — темп DM автоматически снижен. Проверьте аккаунт.`,
      },
    }).catch(() => null)
  }
}

/**
 * Дневные лимиты действий на аккаунт (защита от бана).
 * Счётчики хранятся в InstagramAccount.limits (JSON) и сбрасываются раз в сутки.
 * Значения консервативные — можно поднять по мере «прогрева» аккаунта.
 */
export type ActionKind = 'dm' | 'follow' | 'like' | 'comment' | 'story'

export const DAILY_CAPS: Record<ActionKind, number> = {
  dm: 30,       // DM в сутки (особенно неподписчикам — самый рискованный лимит)
  follow: 40,   // подписок в сутки
  like: 80,     // лайков в сутки
  comment: 20,  // публичных комментариев в сутки
  story: 80,    // просмотров/лайков сторис в сутки
}

// Максимум НОВЫХ целей (подписчиков/комментариев), обрабатываемых за одну проверку
export const MAX_NEW_PER_POLL = 12

export interface Counters {
  date: string
  dm: number; follow: number; like: number; comment: number; story: number
}

export function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10)
}

export function loadCounters(raw: unknown): Counters {
  const today = dayKey()
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.date !== today) return { date: today, dm: 0, follow: 0, like: 0, comment: 0, story: 0 }
  return {
    date: today,
    dm: Number(r.dm) || 0,
    follow: Number(r.follow) || 0,
    like: Number(r.like) || 0,
    comment: Number(r.comment) || 0,
    story: Number(r.story) || 0,
  }
}

export function remaining(c: Counters, k: ActionKind): number {
  return Math.max(0, DAILY_CAPS[k] - c[k])
}

/** Пытается «занять» бюджет действия. true — можно выполнять (и счётчик увеличен). */
export function consume(c: Counters, k: ActionKind, n = 1): boolean {
  if (remaining(c, k) < n) return false
  c[k] += n
  return true
}

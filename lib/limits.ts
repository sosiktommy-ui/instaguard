/**
 * Дневные лимиты действий на аккаунт (защита от бана).
 * Счётчики хранятся в InstagramAccount.limits (JSON) и сбрасываются раз в сутки.
 * Значения консервативные — можно поднять по мере «прогрева» аккаунта.
 */
export type ActionKind = 'dm' | 'follow' | 'like' | 'comment' | 'story'

// PLAN-IDEAL §1.8: приоритет ВЫЖИВАНИЕ ≫ скорость. Дефолты сознательно КОНСЕРВАТИВНЫ
// (снижены с dm30/follow40/like80/comment20/story80). Лучше 8 директов в день и живой
// аккаунт, чем 30 и бан. Ещё режутся прогревом по возрасту (warmupFactor) и суточным ритмом.
export const DAILY_CAPS: Record<ActionKind, number> = {
  dm: 10,       // DM в сутки (особенно неподписчикам — самый рискованный лимит)
  follow: 12,   // подписок в сутки
  like: 30,     // лайков в сутки
  comment: 8,   // публичных комментариев в сутки
  story: 40,    // просмотров/лайков сторис в сутки
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

export type Caps = Record<ActionKind, number>

export function remaining(c: Counters, k: ActionKind, caps: Caps = DAILY_CAPS): number {
  return Math.max(0, caps[k] - c[k])
}

/** Пытается «занять» бюджет действия. true — можно выполнять (и счётчик увеличен). */
export function consume(c: Counters, k: ActionKind, n = 1, caps: Caps = DAILY_CAPS): boolean {
  if (remaining(c, k, caps) < n) return false
  c[k] += n
  return true
}

/* ─── Прогрев (warmup) ────────────────────────────────────────────────────────
 * Свежий аккаунт, сразу выкручивающий действия на полный дневной лимит, — прямой
 * путь в бан. Поэтому лимиты «разгоняются» по мере возраста аккаунта в системе:
 * день 0 — WARMUP_FLOOR от потолка, к WARMUP_DAYS дню — 100%. Множитель применяется
 * автоматически на каждом поллинге (см. app/api/poll/route.ts). Для черновых берётся
 * более строгий из двух возрастов (основной / черновой), чтобы молодой черновой
 * тоже не срывался на полную мощность.
 */
export const WARMUP_DAYS = 14      // за сколько дней аккаунт выходит на полные лимиты
export const WARMUP_FLOOR = 0.15   // доля лимита в день 0 (15%)

/** Коэффициент прогрева 0.15..1 по возрасту аккаунта. Нет даты (старые записи) → 1 (полные лимиты). */
export function warmupFactor(createdAt?: Date | string | null): number {
  if (!createdAt) return 1
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt)
  const ms = Date.now() - created.getTime()
  if (!Number.isFinite(ms) || ms < 0) return 1  // будущая/битая дата → не занижаем
  const ageDays = ms / 86_400_000
  if (ageDays >= WARMUP_DAYS) return 1
  return Math.min(1, Math.max(WARMUP_FLOOR, WARMUP_FLOOR + (1 - WARMUP_FLOOR) * (ageDays / WARMUP_DAYS)))
}

/** Процент прогрева для UI (0..100). */
export function warmupPct(createdAt?: Date | string | null): number {
  return Math.round(warmupFactor(createdAt) * 100)
}

/** Дневные лимиты, ужатые под текущий коэффициент прогрева (минимум 1 действие). */
export function scaleCaps(factor: number): Caps {
  const f = Math.min(1, Math.max(0, factor))
  return {
    dm:      Math.max(1, Math.ceil(DAILY_CAPS.dm * f)),
    follow:  Math.max(1, Math.ceil(DAILY_CAPS.follow * f)),
    like:    Math.max(1, Math.ceil(DAILY_CAPS.like * f)),
    comment: Math.max(1, Math.ceil(DAILY_CAPS.comment * f)),
    story:   Math.max(1, Math.ceil(DAILY_CAPS.story * f)),
  }
}

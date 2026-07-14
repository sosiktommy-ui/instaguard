/**
 * Дневные лимиты действий на аккаунт (защита от бана).
 * Счётчики хранятся в InstagramAccount.limits (JSON) и сбрасываются раз в сутки.
 * Значения консервативные — можно поднять по мере «прогрева» аккаунта.
 */
export type ActionKind = 'dm' | 'follow' | 'like' | 'comment' | 'story'

// Дефолтные дневные лимиты. Приоритет — выживание аккаунта, но т.к. директы идут в основном
// ТЁПЛЫМ подписчикам (низкий риск), директ поднят с 10 до 25. follow/like умереннее (масс-фолловинг
// и лайки чужого контента рискованнее). Ещё режутся прогревом по возрасту (warmupFactor) и ритмом.
// Пользователь может переопределить в Настройках (UserSettings.dailyCaps), кламп CAP_MAX ниже.
export const DAILY_CAPS: Record<ActionKind, number> = {
  dm: 25,       // директов в сутки (в основном тёплым подписчикам — низкий риск)
  follow: 15,   // подписок в сутки (масс-фолловинг рискованнее — умереннее)
  like: 40,     // лайков в сутки
  comment: 10,  // публичных комментариев в сутки
  story: 50,    // просмотров/лайков сторис в сутки
}

// Жёсткий потолок пользовательских лимитов (защита от «фат-фингера» = гарантированный бан).
export const CAP_MAX: Record<ActionKind, number> = { dm: 60, follow: 40, like: 120, comment: 30, story: 150 }

// Сливает пользовательский override с дефолтами и клампит в [0, CAP_MAX]. 0 = действие выключено.
export function mergeCaps(override: unknown): Caps {
  const o = (override ?? {}) as Record<string, unknown>
  const out = { ...DAILY_CAPS }
  for (const k of Object.keys(DAILY_CAPS) as ActionKind[]) {
    const v = Number(o[k])
    if (Number.isFinite(v) && v >= 0) out[k] = Math.min(CAP_MAX[k], Math.floor(v))
  }
  return out
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

/**
 * Дневные лимиты, ужатые под текущий коэффициент прогрева. База — дефолты ИЛИ пользовательский
 * override (base). Действие с лимитом 0 остаётся 0 (выключено); ненулевые — минимум 1.
 */
export function scaleCaps(factor: number, base: Caps = DAILY_CAPS): Caps {
  const f = Math.min(1, Math.max(0, factor))
  const scale = (v: number) => (v <= 0 ? 0 : Math.max(1, Math.ceil(v * f)))
  return {
    dm:      scale(base.dm),
    follow:  scale(base.follow),
    like:    scale(base.like),
    comment: scale(base.comment),
    story:   scale(base.story),
  }
}

import { describe, it, expect } from 'vitest'
import {
  DAILY_CAPS, remaining, consume, warmupFactor, scaleCaps,
  WARMUP_DAYS, WARMUP_FLOOR, mergeCaps, normalizeCaps, CAP_MAX, OFF_CAP, type Counters,
} from '@/lib/limits'

function counters(over: Partial<Counters> = {}): Counters {
  return { date: '2026-07-10', dm: 0, follow: 0, like: 0, comment: 0, story: 0, ...over }
}

describe('remaining', () => {
  it('возвращает cap − счётчик', () => {
    expect(remaining(counters({ dm: 3 }), 'dm')).toBe(DAILY_CAPS.dm - 3)
  })
  it('никогда не отрицательное (перебор счётчика)', () => {
    expect(remaining(counters({ dm: DAILY_CAPS.dm + 5 }), 'dm')).toBe(0)
  })
  it('уважает переданные caps', () => {
    expect(remaining(counters({ like: 2 }), 'like', { ...DAILY_CAPS, like: 5 })).toBe(3)
  })
})

describe('consume', () => {
  it('занимает бюджет и увеличивает счётчик, когда есть место', () => {
    const c = counters({ dm: 0 })
    expect(consume(c, 'dm')).toBe(true)
    expect(c.dm).toBe(1)
  })
  it('отказывает и НЕ трогает счётчик, когда места нет', () => {
    const c = counters({ follow: DAILY_CAPS.follow })
    expect(consume(c, 'follow')).toBe(false)
    expect(c.follow).toBe(DAILY_CAPS.follow)
  })
  it('отказывает, если запрошено больше остатка (n)', () => {
    const c = counters({ like: DAILY_CAPS.like - 1 })
    expect(consume(c, 'like', 2)).toBe(false)
    expect(c.like).toBe(DAILY_CAPS.like - 1)
  })
})

describe('warmupFactor', () => {
  it('нет даты → 1 (старые записи не занижаем)', () => {
    expect(warmupFactor(null)).toBe(1)
    expect(warmupFactor(undefined)).toBe(1)
  })
  it('будущая/битая дата → 1', () => {
    const future = new Date(Date.now() + 86_400_000)
    expect(warmupFactor(future)).toBe(1)
    expect(warmupFactor('не-дата')).toBe(1)
  })
  it('день 0 → WARMUP_FLOOR', () => {
    const f = warmupFactor(new Date())
    expect(f).toBeGreaterThanOrEqual(WARMUP_FLOOR)
    expect(f).toBeLessThan(WARMUP_FLOOR + 0.01)
  })
  it('возраст ≥ WARMUP_DAYS → 1', () => {
    const old = new Date(Date.now() - (WARMUP_DAYS + 1) * 86_400_000)
    expect(warmupFactor(old)).toBe(1)
  })
  it('середина прогрева — между FLOOR и 1', () => {
    const mid = new Date(Date.now() - (WARMUP_DAYS / 2) * 86_400_000)
    const f = warmupFactor(mid)
    expect(f).toBeGreaterThan(WARMUP_FLOOR)
    expect(f).toBeLessThan(1)
  })
})

describe('scaleCaps', () => {
  it('factor 1 → полные дневные лимиты', () => {
    expect(scaleCaps(1)).toEqual(DAILY_CAPS)
  })
  it('factor 0 → минимум 1 действие каждого типа (не ноль)', () => {
    const caps = scaleCaps(0)
    for (const v of Object.values(caps)) expect(v).toBe(1)
  })
  it('дробный factor округляется вверх (ceil)', () => {
    const caps = scaleCaps(0.5)
    expect(caps.dm).toBe(Math.ceil(DAILY_CAPS.dm * 0.5))
    expect(caps.like).toBe(Math.ceil(DAILY_CAPS.like * 0.5))
  })
  it('factor за пределами [0,1] клампится', () => {
    expect(scaleCaps(5)).toEqual(DAILY_CAPS)
    for (const v of Object.values(scaleCaps(-3))) expect(v).toBe(1)
  })
})

// §8.1 — серверный кламп пользовательских лимитов (последний рубеж: клиент можно обойти).
describe('mergeCaps — эффективные лимиты для поллинга', () => {
  it('off:true → все лимиты OFF_CAP (лимиты отключены)', () => {
    expect(mergeCaps({ off: true })).toEqual({ dm: OFF_CAP, follow: OFF_CAP, like: OFF_CAP, comment: OFF_CAP, story: OFF_CAP })
  })
  it('значение выше CAP_MAX клампится до потолка', () => {
    const c = mergeCaps({ dm: 999999, like: 99999 })
    expect(c.dm).toBe(CAP_MAX.dm)
    expect(c.like).toBe(CAP_MAX.like)
  })
  it('отрицательное значение игнорируется → остаётся дефолт', () => {
    expect(mergeCaps({ follow: -50 }).follow).toBe(DAILY_CAPS.follow)
  })
  it('дробное значение округляется вниз', () => {
    expect(mergeCaps({ dm: 10.9 }).dm).toBe(10)
  })
  it('0 разрешён (действие выключено)', () => {
    expect(mergeCaps({ comment: 0 }).comment).toBe(0)
  })
  it('нечисло (NaN) → дефолт; посторонние ключи игнорируются', () => {
    const c = mergeCaps({ dm: 'abc', story: 'xyz', wat: 5 })
    expect(c.dm).toBe(DAILY_CAPS.dm)
    expect(c.story).toBe(DAILY_CAPS.story)
    expect(c).not.toHaveProperty('wat')
  })
  it('null/undefined → все дефолты', () => {
    expect(mergeCaps(null)).toEqual(DAILY_CAPS)
    expect(mergeCaps(undefined)).toEqual(DAILY_CAPS)
  })
})

describe('normalizeCaps — вид для хранения/UI (числа сохраняются даже при off)', () => {
  it('off:true → флаг off, но пользовательские числа НЕ подменяются на OFF_CAP', () => {
    const c = normalizeCaps({ off: true, dm: 30, follow: 12 })
    expect(c.off).toBe(true)
    expect(c.dm).toBe(30)
    expect(c.follow).toBe(12)
  })
  it('клампит выше потолка и округляет; off по умолчанию false', () => {
    const c = normalizeCaps({ dm: 99999, like: 7.8 })
    expect(c.dm).toBe(CAP_MAX.dm)
    expect(c.like).toBe(7)
    expect(c.off).toBe(false)
  })
})

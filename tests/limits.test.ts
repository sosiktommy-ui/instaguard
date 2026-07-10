import { describe, it, expect } from 'vitest'
import {
  DAILY_CAPS, remaining, consume, warmupFactor, scaleCaps,
  WARMUP_DAYS, WARMUP_FLOOR, type Counters,
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

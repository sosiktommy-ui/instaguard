import { describe, it, expect } from 'vitest'
import { activityWindow } from '@/lib/activity'

// Фиксированное «сейчас» в конкретном локальном часе (tz=UTC → localHour = час UTC).
const at = (hourUTC: number) => new Date(`2026-07-20T${String(hourUTC).padStart(2, '0')}:00:00Z`)
const USERS = Array.from({ length: 300 }, (_, i) => `user_${i}`)

describe('activityWindow — гейтинг по суточному ритму', () => {
  it('нет tz → не гейтим (active)', () => {
    expect(activityWindow(null, 'u', at(3)).active).toBe(true)
    expect(activityWindow(undefined, 'u', at(3)).active).toBe(true)
  })
  it('нераспознанная tz → не гейтим', () => {
    expect(activityWindow('Not/AZone', 'u', at(3)).active).toBe(true)
  })
  it('глубокая ночь (03:00) → тишина (quiet-hours; редко rest-day)', () => {
    // старт окна 7–9 по seed → 3 всегда до старта. Reason — quiet-hours, кроме ~8% «выходных».
    for (const u of USERS.slice(0, 30)) {
      const r = activityWindow('UTC', u, at(3))
      expect(r.active).toBe(false)
      expect(['quiet-hours', 'rest-day']).toContain(r.reason)
    }
    // большинство — именно quiet-hours (не rest-day)
    const night = USERS.map((u) => activityWindow('UTC', u, at(3)).reason)
    expect(night.filter((x) => x === 'quiet-hours').length).toBeGreaterThan(night.filter((x) => x === 'rest-day').length)
  })
})

describe('activityWindow — §6.1 пики утро/вечер', () => {
  it('в ПИКОВЫЙ час (10:00) никто не получает off-peak-lull', () => {
    const reasons = USERS.map((u) => activityWindow('UTC', u, at(10)).reason)
    expect(reasons.some((r) => r === 'off-peak-lull')).toBe(false)
  })
  it('в НЕПИКОВЫЙ час (15:00) часть аккаунтов уходит в off-peak-lull', () => {
    const lulls = USERS.filter((u) => activityWindow('UTC', u, at(15)).reason === 'off-peak-lull')
    expect(lulls.length).toBeGreaterThan(0)          // распределение работает
    expect(lulls.length).toBeLessThan(USERS.length)  // но не все — интенсивность 0.6
  })
  it('активных в пик (10:00) СТРОГО больше, чем в спад (15:00)', () => {
    const active = (h: number) => USERS.filter((u) => activityWindow('UTC', u, at(h)).active).length
    expect(active(10)).toBeGreaterThan(active(15))
  })
})

describe('activityWindow — детерминизм и стабильность', () => {
  it('одинаковые входы → одинаковый результат', () => {
    for (const u of USERS.slice(0, 30)) {
      expect(activityWindow('UTC', u, at(15))).toEqual(activityWindow('UTC', u, at(15)))
    }
  })
  it('решение стабильно в пределах часа (разные минуты того же часа)', () => {
    const a = activityWindow('UTC', 'user_42', new Date('2026-07-20T15:05:00Z'))
    const b = activityWindow('UTC', 'user_42', new Date('2026-07-20T15:55:00Z'))
    expect(a.active).toBe(b.active)
    expect(a.reason).toBe(b.reason)
  })
})

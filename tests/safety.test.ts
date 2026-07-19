import { describe, it, expect } from 'vitest'
import { securityIndex } from '@/lib/safety'
import { dayKey } from '@/lib/limits'

const today = dayKey()
// Здоровый базовый аккаунт: без прочих штрафов (ACTIVE, сессия, прокси, свежая проверка, прогрет).
const base = {
  status: 'ACTIVE',
  hasSession: true,
  proxy: 'http://user:pass@host:1000',
  errorCount: 0,
  lastChecked: new Date().toISOString(),
  createdAt: '2020-01-01',
}

describe('securityIndex — фактор здоровья доставки директов (§4.6)', () => {
  it('нездоровая доставка (много попыток, мало доставлено) даёт штраф −25', () => {
    const s = securityIndex({ ...base, deliveryStats: { date: today, tried: 10, ok: 2 } })
    const f = s.factors.find((x) => x.label.includes('Директы не доходят'))
    expect(f).toBeTruthy()
    expect(f!.ok).toBe(false)
    expect(f!.delta).toBe(25)
  })

  it('здоровая доставка — зелёный фактор без штрафа', () => {
    const s = securityIndex({ ...base, deliveryStats: { date: today, tried: 10, ok: 9 } })
    const f = s.factors.find((x) => x.label.includes('Директы доходят'))
    expect(f).toBeTruthy()
    expect(f!.ok).toBe(true)
    expect(f!.delta).toBe(0)
  })

  it('мало попыток (< MIN_SAMPLE=6) — фактор доставки не показываем (мало данных)', () => {
    const s = securityIndex({ ...base, deliveryStats: { date: today, tried: 3, ok: 0 } })
    expect(s.factors.some((x) => x.label.toLowerCase().includes('директ'))).toBe(false)
  })

  it('прошлый день (устаревшая дата) — счётчик сбрасывается → фактор не показываем', () => {
    const s = securityIndex({ ...base, deliveryStats: { date: '2000-01-01', tried: 10, ok: 0 } })
    expect(s.factors.some((x) => x.label.toLowerCase().includes('директ'))).toBe(false)
  })

  it('нет deliveryStats — фактор не показываем (обратная совместимость)', () => {
    const s = securityIndex({ ...base })
    expect(s.factors.some((x) => x.label.toLowerCase().includes('директ'))).toBe(false)
  })

  it('нездоровая доставка режет итоговый балл относительно здоровой', () => {
    const bad = securityIndex({ ...base, deliveryStats: { date: today, tried: 10, ok: 2 } })
    const good = securityIndex({ ...base, deliveryStats: { date: today, tried: 10, ok: 9 } })
    expect(bad.score).toBe(good.score - 25)
    expect(bad.score).toBeLessThan(good.score)
  })
})

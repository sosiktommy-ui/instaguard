import { describe, it, expect } from 'vitest'
import { loadDelivery, deliveryUnhealthy, DELIVERY_MIN_SAMPLE, DELIVERY_MIN_OK_RATIO } from '@/lib/delivery'
import { dayKey } from '@/lib/limits'

const today = dayKey()

describe('loadDelivery — дневной счётчик доставки директов (§4.6)', () => {
  it('сегодняшняя дата → читает tried/ok', () => {
    const d = loadDelivery({ date: today, tried: 8, ok: 3, lastAlert: 123 })
    expect(d).toEqual({ date: today, tried: 8, ok: 3, lastAlert: 123 })
  })
  it('устаревшая дата → сброс tried/ok (но lastAlert переносится)', () => {
    const d = loadDelivery({ date: '2000-01-01', tried: 50, ok: 1, lastAlert: 999 })
    expect(d.date).toBe(today)
    expect(d.tried).toBe(0)
    expect(d.ok).toBe(0)
    expect(d.lastAlert).toBe(999)   // троттлинг алерта переносится через границу дня
  })
  it('null/мусор → нулевой счётчик на сегодня', () => {
    expect(loadDelivery(null)).toEqual({ date: today, tried: 0, ok: 0, lastAlert: 0 })
    expect(loadDelivery({ date: today, tried: 'x', ok: undefined })).toEqual({ date: today, tried: 0, ok: 0, lastAlert: 0 })
  })
})

describe('deliveryUnhealthy — порог «директы не доходят»', () => {
  it('мало попыток (< MIN_SAMPLE) → НЕ нездорово, даже при 0 доставленных', () => {
    expect(deliveryUnhealthy({ date: today, tried: DELIVERY_MIN_SAMPLE - 1, ok: 0 })).toBe(false)
  })
  it('достаточно попыток + доля < 40% → нездорово', () => {
    expect(deliveryUnhealthy({ date: today, tried: 10, ok: 3 })).toBe(true)   // 30%
  })
  it('достаточно попыток + доля ≥ 40% → здорово', () => {
    expect(deliveryUnhealthy({ date: today, tried: 10, ok: 4 })).toBe(false)  // 40% ровно — не нездорово
    expect(deliveryUnhealthy({ date: today, tried: 10, ok: 9 })).toBe(false)
  })
  it('ровно на границе MIN_SAMPLE с низкой долей → нездорово', () => {
    const badOk = Math.floor(DELIVERY_MIN_SAMPLE * DELIVERY_MIN_OK_RATIO) - 1
    expect(deliveryUnhealthy({ date: today, tried: DELIVERY_MIN_SAMPLE, ok: Math.max(0, badOk) })).toBe(true)
  })
})

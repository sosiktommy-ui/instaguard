import { describe, it, expect } from 'vitest'
import { rateLimit } from '@/lib/rateLimit'

// §0.2 PLAN.md: серверный кулдаун повторных попыток входа в аккаунт Instagram (accounts/auth/route.ts)
// построен на этом примитиве — покрываем его поведение напрямую (чистая функция, без сети/БД).

describe('rateLimit — фиксированное окно по ключу', () => {
  it('разрешает попытки в пределах лимита', () => {
    const key = `t:${Math.random()}`
    expect(rateLimit(key, 3, 60_000).ok).toBe(true)
    expect(rateLimit(key, 3, 60_000).ok).toBe(true)
    expect(rateLimit(key, 3, 60_000).ok).toBe(true)
  })

  it('блокирует попытку сверх лимита с retryAfter > 0', () => {
    const key = `t:${Math.random()}`
    rateLimit(key, 2, 60_000)
    rateLimit(key, 2, 60_000)
    const r = rateLimit(key, 2, 60_000)
    expect(r.ok).toBe(false)
    expect(r.retryAfter).toBeGreaterThan(0)
  })

  it('разные ключи не влияют друг на друга (аккаунт A не блокирует аккаунт B)', () => {
    const a = `acc-a:${Math.random()}`
    const b = `acc-b:${Math.random()}`
    rateLimit(a, 1, 60_000)
    expect(rateLimit(a, 1, 60_000).ok).toBe(false)   // A исчерпан
    expect(rateLimit(b, 1, 60_000).ok).toBe(true)    // B не затронут
  })

  it('окно сбрасывается по истечении windowMs', async () => {
    const key = `t:${Math.random()}`
    expect(rateLimit(key, 1, 30).ok).toBe(true)
    expect(rateLimit(key, 1, 30).ok).toBe(false)
    await new Promise((r) => setTimeout(r, 40))
    expect(rateLimit(key, 1, 30).ok).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { entitlementsFromSubscription, canAddAccount, canUseTriggerType } from '@/lib/entitlements'

const NOW = new Date('2026-07-22T00:00:00Z')

describe('entitlementsFromSubscription', () => {
  it('нет подписки → Free (1 аккаунт, без платных фич, без прокси)', () => {
    const e = entitlementsFromSubscription(null, NOW)
    expect(e.plan).toBe('free')
    expect(e.paid).toBe(false)
    expect(e.maxAccounts).toBe(1)
    expect(e.proxyIncluded).toBe(false)
    expect(e.features.allTriggers).toBe(false)
    expect(e.daysLeft).toBeNull()
  })

  it('active Pro quantity=3 → платный, 3 аккаунта, прокси включён, все фичи', () => {
    const e = entitlementsFromSubscription({ plan: 'pro', status: 'active', quantity: 3, byop: false }, NOW)
    expect(e.paid).toBe(true)
    expect(e.maxAccounts).toBe(3)
    expect(e.proxyIncluded).toBe(true)
    expect(e.features.allTriggers).toBe(true)
    expect(e.features.autoAccept).toBe(true)
  })

  it('Pro quantity выше потолка тарифа → клампится (max 3)', () => {
    const e = entitlementsFromSubscription({ plan: 'pro', status: 'active', quantity: 99 }, NOW)
    expect(e.maxAccounts).toBe(3)
  })

  it('Pro + BYOP → прокси НЕ выдаём', () => {
    const e = entitlementsFromSubscription({ plan: 'pro', status: 'active', quantity: 2, byop: true }, NOW)
    expect(e.proxyIncluded).toBe(false)
    expect(e.maxAccounts).toBe(2)
  })

  it('trialing → считается платным (доступ есть)', () => {
    const e = entitlementsFromSubscription({ plan: 'pro', status: 'trialing', quantity: 1 }, NOW)
    expect(e.paid).toBe(true)
    expect(e.features.allTriggers).toBe(true)
  })

  it('past_due → грейс: доступ ещё держим', () => {
    const e = entitlementsFromSubscription({ plan: 'business', status: 'past_due', quantity: 5 }, NOW)
    expect(e.paid).toBe(true)
    expect(e.maxAccounts).toBe(5)
  })

  it('canceled → падаем на Free', () => {
    const e = entitlementsFromSubscription({ plan: 'pro', status: 'canceled', quantity: 3 }, NOW)
    expect(e.plan).toBe('free')
    expect(e.paid).toBe(false)
    expect(e.maxAccounts).toBe(1)
  })

  it('Agency без верхнего предела (maxAccounts=null) → quantity как есть', () => {
    const e = entitlementsFromSubscription({ plan: 'agency', status: 'active', quantity: 50 }, NOW)
    expect(e.maxAccounts).toBe(50)
  })

  it('Business quantity ниже минимума → поднимается к min (4)', () => {
    const e = entitlementsFromSubscription({ plan: 'business', status: 'active', quantity: 1 }, NOW)
    expect(e.maxAccounts).toBe(4)
  })

  it('daysLeft считается из currentPeriodEnd', () => {
    const e = entitlementsFromSubscription(
      { plan: 'pro', status: 'active', quantity: 1, currentPeriodEnd: '2026-08-01T00:00:00Z' }, NOW)
    expect(e.daysLeft).toBe(10)
  })

  it('истёкший период → daysLeft = 0 (не отрицательный)', () => {
    const e = entitlementsFromSubscription(
      { plan: 'pro', status: 'active', quantity: 1, currentPeriodEnd: '2026-07-01T00:00:00Z' }, NOW)
    expect(e.daysLeft).toBe(0)
  })
})

describe('canAddAccount', () => {
  it('Free: 0<1 → можно, 1<1 → нельзя', () => {
    const e = entitlementsFromSubscription(null, NOW)
    expect(canAddAccount(e, 0)).toBe(true)
    expect(canAddAccount(e, 1)).toBe(false)
  })
  it('Pro(3): 2 → можно, 3 → нельзя', () => {
    const e = entitlementsFromSubscription({ plan: 'pro', status: 'active', quantity: 3 }, NOW)
    expect(canAddAccount(e, 2)).toBe(true)
    expect(canAddAccount(e, 3)).toBe(false)
  })
})

describe('canUseTriggerType', () => {
  it('Free: только NEW_FOLLOWER', () => {
    const e = entitlementsFromSubscription(null, NOW)
    expect(canUseTriggerType(e, 'NEW_FOLLOWER')).toBe(true)
    expect(canUseTriggerType(e, 'NEW_COMMENT')).toBe(false)
    expect(canUseTriggerType(e, 'NEW_LIKE')).toBe(false)
  })
  it('Pro: любой тип', () => {
    const e = entitlementsFromSubscription({ plan: 'pro', status: 'active', quantity: 1 }, NOW)
    expect(canUseTriggerType(e, 'NEW_COMMENT')).toBe(true)
    expect(canUseTriggerType(e, 'STORY_MENTION')).toBe(true)
  })
})

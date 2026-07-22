// Stripe-слой (Фаза 3). ИНЕРТЕН без ключей (как 2captcha): нет STRIPE_SECRET_KEY → stripeConfigured()=false,
// роуты биллинга отвечают 503 «оплата ещё не подключена», ничего не ломается. Активируется, когда владелец
// заведёт в Stripe products/prices и добавит env-переменные (см. ниже).
//
// ENV-контракт (заполнить в Railway на сервисе Next.js):
//   STRIPE_SECRET_KEY        — секретный ключ Stripe (sk_live_… / sk_test_…)
//   STRIPE_WEBHOOK_SECRET    — секрет вебхука (whsec_…) из Stripe Dashboard → Webhooks
//   APP_URL                  — базовый URL сайта (https://reactivegram.com) для success/cancel
//   Price ID по тарифам (создать в Stripe, recurring, quantity=слоты аккаунтов):
//     STRIPE_PRICE_PRO_MONTH,  STRIPE_PRICE_PRO_YEAR,  STRIPE_PRICE_PRO_MONTH_BYOP,  STRIPE_PRICE_PRO_YEAR_BYOP
//     STRIPE_PRICE_BUSINESS_MONTH, STRIPE_PRICE_BUSINESS_YEAR, STRIPE_PRICE_BUSINESS_MONTH_BYOP, STRIPE_PRICE_BUSINESS_YEAR_BYOP
//   (Agency — «Связаться», без онлайн-оплаты.)

import Stripe from 'stripe'
import type { PlanId, BillingCycle } from './plans'

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('stripe_not_configured: STRIPE_SECRET_KEY не задан')
  if (!_stripe) _stripe = new Stripe(key) // apiVersion не пиним — берём дефолт SDK (типобезопасно)
  return _stripe
}

export function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://reactivegram.com').replace(/\/$/, '')
}

// Имя env-переменной для (plan, cycle, byop) → напр. STRIPE_PRICE_PRO_YEAR_BYOP
function envPriceName(plan: string, cycle: BillingCycle, byop: boolean): string {
  return `STRIPE_PRICE_${plan.toUpperCase()}_${cycle === 'yearly' ? 'YEAR' : 'MONTH'}${byop ? '_BYOP' : ''}`
}

/** (тариф, цикл, byop) → Stripe priceId (для создания Checkout). undefined = не сконфигурирован. */
export function priceIdFor(plan: PlanId, cycle: BillingCycle, byop: boolean): string | undefined {
  return process.env[envPriceName(plan, cycle, byop)]
}

/** priceId → {plan, cycle, byop} (для вебхука: определить тариф по оплаченному price). */
export function planFromPriceId(priceId: string | null | undefined): { plan: PlanId; cycle: BillingCycle; byop: boolean } | null {
  if (!priceId) return null
  const plans: PlanId[] = ['pro', 'business', 'agency']
  const cycles: BillingCycle[] = ['monthly', 'yearly']
  for (const plan of plans) for (const cycle of cycles) for (const byop of [false, true]) {
    if (process.env[envPriceName(plan, cycle, byop)] === priceId) return { plan, cycle, byop }
  }
  return null
}

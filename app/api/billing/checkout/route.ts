import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { getPlan, type PlanId, type BillingCycle } from '@/lib/plans'
import { stripeConfigured, getStripe, priceIdFor, appUrl } from '@/lib/stripe'

export const runtime = 'nodejs'

// Создать Stripe Checkout Session и вернуть URL на оплату. Инертно без ключей (503).
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  if (!stripeConfigured()) return NextResponse.json({ error: 'Онлайн-оплата ещё не подключена' }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const plan = String(body.plan || '') as PlanId
  const cycle: BillingCycle = body.cycle === 'yearly' ? 'yearly' : 'monthly'
  const byop = Boolean(body.byop)
  const catalog = getPlan(plan)
  if (catalog.id === 'free' || catalog.contact) {
    return NextResponse.json({ error: 'Этот тариф нельзя оформить онлайн' }, { status: 400 })
  }
  // quantity = число слотов аккаунтов, клампим в пределы тарифа
  const lo = catalog.minAccounts ?? 1
  const hi = catalog.maxAccounts ?? Number.MAX_SAFE_INTEGER
  const quantity = Math.min(Math.max(Number(body.quantity) || lo, lo), hi)

  const price = priceIdFor(plan, cycle, byop)
  if (!price) return NextResponse.json({ error: 'Тариф недоступен для оплаты (нет price ID)' }, { status: 400 })

  try {
    const stripe = getStripe()
    const sub = await prisma.subscription.findUnique({ where: { userId: user.id } }).catch(() => null)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity }],
      client_reference_id: user.id,                 // ← связь Stripe ↔ наш пользователь (используем в вебхуке)
      customer: sub?.stripeCustomerId || undefined,  // переиспользуем существующего Customer, если есть
      customer_email: sub?.stripeCustomerId ? undefined : user.email,
      subscription_data: catalog.trialDays ? { trial_period_days: catalog.trialDays } : undefined,
      allow_promotion_codes: true,
      success_url: `${appUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/pricing?canceled=1`,
    })
    return NextResponse.json({ url: session.url })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Ошибка Stripe' }, { status: 400 })
  }
}

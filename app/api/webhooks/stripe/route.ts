import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { stripeConfigured, getStripe, planFromPriceId } from '@/lib/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Вебхук Stripe — ИСТОЧНИК ПРАВДЫ по подпискам. Проверка подписи (RAW body) + идемпотентность (StripeEvent).
// Инертен без ключей (503). Обрабатывает: checkout.session.completed, customer.subscription.created/updated/
// deleted, invoice.paid, invoice.payment_failed.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeConfigured() || !secret) return NextResponse.json({ error: 'stripe off' }, { status: 503 })

  const sig = req.headers.get('stripe-signature')
  const raw = await req.text() // RAW тело обязательно для проверки подписи (не парсим JSON заранее)
  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(raw, sig ?? '', secret)
  } catch (e: any) {
    return NextResponse.json({ error: `bad signature: ${e?.message}` }, { status: 400 })
  }

  // Идемпотентность: повтор/дубль того же события → 200 и выход.
  const seen = await prisma.stripeEvent.findUnique({ where: { id: event.id } }).catch(() => null)
  if (seen) return NextResponse.json({ received: true, duplicate: true })

  try {
    await handleEvent(event)
  } catch (e) {
    // Не роняем 200 из-за нашей ошибки обработки — иначе Stripe будет ретраить бесконечно; лог + суточная сверка.
    console.error('[stripe webhook] handle error', event.type, e)
  } finally {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } }).catch(() => {})
  }
  return NextResponse.json({ received: true })
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session
      const userId = s.client_reference_id
      const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id
      if (!userId || !subId) return
      const sub = await getStripe().subscriptions.retrieve(subId)
      await applySub(userId, sub)
      break
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const userId = await userIdByCustomer(sub.customer)
      if (userId) await applySub(userId, sub)
      break
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = event.data.object as Stripe.Invoice
      const subId = typeof (inv as any).subscription === 'string' ? (inv as any).subscription : (inv as any).subscription?.id
      const userId = await userIdByCustomer(inv.customer)
      if (userId && subId) {
        const sub = await getStripe().subscriptions.retrieve(subId)
        await applySub(userId, sub)
      }
      break
    }
    default:
      break
  }
}

function customerId(c: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!c) return null
  return typeof c === 'string' ? c : c.id
}

async function userIdByCustomer(c: any): Promise<string | null> {
  const id = customerId(c)
  if (!id) return null
  const sub = await prisma.subscription.findFirst({ where: { stripeCustomerId: id }, select: { userId: true } }).catch(() => null)
  return sub?.userId ?? null
}

// Отобразить Stripe-подписку в нашу запись (upsert) + денормализованный кэш User.plan.
async function applySub(userId: string, sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0]
  const priceId = item?.price?.id ?? null
  const mapped = planFromPriceId(priceId)
  const cpeRaw = (sub as any).current_period_end ?? (item as any)?.current_period_end ?? null
  const data = {
    stripeCustomerId: customerId(sub.customer),
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    plan: mapped?.plan ?? 'pro',
    status: sub.status, // active | trialing | past_due | canceled | ...
    cycle: mapped?.cycle ?? 'monthly',
    quantity: item?.quantity ?? 1,
    byop: mapped?.byop ?? false,
    currentPeriodEnd: cpeRaw ? new Date(cpeRaw * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
  }
  await prisma.subscription.upsert({ where: { userId }, create: { userId, ...data }, update: data })
  await prisma.user.update({ where: { id: userId }, data: { plan: data.plan } }).catch(() => {})
}

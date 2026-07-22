import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { stripeConfigured, getStripe, appUrl } from '@/lib/stripe'

export const runtime = 'nodejs'

// Stripe Customer Portal — управление подпиской/картой/чеками. Возвращает URL.
export async function POST() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  if (!stripeConfigured()) return NextResponse.json({ error: 'Онлайн-оплата ещё не подключена' }, { status: 503 })

  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } }).catch(() => null)
  if (!sub?.stripeCustomerId) return NextResponse.json({ error: 'Нет активной подписки' }, { status: 400 })

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${appUrl()}/billing`,
    })
    return NextResponse.json({ url: session.url })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Ошибка Stripe' }, { status: 400 })
  }
}

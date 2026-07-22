// Слой прав доступа (entitlements): что пользователю РАЗРЕШЕНО по его подписке. ИСТОЧНИК ПРАВДЫ —
// таблица Subscription (наполняется вебхуками Stripe) + каталог тарифов lib/plans.ts.
//
// Архитектура (см. дизайн подписки): чистая `entitlementsFromSubscription()` тестируется без БД;
// `getEntitlements(userId)` читает БД. Гейты (`canAddAccount`/`canUseTriggerType`) — СЕРВЕРНЫЕ проверки,
// которые (Фаза 4) ставятся в API-роутах И в движке (poll/воркер): без прав функция недоступна никак,
// в т.ч. через прямой вызов API — обойти через UI нельзя. Пока НЕ подключены к роутам (аддитивно, инертно).

import { getPlan, type PlanId } from './plans'
import { prisma } from './prisma'

export type SubStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive' | 'free'

export interface Entitlements {
  plan: PlanId
  status: SubStatus
  paid: boolean               // активная ПЛАТНАЯ подписка (не free). past_due считаем платной (грейс-период)
  maxAccounts: number         // сколько Instagram-аккаунтов разрешено вести
  proxyIncluded: boolean      // выдаём ли прокси из пула (нет — если Free или BYOP)
  currentPeriodEnd: Date | null
  daysLeft: number | null     // осталось дней подписки (из currentPeriodEnd)
  features: { allTriggers: boolean; autoAccept: boolean; storyActions: boolean; likeActions: boolean }
}

// active/trialing — очевидно активны; past_due — платёж не прошёл, но держим доступ в грейс-период
// (Stripe сам ретраит списание). canceled/inactive → падаем на Free.
const PAID_ACTIVE = new Set(['active', 'trialing', 'past_due'])

export interface SubLike {
  plan?: string | null
  status?: string | null
  quantity?: number | null
  byop?: boolean | null
  currentPeriodEnd?: Date | string | null
}

/** Чистая функция (без БД): подписка → права. now — для тестируемого расчёта daysLeft. */
export function entitlementsFromSubscription(sub: SubLike | null, now: Date = new Date()): Entitlements {
  const paidActive = !!sub && PAID_ACTIVE.has(String(sub.status ?? ''))
  const planId: PlanId = (paidActive ? ((sub!.plan as PlanId) || 'free') : 'free')
  const plan = getPlan(planId)
  const paidFeatures = paidActive && planId !== 'free'

  let maxAccounts: number
  if (!paidFeatures) {
    maxAccounts = getPlan('free').maxAccounts ?? 1
  } else {
    const lo = plan.minAccounts ?? 1
    const hi = plan.maxAccounts ?? Number.MAX_SAFE_INTEGER   // Agency: без верхнего предела
    maxAccounts = Math.min(Math.max(sub!.quantity ?? lo, lo), hi)
  }

  const cpe = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null
  const daysLeft = cpe ? Math.max(0, Math.ceil((cpe.getTime() - now.getTime()) / 86400000)) : null

  return {
    plan: planId,
    status: (sub?.status as SubStatus) || 'free',
    paid: paidFeatures,
    maxAccounts,
    proxyIncluded: paidFeatures && plan.proxyIncluded && !(sub?.byop ?? false),
    currentPeriodEnd: cpe,
    daysLeft,
    features: paidFeatures
      ? { allTriggers: true, autoAccept: true, storyActions: true, likeActions: true }
      : { allTriggers: false, autoAccept: false, storyActions: false, likeActions: false },
  }
}

/** Права пользователя из БД (Subscription). Нет записи → Free (безопасный дефолт). */
export async function getEntitlements(userId: string): Promise<Entitlements> {
  const sub = await prisma.subscription.findUnique({ where: { userId } }).catch(() => null)
  return entitlementsFromSubscription(sub)
}

// ── Гейты (серверные проверки; Фаза 4 подключит к роутам/движку) ──────────────
/** Можно ли подключить ещё один Instagram-аккаунт (текущее число < лимита тарифа). */
export function canAddAccount(ent: Entitlements, currentCount: number): boolean {
  return currentCount < ent.maxAccounts
}
/** Разрешён ли тип триггера. Free — только «Новая подписка»; платные — все. */
export function canUseTriggerType(ent: Entitlements, triggerType: string): boolean {
  return ent.features.allTriggers || triggerType === 'NEW_FOLLOWER'
}

// ── Ручная выдача тарифа (comp) без Stripe ────────────────────────────────────
// Фаза 0 (grandfathering) + будущие comp/админ-гранты: выдать пользователю активную подписку
// вручную (stripe*-поля пустые = это ручной грант, не биллинг). По умолчанию — agency-безлимит.
export async function grantPlan(
  userId: string,
  opts: { plan?: PlanId; quantity?: number; status?: SubStatus } = {},
): Promise<void> {
  const plan = opts.plan ?? 'agency'
  const quantity = opts.quantity ?? 16
  const status = (opts.status ?? 'active') as string
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, plan, status, quantity },
    update: { plan, status, quantity },
  })
  await prisma.user.update({ where: { id: userId }, data: { plan } }).catch(() => {})
}

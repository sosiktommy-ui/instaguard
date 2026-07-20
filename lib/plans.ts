// Каталог тарифов — ЕДИНЫЙ источник правды для /pricing, /account и (Фаза 4) гейтинга прав.
// Модель (согласована с владельцем): платим за Instagram-аккаунт; на платных прокси включён;
// чем больше аккаунтов — тем дешевле за штуку. Валюта — EUR (европейское юрлицо).
// Год = −20%. BYOP (свой прокси) = дешевле на €10/аккаунт. Цифры легко правятся здесь же.

import { TONE } from '@/lib/colors'

export type PlanId = 'free' | 'pro' | 'business' | 'agency'
export type BillingCycle = 'monthly' | 'yearly'

export interface PlanFeature {
  text: string
  included: boolean
}

export interface Plan {
  id: PlanId
  name: string
  tagline: string
  accent: string // фирменный цвет карточки/иконки
  price: number // €/аккаунт в месяц при помесячной оплате (0 = бесплатно)
  perAccount: boolean // цена «за аккаунт» (true) или фиксированная (false)
  priceFrom?: boolean // показывать «от» (договорная)
  accountsLabel: string
  minAccounts: number
  maxAccounts: number | null // null = без ограничения (Agency)
  proxyIncluded: boolean
  trialDays: number
  recommended?: boolean
  cta: string
  contact?: boolean // CTA ведёт на «связаться», а не на оформление
  features: PlanFeature[]
  note?: string
}

export const YEARLY_DISCOUNT = 0.2 // −20% при оплате за год
export const BYOP_DISCOUNT = 10 // −€10/аккаунт со своим прокси
export const CURRENCY = '€'

const inc = (text: string): PlanFeature => ({ text, included: true })
const exc = (text: string): PlanFeature => ({ text, included: false })

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Попробовать без карты',
    accent: '#8e8e93',
    price: 0,
    perAccount: false,
    accountsLabel: '1 аккаунт',
    minAccounts: 1,
    maxAccounts: 1,
    proxyIncluded: false,
    trialDays: 0,
    cta: 'Начать бесплатно',
    features: [
      inc('1 Instagram-аккаунт'),
      inc('Свой прокси (BYOP)'),
      inc('Триггер «Новая подписка → директ»'),
      inc('Проверка раз в 6–12 часов'),
      exc('Все триггеры: комментарии, лайки, сторис'),
      exc('Авто-приём заявок в подписчики'),
      exc('Чистый прокси в гео включён'),
      exc('AI-ответы'),
    ],
    note: 'Бессрочно. Идеально познакомиться с сервисом.',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Для блога или бизнеса',
    accent: TONE.brand,
    price: 22,
    perAccount: true,
    accountsLabel: '1–3 аккаунта',
    minAccounts: 1,
    maxAccounts: 3,
    proxyIncluded: true,
    trialDays: 7,
    recommended: true,
    cta: 'Начать 7 дней бесплатно',
    features: [
      inc('1–3 Instagram-аккаунта'),
      inc('Чистый прокси в гео — включён'),
      inc('Все триггеры и полные лимиты'),
      inc('Авто-приём заявок в подписчики'),
      inc('Приоритетная проверка (1–3 ч)'),
      inc('Журнал и статистика'),
    ],
    note: 'Со своим прокси — дешевле на €10/аккаунт.',
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'Для агентств и нескольких аккаунтов',
    accent: TONE.alt,
    price: 18,
    perAccount: true,
    accountsLabel: '4–15 аккаунтов',
    minAccounts: 4,
    maxAccounts: 15,
    proxyIncluded: true,
    trialDays: 14,
    cta: 'Начать 14 дней бесплатно',
    features: [
      inc('Всё из Pro'),
      inc('4–15 аккаунтов'),
      inc('Чистый прокси в гео на каждый'),
      inc('AI-ответы'),
      inc('Максимальный приоритет проверки'),
      inc('Приоритетная поддержка'),
    ],
    note: 'Цена за аккаунт ниже — €18 вместо €22.',
  },
  {
    id: 'agency',
    name: 'Agency',
    tagline: '16+ аккаунтов, кастом',
    accent: '#4b2fb0',
    price: 15,
    perAccount: true,
    priceFrom: true,
    accountsLabel: '16+ аккаунтов',
    minAccounts: 16,
    maxAccounts: null,
    proxyIncluded: true,
    trialDays: 0,
    cta: 'Связаться',
    contact: true,
    features: [
      inc('Всё из Business'),
      inc('16+ аккаунтов'),
      inc('Индивидуальная цена от €15/аккаунт'),
      inc('Выделенная поддержка'),
      inc('Помощь с настройкой и миграцией'),
    ],
    note: 'Объёмная скидка и SLA — обсуждаем индивидуально.',
  },
]

export function getPlan(id: string | null | undefined): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0]
}

/** €/аккаунт (или фикс) в месяц для выбранного цикла оплаты */
export function planMonthly(plan: Plan, cycle: BillingCycle): number {
  if (plan.price === 0) return 0
  return cycle === 'yearly'
    ? Math.round(plan.price * (1 - YEARLY_DISCOUNT) * 10) / 10
    : plan.price
}

/** Красивая цена: «€22», «€17.6», «€0» */
export function formatPrice(n: number): string {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1)
  return `${CURRENCY}${v}`
}

'use client'

import { useEffect, useState } from 'react'
import { Check, Minus, Gift, Sparkles, User, Building2, Crown, CreditCard, X, ShieldCheck, Wallet, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/common/PageHeader'
import { IconTile } from '@/components/common/IconTile'
import { TONE, hexA, darken } from '@/lib/colors'
import { cn } from '@/lib/utils'
import {
  PLANS, planMonthly, formatPrice,
  type Plan, type BillingCycle, type PlanId,
} from '@/lib/plans'

const PLAN_ICON: Record<PlanId, any> = { free: User, pro: Sparkles, business: Building2, agency: Crown }

export default function PricingPage() {
  const [cycle, setCycle] = useState<BillingCycle>('yearly')
  const [currentPlan, setCurrentPlan] = useState<string | null>(null)
  const [notice, setNotice] = useState<Plan | null>(null)

  useEffect(() => {
    fetch('/api/account')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.plan && setCurrentPlan(d.plan))
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-7 pb-4">
      <PageHeader
        icon={CreditCard}
        title="Тарифы"
        subtitle="Платите за аккаунт. На платных тарифах чистый прокси в гео уже включён — не забанит."
      >
        {/* Переключатель Месяц / Год */}
        <div className="segment" role="tablist" aria-label="Период оплаты">
          {(['monthly', 'yearly'] as BillingCycle[]).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                'px-4 h-9 rounded-xl text-[14px] font-medium transition-all',
                cycle === c ? 'bg-white text-ink shadow-sm' : 'text-subt hover:text-ink',
              )}
            >
              {c === 'monthly' ? 'Месяц' : 'Год'}
              {c === 'yearly' && <span className="ml-1.5 text-ok text-[12px] font-semibold">−20%</span>}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Стаб онлайн-оплаты (пока Stripe не подключён — Фаза 3) */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="card gloss rise p-4 flex items-start gap-3.5"
          style={{ borderColor: hexA(TONE.brand, 0.35) }}
        >
          <IconTile icon={Wallet} color={TONE.brand} size={42} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px]">Онлайн-оплата скоро</div>
            <div className="text-subt text-[14px] mt-0.5">
              Тариф «{notice.name}» можно будет оформить прямо здесь через Stripe — деньги не спишутся, интеграция уже готовится.
            </div>
          </div>
          <button
            onClick={() => setNotice(null)}
            aria-label="Закрыть уведомление"
            className="text-subt hover:text-ink p-1 rounded-lg hover:bg-black/[0.05] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Карточки тарифов */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 items-stretch">
        {PLANS.map((plan, i) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            cycle={cycle}
            current={currentPlan === plan.id}
            onPick={() => setNotice(plan)}
            delay={i * 70}
          />
        ))}
      </div>

      {/* Доверие/условия */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-subt pt-1">
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-ok" /> Безопасная оплата картой</span>
        <span className="inline-flex items-center gap-1.5"><RefreshCw className="w-4 h-4 text-brand" /> Отмена в любой момент</span>
        <span className="inline-flex items-center gap-1.5"><Wallet className="w-4 h-4 text-subt" /> Без скрытых платежей</span>
      </div>
    </div>
  )
}

function PlanCard({
  plan, cycle, current, onPick, delay,
}: {
  plan: Plan; cycle: BillingCycle; current: boolean; onPick: () => void; delay: number
}) {
  const Icon = PLAN_ICON[plan.id]
  const price = planMonthly(plan, cycle)
  const rec = plan.recommended

  return (
    <div
      className={cn(
        'card gloss rise relative flex flex-col p-6 transition-transform',
        rec ? 'ring-2 ring-brand xl:-translate-y-2 shadow-[0_20px_50px_rgba(102,58,241,0.18)]' : 'card-3d',
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {rec && (
        <div
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[12px] font-semibold text-white shadow-sm inline-flex items-center gap-1"
          style={{ background: `linear-gradient(145deg, ${TONE.brand}, ${darken(TONE.brand)})` }}
        >
          <Sparkles className="w-3.5 h-3.5" /> Популярный
        </div>
      )}

      <div className="flex items-center gap-3">
        <IconTile icon={Icon} color={plan.accent} size={42} />
        <div className="min-w-0">
          <div className="text-[18px] font-semibold tracking-tight leading-none">{plan.name}</div>
          <div className="text-subt text-[12.5px] mt-1 leading-snug">{plan.tagline}</div>
        </div>
      </div>

      {/* Цена */}
      <div className="mt-5">
        <div className="flex items-baseline gap-1.5">
          {plan.priceFrom && <span className="text-subt text-[15px]">от</span>}
          <span className="text-[38px] font-semibold tracking-tighter tabular-nums leading-none">{formatPrice(price)}</span>
          {plan.price > 0 && (
            <span className="text-subt text-[13px] leading-tight">
              / {plan.perAccount ? 'аккаунт' : 'мес'}
              {plan.perAccount && <><br />в месяц</>}
            </span>
          )}
        </div>
        <div className="mt-2 text-[13px] min-h-[20px]">
          {plan.price === 0 ? (
            <span className="text-subt">навсегда</span>
          ) : cycle === 'yearly' ? (
            <span className="text-subt">
              <span className="text-ok font-medium">−20%</span> к{' '}
              <span className="line-through">{formatPrice(plan.price)}</span> при оплате за год
            </span>
          ) : (
            <span className="text-subt">при годовой оплате дешевле</span>
          )}
        </div>
      </div>

      {/* Триал (слот фикс. высоты — чтобы CTA во всех карточках были на одной линии) */}
      <div className="mt-3 min-h-[28px]">
        {plan.trialDays > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-ok/10 text-ok text-[12.5px] font-medium">
            <Gift className="w-3.5 h-3.5" /> {plan.trialDays} дней бесплатно
          </span>
        )}
      </div>

      {/* CTA */}
      <Button
        variant={rec ? 'primary' : 'secondary'}
        size="lg"
        className="w-full mt-5"
        disabled={current}
        onClick={onPick}
      >
        {current ? 'Ваш тариф' : plan.cta}
      </Button>

      {/* Фичи */}
      <ul className="mt-5 space-y-2.5 flex-1">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[13.5px]">
            {f.included ? (
              <span
                className="mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={{ background: hexA(plan.accent, 0.14) }}
              >
                <Check className="w-3 h-3" style={{ color: plan.accent }} />
              </span>
            ) : (
              <span className="mt-0.5 w-5 h-5 rounded-full bg-black/[0.05] flex items-center justify-center shrink-0">
                <Minus className="w-3 h-3 text-subt/70" />
              </span>
            )}
            <span className={cn('leading-snug', f.included ? 'text-ink/90' : 'text-subt/70')}>{f.text}</span>
          </li>
        ))}
      </ul>

      {plan.note && (
        <div className="mt-4 pt-4 border-t border-black/[0.06] text-[12px] text-subt leading-snug">{plan.note}</div>
      )}
    </div>
  )
}

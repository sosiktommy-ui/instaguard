import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, Zap, Users, CreditCard, ArrowRight, CheckCircle2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getEntitlements } from '@/lib/entitlements'
import { getPlan } from '@/lib/plans'
import { SiteNav } from '@/components/site/SiteNav'
import { ManageSubscriptionButton, LogoutButton } from '@/components/site/CabinetActions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: 'Активна',          color: '#16a34a', bg: 'rgba(34,197,94,.12)' },
  trialing: { label: 'Пробный период',   color: '#663af1', bg: 'rgba(102,58,241,.12)' },
  past_due: { label: 'Ожидает оплаты',   color: '#d97706', bg: 'rgba(245,158,11,.14)' },
  canceled: { label: 'Отменена',         color: '#dc2626', bg: 'rgba(239,68,68,.12)' },
  inactive: { label: 'Не активна',       color: '#6b7280', bg: 'rgba(107,114,128,.12)' },
  free:     { label: 'Бесплатный',       color: '#6b7280', bg: 'rgba(107,114,128,.12)' },
}

// Личный кабинет — ОТДЕЛЬНАЯ вкладка на САЙТЕ (site-shell + хлебные крошки), НЕ в рабочей среде.
// В приложение — только кнопкой «Перейти к функционалу». Данные: подписка (getEntitlements) + профиль + аккаунты.
export default async function CabinetPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const [profile, accounts, ent] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true, email: true, createdAt: true } }).catch(() => null),
    prisma.instagramAccount.count({ where: { userId: user.id } }).catch(() => 0),
    getEntitlements(user.id),
  ])
  const plan = getPlan(ent.plan)
  const email = profile?.email ?? user.email
  const name = profile?.name?.trim() || email.split('@')[0]
  const initial = (name[0] || 'U').toUpperCase()
  const st = STATUS[ent.status] ?? STATUS.free
  const usagePct = ent.maxAccounts > 0 ? Math.min(100, Math.round((accounts / ent.maxAccounts) * 100)) : 0

  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 22, border: '1px solid rgba(20,16,48,.07)',
    boxShadow: '0 8px 28px rgba(20,16,48,.06)', padding: 24,
  }
  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8b8fa3' }

  return (
    <>
      <SiteNav solid />
      <main className="rg-container" style={{ paddingTop: 108, paddingBottom: 80, maxWidth: 1080 }}>
        {/* Хлебные крошки — возврат на главную + навигация по кабинету (правило breadcrumb-web) */}
        <nav aria-label="Хлебные крошки" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#8b8fa3', marginBottom: 18, flexWrap: 'wrap' }}>
          <Link href="/lp" style={{ color: '#8b8fa3', textDecoration: 'none' }}>Главная</Link>
          <ChevronRight size={15} aria-hidden />
          <span style={{ color: '#14102f', fontWeight: 600 }}>Личный кабинет</span>
          <ChevronRight size={15} aria-hidden />
          <Link href="/lp/pricing" style={{ color: '#663af1', textDecoration: 'none', fontWeight: 600 }}>Тарифы</Link>
        </nav>

        <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.02em', color: '#14102f', margin: '0 0 4px' }}>Личный кабинет</h1>
        <p style={{ color: '#6b7280', margin: '0 0 28px', fontSize: 15 }}>Тариф, использование и профиль. В функционал — кнопкой ниже.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
          {/* Тариф + осталось дней */}
          <section style={{ ...card, gridColumn: 'span 2', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 46, height: 46, borderRadius: 14, background: 'linear-gradient(135deg,#7c5cfc,#6a7df9)', display: 'grid', placeItems: 'center', boxShadow: '0 6px 16px rgba(102,58,241,.35)' }}>
                  <Zap size={22} color="#fff" fill="#fff" />
                </span>
                <div>
                  <div style={label}>Ваш тариф</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#14102f', lineHeight: 1.1 }}>{plan.name}</div>
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: st.color, background: st.bg, padding: '6px 12px', borderRadius: 999 }}>{st.label}</span>
            </div>
            <div style={{ marginTop: 18, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <div>
                <div style={label}>Осталось дней</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#14102f', fontVariantNumeric: 'tabular-nums' }}>{ent.daysLeft != null ? ent.daysLeft : '—'}</div>
              </div>
              <div>
                <div style={label}>Прокси</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: ent.proxyIncluded ? '#16a34a' : '#6b7280', marginTop: 6 }}>{ent.proxyIncluded ? 'Включён в тариф' : 'Свой (BYOP)'}</div>
              </div>
            </div>
            <div style={{ marginTop: 22, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link href="/lp/pricing" className="rg-btn rg-btn-primary">Сменить тариф</Link>
              <ManageSubscriptionButton className="rg-btn rg-btn-light" />
            </div>
          </section>

          {/* Профиль */}
          <section style={card}>
            <div style={label}>Профиль</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14 }}>
              <span style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,#7c5cfc,#b06bff)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 800 }}>{initial}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#14102f', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                <div style={{ fontSize: 13.5, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
              </div>
            </div>
            <Link href="/settings" className="rg-btn rg-btn-light" style={{ marginTop: 18, display: 'inline-flex' }}>Настройки профиля</Link>
          </section>

          {/* Использование */}
          <section style={card}>
            <div style={label}>Instagram-аккаунтов</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: '#14102f', fontVariantNumeric: 'tabular-nums' }}>{accounts}</span>
              <span style={{ fontSize: 16, color: '#8b8fa3', fontWeight: 600 }}>/ {ent.maxAccounts}</span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: 'rgba(20,16,48,.07)', marginTop: 12, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${usagePct}%`, borderRadius: 999, background: usagePct >= 100 ? '#dc2626' : 'linear-gradient(90deg,#7c5cfc,#6a7df9)' }} />
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 10 }}>
              {accounts >= ent.maxAccounts ? 'Лимит тарифа достигнут — повысьте тариф, чтобы добавить ещё.' : `Можно подключить ещё ${ent.maxAccounts - accounts}.`}
            </div>
          </section>
        </div>

        {/* Что входит в тариф */}
        <section style={{ ...card, marginTop: 18 }}>
          <div style={label}>Что входит в «{plan.name}»</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '10px 20px' }}>
            {plan.features.filter((f) => f.included).map((f, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14.5, color: '#2a2740' }}>
                <CheckCircle2 size={18} color="#16a34a" style={{ flexShrink: 0, marginTop: 1 }} />{f.text}
              </li>
            ))}
          </ul>
        </section>

        {/* Действия: переход в функционал + выход */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26, alignItems: 'center' }}>
          <Link href="/triggers" className="rg-btn rg-btn-primary rg-btn-lg" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Users size={18} /> Перейти к функционалу <ArrowRight size={18} />
          </Link>
          <Link href="/lp/pricing" className="rg-btn rg-btn-light rg-btn-lg" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <CreditCard size={18} /> Тарифы и оплата
          </Link>
          <span style={{ marginLeft: 'auto' }}><LogoutButton className="rg-btn rg-btn-light" /></span>
        </div>
      </main>
    </>
  )
}

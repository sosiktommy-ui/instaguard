import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getEntitlements } from '@/lib/entitlements'
import { getPlan } from '@/lib/plans'
import { SiteNav } from '@/components/site/SiteNav'
import { CabinetShell } from '@/components/site/CabinetShell'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: 'Активна',        color: '#16a34a', bg: 'rgba(34,197,94,.12)' },
  trialing: { label: 'Пробный период', color: '#663af1', bg: 'rgba(102,58,241,.12)' },
  past_due: { label: 'Ожидает оплаты', color: '#d97706', bg: 'rgba(245,158,11,.14)' },
  canceled: { label: 'Отменена',       color: '#dc2626', bg: 'rgba(239,68,68,.12)' },
  inactive: { label: 'Не активна',     color: '#6b7280', bg: 'rgba(107,114,128,.12)' },
  free:     { label: 'Бесплатный',     color: '#6b7280', bg: 'rgba(107,114,128,.12)' },
}

// Личный кабинет на САЙТЕ (site-shell): сайдбар-меню + карточки. В приложение — «Перейти к функционалу».
export default async function CabinetPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const [profile, accounts, ent] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } }).catch(() => null),
    prisma.instagramAccount.count({ where: { userId: user.id } }).catch(() => 0),
    getEntitlements(user.id),
  ])
  const plan = getPlan(ent.plan)
  const email = profile?.email ?? user.email
  const name = profile?.name?.trim() || email.split('@')[0]
  const st = STATUS[ent.status] ?? STATUS.free

  return (
    <>
      <SiteNav solid />
      <main className="rg-container" style={{ paddingTop: 100, paddingBottom: 80, maxWidth: 1120 }}>
        <nav aria-label="Хлебные крошки" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#8b8fa3', marginBottom: 16 }}>
          <Link href="/lp" style={{ color: '#8b8fa3', textDecoration: 'none' }}>Главная</Link>
          <ChevronRight size={15} aria-hidden />
          <span style={{ color: '#14102f', fontWeight: 600 }}>Личный кабинет</span>
        </nav>

        <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-.02em', color: '#14102f', margin: '0 0 24px' }}>Личный кабинет</h1>

        <CabinetShell
          name={name}
          email={email}
          initial={(name[0] || 'U').toUpperCase()}
          planName={plan.name}
          statusLabel={st.label}
          statusColor={st.color}
          statusBg={st.bg}
          daysLeft={ent.daysLeft}
          proxyIncluded={ent.proxyIncluded}
          accounts={accounts}
          maxAccounts={ent.maxAccounts}
          features={plan.features.filter((f) => f.included).map((f) => f.text)}
        />
      </main>
    </>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LayoutGrid, Zap, Users, User, Shield, ArrowRight, CheckCircle2, LogOut } from 'lucide-react'
import { ManageSubscriptionButton, LogoutButton } from './CabinetActions'

export interface CabinetData {
  name: string
  email: string
  initial: string
  planName: string
  statusLabel: string
  statusColor: string
  statusBg: string
  daysLeft: number | null
  proxyIncluded: boolean
  accounts: number
  maxAccounts: number
  features: string[]
}

type Section = 'overview' | 'tariff' | 'accounts' | 'profile' | 'security'

const MENU: { id: Section; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'overview', label: 'Обзор', icon: LayoutGrid },
  { id: 'tariff', label: 'Тариф и оплата', icon: Zap },
  { id: 'accounts', label: 'Аккаунты', icon: Users },
  { id: 'profile', label: 'Профиль', icon: User },
  { id: 'security', label: 'Безопасность', icon: Shield },
]

export function CabinetShell(d: CabinetData) {
  const [section, setSection] = useState<Section>('overview')

  const usagePct = d.maxAccounts > 0 ? Math.min(100, Math.round((d.accounts / d.maxAccounts) * 100)) : 0
  const daysColor = d.daysLeft != null && d.daysLeft <= 3 ? '#dc2626' : d.daysLeft != null && d.daysLeft <= 7 ? '#d97706' : 'var(--rg-text)'

  const StatusBadge = () => (
    <span style={{ fontSize: 13, fontWeight: 700, color: d.statusColor, background: d.statusBg, padding: '6px 12px', borderRadius: 999 }}>{d.statusLabel}</span>
  )

  const TariffHeader = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 46, height: 46, borderRadius: 14, background: 'linear-gradient(135deg,#7c5cfc,#6a7df9)', display: 'grid', placeItems: 'center', boxShadow: '0 6px 16px rgba(102,58,241,.35)' }}>
          <Zap size={22} color="#fff" fill="#fff" />
        </span>
        <div>
          <div className="rg-cab-lbl">Ваш тариф</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--rg-text)', lineHeight: 1.1 }}>{d.planName}</div>
        </div>
      </div>
      <StatusBadge />
    </div>
  )

  const UsageBar = () => (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}>
        <span className="rg-cab-num">{d.accounts}</span>
        <span style={{ fontSize: 16, color: '#8b8fa3', fontWeight: 600 }}>/ {d.maxAccounts}</span>
      </div>
      <div className="rg-cab-bar"><i style={{ width: `${usagePct}%`, background: usagePct >= 100 ? '#dc2626' : undefined }} /></div>
      <div style={{ fontSize: 13, color: '#6b7280', marginTop: 10 }}>
        {d.accounts >= d.maxAccounts ? 'Лимит тарифа достигнут — повысьте тариф, чтобы добавить ещё.' : `Можно подключить ещё ${d.maxAccounts - d.accounts}.`}
      </div>
    </>
  )

  return (
    <div className="rg-cab">
      {/* ── сайдбар-меню ── */}
      <aside className="rg-cab-side">
        <nav className="rg-cab-menu">
          {MENU.map((m) => (
            <button key={m.id} className={`rg-cab-item${section === m.id ? ' on' : ''}`} onClick={() => setSection(m.id)}>
              <m.icon size={18} /> {m.label}
            </button>
          ))}
        </nav>
        <div className="rg-cab-foot">
          <Link href="/triggers" className="rg-btn rg-btn-primary" style={{ justifyContent: 'center' }}>
            Перейти к функционалу <ArrowRight size={17} />
          </Link>
          <LogoutButton className="rg-btn rg-btn-light" />
        </div>
      </aside>

      {/* ── контент ── */}
      <div className="rg-cab-body">
        {section === 'overview' && (
          <>
            <div className="rg-cab-card">
              <TariffHeader />
              <div className="rg-cab-metrics">
                <div>
                  <div className="rg-cab-lbl">Осталось дней</div>
                  <div className="rg-cab-num" style={{ color: daysColor }}>{d.daysLeft != null ? d.daysLeft : '∞'}</div>
                  {d.daysLeft == null && <div style={{ fontSize: 12, color: '#8b8fa3' }}>без ограничения</div>}
                </div>
                <div>
                  <div className="rg-cab-lbl">Прокси</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: d.proxyIncluded ? '#16a34a' : '#6b7280', marginTop: 8 }}>{d.proxyIncluded ? 'Включён в тариф' : 'Свой (BYOP)'}</div>
                </div>
                <div>
                  <div className="rg-cab-lbl">Аккаунтов</div>
                  <div className="rg-cab-num" style={{ marginTop: 2 }}>{d.accounts}<span style={{ fontSize: 15, color: '#8b8fa3', fontWeight: 600 }}> / {d.maxAccounts}</span></div>
                </div>
              </div>
              <div className="rg-cab-actions">
                <Link href="/lp/pricing" className="rg-btn rg-btn-primary">Сменить тариф</Link>
                <ManageSubscriptionButton className="rg-btn rg-btn-light" />
              </div>
            </div>

            <div className="rg-cab-card">
              <div className="rg-cab-lbl">Что входит в «{d.planName}»</div>
              <ul className="rg-cab-feat">
                {d.features.map((f, i) => (<li key={i}><CheckCircle2 size={18} /> {f}</li>))}
              </ul>
            </div>
          </>
        )}

        {section === 'tariff' && (
          <div className="rg-cab-card">
            <TariffHeader />
            <div className="rg-cab-metrics">
              <div>
                <div className="rg-cab-lbl">Осталось дней</div>
                <div className="rg-cab-num" style={{ color: daysColor }}>{d.daysLeft != null ? d.daysLeft : '∞'}</div>
                {d.daysLeft == null && <div style={{ fontSize: 12, color: '#8b8fa3' }}>без ограничения</div>}
              </div>
              <div>
                <div className="rg-cab-lbl">Прокси</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: d.proxyIncluded ? '#16a34a' : '#6b7280', marginTop: 8 }}>{d.proxyIncluded ? 'Включён в тариф' : 'Свой (BYOP)'}</div>
              </div>
            </div>
            <ul className="rg-cab-feat">
              {d.features.map((f, i) => (<li key={i}><CheckCircle2 size={18} /> {f}</li>))}
            </ul>
            <div className="rg-cab-actions">
              <Link href="/lp/pricing" className="rg-btn rg-btn-primary">Сменить тариф</Link>
              <ManageSubscriptionButton className="rg-btn rg-btn-light" />
            </div>
          </div>
        )}

        {section === 'accounts' && (
          <div className="rg-cab-card">
            <h2 className="rg-cab-title">Instagram-аккаунты</h2>
            <p className="rg-cab-sub">Сколько аккаунтов уже подключено по вашему тарифу.</p>
            <div className="rg-cab-lbl">Использование</div>
            <UsageBar />
            <div className="rg-cab-actions">
              <Link href="/accounts" className="rg-btn rg-btn-primary">Подключить аккаунт</Link>
              {d.accounts >= d.maxAccounts && <Link href="/lp/pricing" className="rg-btn rg-btn-light">Повысить тариф</Link>}
            </div>
          </div>
        )}

        {section === 'profile' && (
          <div className="rg-cab-card">
            <h2 className="rg-cab-title">Профиль</h2>
            <p className="rg-cab-sub">Ваши данные аккаунта ReactiveGram.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
              <span style={{ width: 60, height: 60, borderRadius: '50%', background: 'linear-gradient(135deg,#7c5cfc,#b06bff)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 800 }}>{d.initial}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--rg-text)' }}>{d.name}</div>
                <div style={{ fontSize: 14, color: '#6b7280' }}>{d.email}</div>
              </div>
            </div>
            <div className="rg-cab-actions">
              <Link href="/settings" className="rg-btn rg-btn-light">Настройки профиля</Link>
            </div>
          </div>
        )}

        {section === 'security' && (
          <div className="rg-cab-card">
            <h2 className="rg-cab-title">Безопасность</h2>
            <p className="rg-cab-sub">Пароль и защита аккаунта.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderTop: '1px solid var(--rg-line)' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(102,58,241,.1)', display: 'grid', placeItems: 'center' }}><Shield size={19} color="#663af1" /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--rg-text)' }}>Пароль</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>Смена пароля — в настройках профиля.</div>
              </div>
              <Link href="/settings" className="rg-btn rg-btn-light">Изменить</Link>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderTop: '1px solid var(--rg-line)' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(102,58,241,.1)', display: 'grid', placeItems: 'center' }}><LogOut size={19} color="#663af1" /></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--rg-text)' }}>Выйти из аккаунта</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>Завершить сессию на этом устройстве.</div>
              </div>
              <LogoutButton className="rg-btn rg-btn-light" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

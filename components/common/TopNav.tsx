'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Menu, X, List, Users, BarChart3, Globe, Settings, CreditCard, User as UserIcon, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TONE, darken } from '@/lib/colors'
import { getPlan } from '@/lib/plans'
import { AppLogo } from '@/components/common/AppLogo'
import { ReactiveMascot } from '@/components/common/ReactiveMascot'
import { ActivityBell } from '@/components/common/ActivityBell'
import { useBreadcrumbs } from '@/lib/breadcrumbs'

// Единственный уровень навигации — разделы приложения (супертаб-переключатель «режимов» убран)
// plan4: черновые/API-парсинг скрыты из интерфейса (переход на self-events — свои уведомления
// основного аккаунта). Пункт «Черновые/Парсинг» убран из навигации; код /drafts остаётся в репо.
const SUBTABS = [
  { href: '/triggers', label: 'Рекламные кампании', icon: List },
  { href: '/accounts', label: 'Аккаунты', icon: Users },
  { href: '/proxy', label: 'Прокси', icon: Globe },
  { href: '/stats', label: 'Статистика', icon: BarChart3 },
  { href: '/settings', label: 'Настройки', icon: Settings },
]

export default function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [me, setMe] = useState<{ email: string; name: string | null; plan: string } | null>(null)
  // Реальный статус браузерного воркера (вход + действия). Раньше индикатор «Активно» был
  // захардкожен зелёным всегда — врал, даже когда воркер мёртв. Теперь отражает /health.
  const [health, setHealth] = useState<'loading' | 'online' | 'offline' | 'unconfigured'>('loading')

  // Close drawer/menu on route change
  useEffect(() => { setOpen(false); setMenuOpen(false) }, [pathname])

  useEffect(() => {
    fetch('/api/browser-health?test=1')
      .then((r) => r.json())
      .then((d) => setHealth(!d?.configured ? 'unconfigured' : d?.ok ? 'online' : 'offline'))
      .catch(() => setHealth('offline'))
  }, [])

  // Профиль для аватар-меню (имя/email/тариф)
  useEffect(() => {
    fetch('/api/account')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMe({ email: d.email, name: d.name, plan: d.plan }))
      .catch(() => {})
  }, [])

  // Пройти обучение заново: сбрасываем флаг и открываем главную (тур покажется снова)
  const replayTour = () => {
    try { localStorage.removeItem('rg-onboarded') } catch {}
    setOpen(false)
    window.location.assign('/triggers')
  }

  // Реальный выход: удаляем куку сессии на сервере + чистим локальный стор (мультитенант)
  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
    try { localStorage.removeItem('instaguard-store') } catch {}
    router.push('/login')
    router.refresh()
  }

  const activeSub = SUBTABS.find((t) => t.href === pathname)
  const crumb = activeSub?.label ?? 'Рекламные кампании'
  const { crumbs } = useBreadcrumbs()

  const initial = (me?.name?.trim()?.[0] || me?.email?.[0] || 'U').toUpperCase()
  const planName = getPlan(me?.plan).name

  return (
    <>
      <header className="sticky top-0 z-40 glass-bar border-b border-black/[0.06]">
        <div className="h-16 flex items-center gap-3 px-5 sm:px-7">
          {/* Burger — открывает меню разделов */}
          <button
            onClick={() => setOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-ink hover:bg-black/[0.05] transition-colors"
            title="Меню разделов"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 pr-1">
            <AppLogo size={38} className="drop-shadow-sm" />
            <span className="font-semibold text-[16px] tracking-tighter hidden md:block">ReactiveGram</span>
          </div>

          {/* Хлебные крошки: раздел + путь провала (задаётся страницей) */}
          <div className="flex items-center gap-2 text-[14px] text-subt ml-1 min-w-0">
            <span className="text-line hidden sm:inline">/</span>
            {crumbs.length === 0 ? (
              <span className="font-medium text-ink truncate">{crumb}</span>
            ) : (
              <span className="flex items-center gap-2 min-w-0">
                {crumbs.map((c, i) => {
                  const last = i === crumbs.length - 1
                  return (
                    <span key={i} className="flex items-center gap-2 min-w-0">
                      {i > 0 && <span className="text-line">/</span>}
                      {c.onClick && !last ? (
                        <button onClick={c.onClick} className="font-medium text-subt hover:text-brand transition-colors truncate">{c.label}</button>
                      ) : (
                        <span className={cn('font-medium truncate', last ? 'text-ink' : 'text-subt')}>{c.label}</span>
                      )}
                    </span>
                  )
                })}
              </span>
            )}
          </div>

          <div className="flex-1" />

          {(() => {
            const meta = {
              loading:      { dot: 'bg-subt', text: 'Проверка…',     ping: false, title: 'Проверяю связь с браузерным воркером…' },
              online:       { dot: 'bg-ok',   text: 'Онлайн',         ping: true,  title: 'Браузерный воркер отвечает — вход и действия работают' },
              offline:      { dot: 'bg-bad',  text: 'Воркер офлайн',  ping: false, title: 'Браузерный воркер не отвечает — вход и действия недоступны' },
              unconfigured: { dot: 'bg-warn', text: 'Не настроен',    ping: false, title: 'Не задан BROWSER_WORKER_URL — движок не подключён' },
            }[health]
            return (
              <div className="hidden sm:flex items-center gap-2 text-[13px] font-medium text-subt" title={meta.title}>
                <span className="relative flex h-2 w-2">
                  {meta.ping && <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 animate-ping" />}
                  <span className={cn('relative inline-flex h-2 w-2 rounded-full', meta.dot)} />
                </span>
                {meta.text}
              </div>
            )
          })()}
          <ActivityBell />

          {/* Аватар-меню: личный кабинет + тарифы */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Личный кабинет"
              title="Личный кабинет"
              className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-[13px] shadow-sm hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25"
              style={{ background: `linear-gradient(145deg, ${TONE.brand}, ${darken(TONE.brand)})` }}
            >
              {initial}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                <div role="menu" className="absolute right-0 mt-2 w-60 card p-2 z-50" style={{ animation: 'tour-in 0.16s ease' }}>
                  <div className="px-3 py-2">
                    <div className="text-[14px] font-medium text-ink truncate">{me?.name || 'Аккаунт'}</div>
                    {me?.email && <div className="text-[12px] text-subt truncate">{me.email}</div>}
                    <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-brand/10 text-brand text-[11px] font-medium">
                      <Sparkles className="w-3 h-3" /> {planName}
                    </span>
                  </div>
                  <div className="h-px bg-black/[0.06] my-1" />
                  <Link href="/lp/account" role="menuitem" className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[14px] text-ink/85 hover:bg-black/[0.05] transition-colors">
                    <UserIcon className="w-4 h-4 text-subt" /> Личный кабинет
                  </Link>
                  <Link href="/lp/pricing" role="menuitem" className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[14px] text-ink/85 hover:bg-black/[0.05] transition-colors">
                    <CreditCard className="w-4 h-4 text-subt" /> Тарифы
                  </Link>
                </div>
              </>
            )}
          </div>

          <button onClick={handleLogout} className="text-subt hover:text-bad transition-colors p-2" title="Выйти">
            <LogOut className="w-[18px] h-[18px]" />
          </button>
        </div>
      </header>

      {/* Left drawer */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[280px] bg-white border-r border-black/[0.06] shadow-2xl flex flex-col"
            style={{ animation: 'slide-in 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
            <div className="flex items-center justify-between px-5 h-16 border-b border-black/[0.06]">
              <div className="flex items-center gap-2.5">
                <AppLogo size={38} />
                <span className="font-semibold text-[16px] tracking-tighter">ReactiveGram</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-subt hover:text-ink p-1"><X size={22} /></button>
            </div>
            <nav className="px-3 py-3 space-y-1">
              {SUBTABS.map((t) => {
                const active = pathname === t.href
                return (
                  <Link key={t.href} href={t.href}
                    className={cn('flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-all',
                      active ? 'bg-brand text-white shadow-sm' : 'text-ink/80 hover:bg-black/[0.04]')}>
                    <t.icon className={cn('w-[18px] h-[18px]', active ? 'text-white' : 'text-subt')} />
                    <span className="flex-1">{t.label}</span>
                  </Link>
                )
              })}

              {/* Кабинет */}
              <div className="pt-2 mt-2 border-t border-black/[0.06]">
                <div className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subt/70">Кабинет</div>
                {[
                  { href: '/lp/account', label: 'Личный кабинет', icon: UserIcon },
                  { href: '/lp/pricing', label: 'Тарифы', icon: CreditCard },
                ].map((t) => {
                  const active = pathname === t.href
                  return (
                    <Link key={t.href} href={t.href}
                      className={cn('flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-all',
                        active ? 'bg-brand text-white shadow-sm' : 'text-ink/80 hover:bg-black/[0.04]')}>
                      <t.icon className={cn('w-[18px] h-[18px]', active ? 'text-white' : 'text-subt')} />
                      <span className="flex-1">{t.label}</span>
                    </Link>
                  )
                })}
              </div>
            </nav>
            <div className="mt-auto p-3 border-t border-black/[0.06] space-y-1">
              <button onClick={replayTour}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[15px] font-medium text-subt hover:bg-brand/[0.06] hover:text-brand transition-all">
                <ReactiveMascot size={30} animated={false} className="shrink-0 -my-0.5" />
                <span className="flex-1 text-left">Обучение Reactive</span>
              </button>
              <button onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium text-subt hover:bg-black/[0.04] hover:text-bad transition-all">
                <LogOut className="w-[18px] h-[18px]" /> Выйти
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}

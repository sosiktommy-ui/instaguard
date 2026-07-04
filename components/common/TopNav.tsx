'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Menu, X, List, Users, Layers, BarChart3, Globe, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppLogo } from '@/components/common/AppLogo'
import { ReactiveMascot } from '@/components/common/ReactiveMascot'
import { useBreadcrumbs } from '@/lib/breadcrumbs'

// Единственный уровень навигации — разделы приложения (супертаб-переключатель «режимов» убран)
const SUBTABS = [
  { href: '/triggers', label: 'Рекламные кампании', icon: List },
  { href: '/accounts', label: 'Аккаунты', icon: Users },
  { href: '/drafts', label: 'Черновые аккаунты', icon: Layers },
  { href: '/proxy', label: 'Прокси', icon: Globe },
  { href: '/stats', label: 'Статистика', icon: BarChart3 },
  { href: '/settings', label: 'Настройки', icon: Settings },
]

export default function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  // Close drawer on route change
  useEffect(() => { setOpen(false) }, [pathname])

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

          <div className="hidden sm:flex items-center gap-2 text-[13px] font-medium text-subt">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
            </span>
            Активно
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

'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Zap, LogOut, Menu, X, List, Users, Layers, BarChart3, Gamepad2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppLogo } from '@/components/common/AppLogo'

const TRIGGER_SUBTABS = [
  { href: '/triggers', label: 'Триггеры', icon: List },
  { href: '/accounts', label: 'Аккаунты', icon: Users },
  { href: '/drafts', label: 'Черновые аккаунты и прокси', icon: Layers },
  { href: '/stats', label: 'Статистика', icon: BarChart3 },
]

export default function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const superTab: 'triggers' | 'mass' | 'game' = pathname === '/mass' ? 'mass' : pathname === '/game' ? 'game' : 'triggers'

  // Close drawer on route change
  useEffect(() => { setOpen(false) }, [pathname])

  const SuperTab = ({ id, label, href, beta }: { id: 'triggers' | 'mass' | 'game'; label: string; href: string; beta?: boolean }) => (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2 px-4 py-2 rounded-xl text-[14px] font-semibold transition-all whitespace-nowrap',
        superTab === id ? 'bg-white text-ink shadow-sm' : 'text-subt hover:text-ink'
      )}
    >
      {label}
      {beta && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-warn/15 text-warn">BETA</span>}
    </Link>
  )

  const activeSub = TRIGGER_SUBTABS.find((t) => t.href === pathname)
  const crumb = superTab === 'mass' ? 'Массовое управление' : activeSub?.label ?? 'Триггеры'

  return (
    <>
      <header className="sticky top-0 z-40 glass-bar border-b border-black/[0.06]">
        <div className="h-16 flex items-center gap-3 px-5 sm:px-7">
          {/* Burger — only meaningful inside Triggers super-tab */}
          <button
            onClick={() => setOpen(true)}
            disabled={superTab === 'mass' || superTab === 'game'}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-ink hover:bg-black/[0.05] transition-colors disabled:opacity-30"
            title="Меню разделов"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 pr-1">
            <AppLogo size={38} className="drop-shadow-sm" />
            <span className="font-semibold text-[16px] tracking-tighter hidden md:block">InstaGuard</span>
          </div>

          <div className="segment ml-1">
            <SuperTab id="triggers" label="Триггеры" href="/triggers" />
            <SuperTab id="mass" label="Массовое управление" href="/mass" beta />
            <SuperTab id="game" label="Command Center" href="/game" />
          </div>

          {/* Current section crumb */}
          {(superTab === 'triggers' || superTab === 'game') && (
            <div className="hidden lg:flex items-center gap-2 text-[14px] text-subt ml-2">
              <span className="text-line">/</span>
              <span className="font-medium text-ink">{superTab === 'game' ? 'Command Center' : crumb}</span>
            </div>
          )}

          <div className="flex-1" />

          <div className="hidden sm:flex items-center gap-2 text-[13px] font-medium text-subt">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
            </span>
            Активно
          </div>
          <button onClick={() => router.push('/login')} className="text-subt hover:text-bad transition-colors p-2" title="Выйти">
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
                <span className="font-semibold text-[16px] tracking-tighter">InstaGuard</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-subt hover:text-ink p-1"><X size={22} /></button>
            </div>
            <div className="px-3 py-2 text-[11px] font-semibold text-subt uppercase tracking-wider mt-2">Триггеры</div>
            <nav className="px-3 space-y-1">
              {TRIGGER_SUBTABS.map((t) => {
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
            <div className="px-3 py-2 text-[11px] font-semibold text-subt uppercase tracking-wider mt-4">Прочее</div>
            <nav className="px-3 space-y-1">
              <Link href="/mass"
                className={cn('flex items-center gap-3 px-4 py-3 rounded-xl text-[15px] font-medium transition-all',
                  pathname === '/mass' ? 'bg-brand text-white shadow-sm' : 'text-ink/80 hover:bg-black/[0.04]')}>
                <Zap className={cn('w-[18px] h-[18px]', pathname === '/mass' ? 'text-white' : 'text-subt')} />
                <span className="flex-1">Массовое управление</span>
                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-md', pathname === '/mass' ? 'bg-white/20 text-white' : 'bg-warn/15 text-warn')}>BETA</span>
              </Link>
            </nav>
            <div className="mt-auto p-3 border-t border-black/[0.06]">
              <button onClick={() => router.push('/login')}
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

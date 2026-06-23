'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Users, Zap, MessageSquare, Clock, Settings, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard/accounts',  label: 'Аккаунты', icon: Users },
  { href: '/dashboard/triggers',  label: 'Триггеры',  icon: Zap },
  { href: '/dashboard/templates', label: 'Шаблоны',   icon: MessageSquare },
  { href: '/dashboard/logs',      label: 'Логи',      icon: Clock },
  { href: '/dashboard/settings',  label: 'Настройки', icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="w-72 border-r border-zinc-800 h-screen fixed flex flex-col bg-zinc-950">
      <div className="p-8 flex items-center gap-3">
        <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center">
          <span className="text-black font-bold text-2xl">I</span>
        </div>
        <div>
          <div className="font-semibold tracking-tighter text-2xl">InstaGuard</div>
          <div className="text-[10px] text-zinc-500 -mt-1">PREMIUM AUTOMATION</div>
        </div>
      </div>

      <nav className="flex-1 px-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-6 py-3.5 rounded-2xl mb-1 text-sm font-medium transition-all',
                isActive
                  ? 'bg-white text-black'
                  : 'hover:bg-zinc-900 text-zinc-400 hover:text-white'
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="p-6 border-t border-zinc-800 mt-auto">
        <button className="w-full flex items-center justify-center gap-2 py-3 text-zinc-400 hover:text-white transition-colors">
          <LogOut className="w-4 h-4" />
          Выйти
        </button>
      </div>
    </div>
  )
}

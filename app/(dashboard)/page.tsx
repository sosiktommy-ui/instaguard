'use client'

import { useEffect, useState } from 'react'
import { Users, Zap, Clock, TrendingUp } from 'lucide-react'

interface Stats {
  activeAccounts: number
  totalRules: number
  messagesToday: number
  successRate: number
}

const ACTIVITY = [
  'Отправлено приветствие @newuser_3924',
  'Обнаружен новый подписчик у @premium.brand',
  'Правило #4 выполнено успешно',
]

export default function DashboardOverview() {
  const [stats, setStats] = useState<Stats>({
    activeAccounts: 3,
    totalRules: 12,
    messagesToday: 847,
    successRate: 94,
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setStats((prev) => ({
        ...prev,
        messagesToday: prev.messagesToday + Math.floor(Math.random() * 3),
      }))
    }, 7000)
    return () => clearInterval(interval)
  }, [])

  const cards = [
    { label: 'Активных аккаунтов', value: stats.activeAccounts,                   icon: Users },
    { label: 'Активных правил',     value: stats.totalRules,                        icon: Zap },
    { label: 'Сообщений сегодня',   value: stats.messagesToday.toLocaleString('ru'), icon: TrendingUp },
    { label: 'Успешность',          value: `${stats.successRate}%`,                 icon: Clock },
  ]

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-6xl font-semibold tracking-tighter">Обзор</h1>
        <p className="text-zinc-500 mt-4 text-xl">InstaGuard • Работает стабильно</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="glass rounded-3xl p-8">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-5xl font-semibold tracking-tighter">{value}</div>
                <div className="text-zinc-500 mt-3 text-sm">{label}</div>
              </div>
              <Icon className="w-8 h-8 text-zinc-600 shrink-0" />
            </div>
          </div>
        ))}
      </div>

      <div className="glass rounded-3xl p-8">
        <h3 className="text-xl font-semibold mb-6">Последняя активность</h3>
        <div className="space-y-1">
          {ACTIVITY.map((text, i) => (
            <div
              key={i}
              className="flex items-center gap-4 py-4 border-b border-zinc-800 last:border-0"
            >
              <div className="w-2 h-2 bg-emerald-500 rounded-full shrink-0" />
              <span className="text-zinc-400 text-sm">{text}</span>
              <span className="ml-auto text-xs text-zinc-600 font-mono shrink-0">только что</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

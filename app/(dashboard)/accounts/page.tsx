'use client'

import { useState, useEffect } from 'react'
import { Plus, Play, Pause, Trash2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface InstagramAccount {
  id: string
  username: string
  fullName?: string
  role: 'RESPONDER' | 'HELPER' | 'BOTH'
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE_REQUIRED'
  lastChecked?: string
  errorCount: number
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    setTimeout(() => {
      setAccounts([
        {
          id: '1',
          username: 'premium.brand',
          fullName: 'Premium Brand',
          role: 'RESPONDER',
          status: 'ACTIVE',
          lastChecked: '2026-06-23T10:45:00Z',
          errorCount: 0
        },
        {
          id: '2',
          username: 'helper_parse',
          fullName: 'Helper Account',
          role: 'HELPER',
          status: 'ACTIVE',
          lastChecked: '2026-06-23T10:30:00Z',
          errorCount: 2
        }
      ])
      setIsLoading(false)
    }, 800)
  }, [])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'text-emerald-500'
      case 'PAUSED': return 'text-amber-500'
      case 'BLOCKED': return 'text-red-500'
      default: return 'text-zinc-500'
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-end mb-10">
        <div>
          <h1 className="text-4xl font-semibold tracking-tighter">Аккаунты</h1>
          <p className="text-zinc-500 mt-2">Управление Responder и Helper аккаунтами</p>
        </div>
        <Button className="bg-white text-black hover:bg-zinc-200 flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Добавить аккаунт
        </Button>
      </div>

      <div className="glass rounded-3xl p-1">
        <div className="bg-zinc-900 rounded-[22px] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left py-5 px-8 font-medium text-zinc-500">Аккаунт</th>
                <th className="text-left py-5 px-8 font-medium text-zinc-500">Роль</th>
                <th className="text-left py-5 px-8 font-medium text-zinc-500">Статус</th>
                <th className="text-left py-5 px-8 font-medium text-zinc-500">Последняя проверка</th>
                <th className="text-left py-5 px-8 font-medium text-zinc-500">Ошибки</th>
                <th className="w-32"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-zinc-600">Загрузка...</td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-zinc-600">Нет аккаунтов</td>
                </tr>
              ) : accounts.map((acc) => (
                <tr key={acc.id} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                  <td className="py-6 px-8">
                    <div>
                      <div className="font-medium">@{acc.username}</div>
                      {acc.fullName && <div className="text-sm text-zinc-500">{acc.fullName}</div>}
                    </div>
                  </td>
                  <td className="py-6 px-8">
                    <span className="inline-block px-3 py-1 rounded-full bg-zinc-800 text-xs font-mono tracking-widest">
                      {acc.role}
                    </span>
                  </td>
                  <td className="py-6 px-8">
                    <span className={cn('font-medium', getStatusColor(acc.status))}>
                      {acc.status === 'ACTIVE' ? 'Активен' : acc.status}
                    </span>
                  </td>
                  <td className="py-6 px-8 text-sm text-zinc-500">
                    {acc.lastChecked ? new Date(acc.lastChecked).toLocaleString('ru-RU') : '—'}
                  </td>
                  <td className="py-6 px-8">
                    {acc.errorCount > 0 ? (
                      <div className="flex items-center gap-2 text-red-500">
                        <AlertCircle className="w-4 h-4" />
                        <span>{acc.errorCount}</span>
                      </div>
                    ) : (
                      <span className="text-emerald-500">✓</span>
                    )}
                  </td>
                  <td className="py-6 px-8">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm">
                        <Play className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Pause className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-red-500 hover:bg-red-950">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

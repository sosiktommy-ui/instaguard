'use client'

import { useEffect, useState, useCallback } from 'react'
import { Users, Zap, Send, AlertCircle, Eye, CheckCircle2, Info, RefreshCw } from 'lucide-react'
import { formatFollowers } from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { cn } from '@/lib/utils'
import { readStat, ACTION_KEYS } from '@/lib/stats'

interface DbAccount { id: string; username: string; status: string; errorCount?: number; followerCount?: number; followers?: number | null }
interface DbTrigger { id: string; triggerType: string; isActive: boolean; fireCount?: number; stats?: any }
interface DbLog { id: string; level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'; message: string; createdAt: string; account?: { username?: string } }

const DB_TYPE_LABELS: Record<string, string> = {
  NEW_FOLLOWER: 'Новая подписка',
  NEW_COMMENT: 'Комментарий',
  NEW_LIKE: 'Лайк',
  STORY_MENTION: 'Ответ на сторис',
}

function logIcon(level: DbLog['level']) {
  if (level === 'SUCCESS') return <CheckCircle2 className="w-4 h-4 text-ok shrink-0" />
  if (level === 'ERROR') return <AlertCircle className="w-4 h-4 text-bad shrink-0" />
  if (level === 'WARN') return <AlertCircle className="w-4 h-4 text-warn shrink-0" />
  return <Info className="w-4 h-4 text-subt shrink-0" />
}

function Stats() {
  const [accounts, setAccounts] = useState<DbAccount[]>([])
  const [triggers, setTriggers] = useState<DbTrigger[]>([])
  const [logs, setLogs] = useState<DbLog[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, t, l] = await Promise.all([fetch('/api/accounts'), fetch('/api/triggers'), fetch('/api/logs')])
      if (a.ok) setAccounts(await a.json())
      if (t.ok) setTriggers(await t.json())
      if (l.ok) setLogs(await l.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Единый источник подписчиков (как на других экранах): реальные followers, иначе отслеженные
  const followersOf = (a: DbAccount) => a.followers ?? a.followerCount ?? 0
  const totalReach = accounts.reduce((s, a) => s + followersOf(a), 0)
  const totalRuns = triggers.reduce((s, t) => s + (t.fireCount ?? 0), 0)
  const totalDone = triggers.reduce((s, t) => s + ACTION_KEYS.reduce((ss, k) => ss + readStat(t.stats, k).done, 0), 0)
  const totalErrors = accounts.reduce((s, a) => s + (a.errorCount ?? 0), 0)
  const activeCampaigns = triggers.filter((t) => t.isActive).length

  const byType = Object.keys(DB_TYPE_LABELS).map((t) => ({
    type: t,
    label: DB_TYPE_LABELS[t],
    runs: triggers.filter((x) => x.triggerType === t).reduce((s, x) => s + (x.fireCount ?? 0), 0),
  }))
  const maxRuns = Math.max(1, ...byType.map((b) => b.runs))
  const topAccounts = [...accounts].sort((a, b) => followersOf(b) - followersOf(a)).slice(0, 5)

  const cards = [
    { icon: Users, label: 'Аккаунтов', value: accounts.length, tone: 'bg-brand/10 text-brand' },
    { icon: Eye, label: 'Подписчиков', value: formatFollowers(totalReach), tone: 'bg-[#6a7df9]/10 text-[#6a7df9]' },
    { icon: Zap, label: 'Активных кампаний', value: activeCampaigns, tone: 'bg-warn/10 text-warn' },
    { icon: Send, label: 'Сработало', value: totalRuns.toLocaleString('ru'), tone: 'bg-brand/10 text-brand' },
    { icon: CheckCircle2, label: 'Выполнено действий', value: totalDone.toLocaleString('ru'), tone: 'bg-ok/10 text-ok' },
    { icon: AlertCircle, label: 'Ошибок', value: totalErrors, tone: 'bg-bad/10 text-bad' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 data-tour="page" className="text-[26px] font-semibold tracking-tighter leading-none">Статистика</h1>
          <p className="text-subt mt-1.5 text-[14px]">Сводка по всем аккаунтам и кампаниям</p>
        </div>
        <button onClick={load} className="p-2 text-subt hover:text-ink transition-colors" title="Обновить">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(({ icon: Icon, label, value, tone }) => (
          <div key={label} className="card p-5">
            <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center mb-3', tone)}>
              <Icon className="w-5 h-5" />
            </div>
            <div className="text-[24px] font-semibold tracking-tighter leading-none">{value}</div>
            <div className="text-[12px] text-subt mt-1.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-6">
          <div className="font-semibold text-[15px] mb-5">Срабатывания по типу кампании</div>
          <div className="space-y-4">
            {byType.map((b) => (
              <div key={b.type}>
                <div className="flex justify-between text-[13px] mb-1.5">
                  <span className="text-ink/80">{b.label}</span>
                  <span className="font-semibold tabular-nums">{b.runs.toLocaleString('ru')}</span>
                </div>
                <div className="h-2.5 rounded-full bg-black/[0.05] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand to-[#42a5ff] transition-all"
                    style={{ width: `${(b.runs / maxRuns) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <div className="font-semibold text-[15px] mb-5">Топ аккаунтов по подписчикам</div>
          <div className="space-y-3">
            {topAccounts.map((a, i) => (
              <div key={a.id} className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-subt w-4">{i + 1}</span>
                <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold shrink-0">
                  {(a.username?.[0] ?? '?').toUpperCase()}
                </span>
                <span className="font-medium text-[14px] flex-1 truncate">@{a.username}</span>
                <span className="text-[13px] text-subt tabular-nums">{formatFollowers(followersOf(a))}</span>
              </div>
            ))}
            {topAccounts.length === 0 && <div className="py-6 text-center text-subt text-[13px]">Нет данных</div>}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="font-semibold text-[15px] mb-4">Журнал событий</div>
        <div className="space-y-1">
          {logs.length === 0 && <div className="py-6 text-center text-subt text-[13px]">Пусто</div>}
          {logs.slice(0, 12).map((l) => (
            <div key={l.id} className="flex items-center gap-3 py-2.5 border-b border-black/[0.04] last:border-0">
              {logIcon(l.level)}
              <span className="text-[13px] text-ink/80 truncate flex-1">{l.message}</span>
              <span className="text-[12px] text-subt shrink-0">@{l.account?.username ?? '—'}</span>
              <span className="text-[11px] text-subt shrink-0 w-12 text-right tabular-nums">
                {new Date(l.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Stats /></ClientOnly>
}

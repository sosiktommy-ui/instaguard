'use client'

import { Users, Zap, Send, AlertCircle, TrendingUp, Eye, CheckCircle2, Info } from 'lucide-react'
import {
  useStore, TRIGGER_LABELS, TriggerType, formatFollowers,
  triggerRuns, triggerErrors, triggerIsActive, LogLevel,
} from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { cn } from '@/lib/utils'

function logIcon(level: LogLevel) {
  if (level === 'SUCCESS') return <CheckCircle2 className="w-4 h-4 text-ok shrink-0" />
  if (level === 'ERROR') return <AlertCircle className="w-4 h-4 text-bad shrink-0" />
  return <Info className="w-4 h-4 text-subt shrink-0" />
}

function Stats() {
  const accounts = useStore((s) => s.accounts)
  const triggers = useStore((s) => s.triggers)
  const logs = useStore((s) => s.logs)

  const totalReach = accounts.reduce((s, a) => s + a.followers, 0)
  const totalRuns = triggers.reduce((s, t) => s + triggerRuns(t), 0)
  const totalErrors = triggers.reduce((s, t) => s + triggerErrors(t), 0)
  const successRate = totalRuns + totalErrors > 0 ? Math.round((totalRuns / (totalRuns + totalErrors)) * 100) : 100
  const activeTriggers = triggers.filter(triggerIsActive).length

  const byType = (Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => ({
    type: t,
    label: TRIGGER_LABELS[t],
    runs: triggers.filter((x) => x.type === t).reduce((s, x) => s + triggerRuns(x), 0),
  }))
  const maxRuns = Math.max(1, ...byType.map((b) => b.runs))
  const topAccounts = [...accounts].sort((a, b) => b.followers - a.followers).slice(0, 5)

  const cards = [
    { icon: Users, label: 'Аккаунтов', value: accounts.length, tone: 'bg-brand/10 text-brand' },
    { icon: Eye, label: 'Суммарный охват', value: formatFollowers(totalReach), tone: 'bg-[#5e5ce6]/10 text-[#5e5ce6]' },
    { icon: Zap, label: 'Активных триггеров', value: activeTriggers, tone: 'bg-warn/10 text-warn' },
    { icon: Send, label: 'Ответов отправлено', value: totalRuns.toLocaleString('ru'), tone: 'bg-ok/10 text-ok' },
    { icon: AlertCircle, label: 'Ошибок', value: totalErrors, tone: 'bg-bad/10 text-bad' },
    { icon: TrendingUp, label: 'Успешность', value: `${successRate}%`, tone: 'bg-ok/10 text-ok' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tighter leading-none">Статистика</h1>
        <p className="text-subt mt-1.5 text-[14px]">Сводка по всем аккаунтам и триггерам</p>
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
          <div className="font-semibold text-[15px] mb-5">Ответы по типу триггера</div>
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
          <div className="font-semibold text-[15px] mb-5">Топ аккаунтов по охвату</div>
          <div className="space-y-3">
            {topAccounts.map((a, i) => (
              <div key={a.id} className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-subt w-4">{i + 1}</span>
                <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold shrink-0">
                  {a.username[0].toUpperCase()}
                </span>
                <span className="font-medium text-[14px] flex-1 truncate">@{a.username}</span>
                <span className="text-[13px] text-subt tabular-nums">{formatFollowers(a.followers)}</span>
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
              <span className="text-[12px] text-subt shrink-0">{l.account}</span>
              <span className="text-[11px] text-subt shrink-0 w-12 text-right tabular-nums">
                {new Date(l.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
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

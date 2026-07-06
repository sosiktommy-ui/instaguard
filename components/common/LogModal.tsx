'use client'

import { useEffect, useState } from 'react'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info, ScrollText, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LogEntry { id: string; level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'; message: string; createdAt: string }

const LEVEL_META: Record<LogEntry['level'], { Icon: any; color: string }> = {
  SUCCESS: { Icon: CheckCircle2,  color: '#34c759' },
  ERROR:   { Icon: AlertCircle,   color: '#ff3b30' },
  WARN:    { Icon: AlertTriangle, color: '#ff9500' },
  INFO:    { Icon: Info,          color: '#8e8e93' },
}

function relTime(iso: string) {
  const d = new Date(iso)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs} ч назад`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн назад`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Сегодня'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
}

/**
 * Красивый журнал событий — для аккаунта целиком или для одной кампании
 * (matchText фильтрует записи по подстроке в сообщении, т.к. записи журнала
 * пишутся с именем кампании в кавычках: «Название»).
 */
export function LogModal({ title, subtitle, accountId, matchText, onClose }: {
  title: string; subtitle?: string; accountId: string; matchText?: string; onClose: () => void
}) {
  const [logs, setLogs] = useState<LogEntry[] | null>(null)

  const load = () => {
    setLogs(null)
    fetch(`/api/logs?accountId=${encodeURIComponent(accountId)}&limit=150`)
      .then((r) => r.ok ? r.json() : [])
      .then(setLogs)
      .catch(() => setLogs([]))
  }

  useEffect(() => { load() }, [accountId])

  const filtered = (logs ?? []).filter((l) => !matchText || l.message.includes(matchText))
  const okCount = filtered.filter((l) => l.level === 'SUCCESS').length
  const issueCount = filtered.filter((l) => l.level === 'ERROR' || l.level === 'WARN').length

  const groups: { label: string; items: LogEntry[] }[] = []
  for (const l of filtered) {
    const label = dayLabel(l.createdAt)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(l)
    else groups.push({ label, items: [l] })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[82vh] flex flex-col animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.05] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0"><ScrollText className="w-4 h-4 text-brand" /></div>
            <div className="min-w-0">
              <div className="font-semibold text-[15px] truncate">{title}</div>
              {subtitle && <div className="text-[12px] text-subt truncate">{subtitle}</div>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={load} className="p-1.5 text-subt hover:text-ink transition-colors" title="Обновить">
              <RefreshCw className={cn('w-4 h-4', logs === null && 'animate-spin')} />
            </button>
            <button onClick={onClose} className="p-1.5 text-subt hover:text-ink transition-colors" aria-label="Закрыть"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {logs !== null && filtered.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-black/[0.05] text-[12px] shrink-0">
            <span className="flex items-center gap-1.5 text-ok font-medium"><CheckCircle2 className="w-3.5 h-3.5" /> {okCount} успешно</span>
            {issueCount > 0
              ? <span className="flex items-center gap-1.5 text-bad font-medium"><AlertCircle className="w-3.5 h-3.5" /> {issueCount} с ошибками</span>
              : <span className="flex items-center gap-1.5 text-subt">без ошибок</span>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {logs === null ? (
            <div className="py-14 text-center text-subt text-[13px]">Загрузка…</div>
          ) : filtered.length === 0 ? (
            <div className="py-14 flex flex-col items-center text-center gap-2.5">
              <div className="w-12 h-12 rounded-2xl bg-canvas flex items-center justify-center"><ScrollText className="w-5 h-5 text-subt" /></div>
              <div className="text-[13px] text-subt">Пока тихо — записей нет</div>
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((g, gi) => (
                <div key={gi}>
                  <div className="text-[11px] font-semibold text-subt/70 uppercase tracking-wider mb-1.5">{g.label}</div>
                  <div className="space-y-0.5">
                    {g.items.map((l) => {
                      const m = LEVEL_META[l.level] ?? LEVEL_META.INFO
                      return (
                        <div key={l.id} className="flex items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-black/[0.02] transition-colors">
                          <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${m.color}1f` }}>
                            <m.Icon className="w-3.5 h-3.5" style={{ color: m.color }} />
                          </span>
                          <span className="flex-1 min-w-0 text-[12.5px] text-ink/85 leading-snug">{l.message}</span>
                          <span className="text-[11px] text-subt shrink-0 mt-0.5 whitespace-nowrap">{relTime(l.createdAt)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

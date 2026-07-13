'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info, ScrollText, RefreshCw, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LogEntry { id: string; level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'; message: string; createdAt: string }

const LEVEL_META: Record<LogEntry['level'], { Icon: any; color: string; label: string }> = {
  SUCCESS: { Icon: CheckCircle2,  color: '#22c55e', label: 'выполнено' },
  ERROR:   { Icon: AlertCircle,   color: '#ef4444', label: 'ошибка' },
  WARN:    { Icon: AlertTriangle, color: '#f59e0b', label: 'внимание' },
  INFO:    { Icon: Info,          color: '#8b93a1', label: 'инфо' },
}

function relTime(iso: string) {
  const d = new Date(iso)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs} ч`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

// ── Разбор строки журнала в структуру карточки ──
// Форматы (poll/route.ts, instrumentation.ts):
//   «Сработал триггер «Имя» → @user (…)», «Триггер «Имя» → @user: действия не выполнены (…)»,
//   «Коммент @user → «Имя»: …». Прочее (сессия/прогрев/уведомления) — как обычное событие.
interface Parsed {
  kind: 'trigger' | 'event'
  campaign?: string           // имя кампании из «…»
  account?: string            // @username
  triggerType?: string        // тип триггера («Новая подписка» и т.п.) из «· тип: …»
  done: string[]              // выполненные действия («директ», «лайк») из «· сделано: …»
  outcome?: { label: string; tone: 'ok' | 'bad' | 'warn' }
  reason?: string             // причина в скобках / уточнение
  text: string                // исходное сообщение (для event и как запасной вид)
}

function parseLog(l: LogEntry): Parsed {
  const msg = l.message
  const campaign = msg.match(/«([^»]+)»/)?.[1]
  const account = msg.match(/@([A-Za-z0-9._]+)/)?.[1]
  const isTrigger = /триггер|коммент/i.test(msg) && !!campaign && !!account
  // Обогащённые поля (новые логи): «· тип: X · сделано: a, b»
  const triggerType = msg.match(/·\s*тип:\s*([^·(]+)/)?.[1]?.trim()
  const doneRaw = msg.match(/·\s*сделано:\s*([^(·]+)/)?.[1]?.trim()
  const done = doneRaw ? doneRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
  // причина: последняя скобка, либо явные уточнения
  const paren = [...msg.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]).pop()
  const notFollowed = /не подписан/i.test(msg) ? 'не подписан → приглашение' : undefined
  const reason = paren || notFollowed

  let outcome: Parsed['outcome']
  if (isTrigger) {
    if (l.level === 'SUCCESS') outcome = { label: 'выполнено', tone: 'ok' }
    else if (/не выполнен/i.test(msg)) outcome = { label: 'не выполнено', tone: l.level === 'ERROR' ? 'bad' : 'warn' }
    else if (/невозможн/i.test(msg)) outcome = { label: 'невозможно', tone: 'warn' }
    else outcome = { label: LEVEL_META[l.level].label, tone: l.level === 'ERROR' ? 'bad' : l.level === 'WARN' ? 'warn' : 'ok' }
  }
  return { kind: isTrigger ? 'trigger' : 'event', campaign, account, triggerType, done, outcome, reason, text: msg }
}

// Цвета чипов действий — в тон 3D-диаграмме статистики
const ACTION_COLOR: Record<string, string> = {
  директ: '#7C5CFC', лайк: '#F59E0B', подписка: '#22C55E', сторис: '#38BDF8', коммент: '#FF5CA8', ответ: '#FF5CA8',
}

const TONE: Record<'ok' | 'bad' | 'warn', { fg: string; bg: string }> = {
  ok:   { fg: '#16a34a', bg: 'rgba(34,197,94,0.12)' },
  bad:  { fg: '#dc2626', bg: 'rgba(239,68,68,0.12)' },
  warn: { fg: '#d97706', bg: 'rgba(245,158,11,0.14)' },
}

type Range = 'today' | '7d' | '30d' | 'all'
type Filter = 'all' | 'success' | 'issues' | 'info'

/**
 * Красивый журнал событий — для аккаунта целиком или для одной кампании
 * (matchText фильтрует записи по подстроке в сообщении, т.к. записи журнала
 * пишутся с именем кампании в кавычках: «Название»).
 *
 * Вид: карточки в две колонки (Триггер → Результат, аккаунт снизу), без аватарок.
 */
export function LogModal({ title, subtitle, accountId, matchText, onClose }: {
  title: string; subtitle?: string; accountId: string; matchText?: string; onClose: () => void
}) {
  const [logs, setLogs] = useState<LogEntry[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [range, setRange] = useState<Range>('30d')

  const load = () => {
    setLogs(null)
    fetch(`/api/logs?accountId=${encodeURIComponent(accountId)}&limit=200`)
      .then((r) => r.ok ? r.json() : [])
      .then(setLogs)
      .catch(() => setLogs([]))
  }

  useEffect(() => { load() }, [accountId])

  // Диапазон по времени (как на референсе: Сегодня / 7 дней / 30 дней / Всё)
  const rangeMs: Record<Range, number> = { today: 0, '7d': 7 * 864e5, '30d': 30 * 864e5, all: Infinity }
  const inRange = (iso: string) => {
    if (range === 'all') return true
    const t = new Date(iso).getTime()
    if (range === 'today') return new Date(iso).toDateString() === new Date().toDateString()
    return Date.now() - t <= rangeMs[range]
  }

  const scoped = (logs ?? [])
    .filter((l) => !matchText || l.message.includes(matchText))
    .filter((l) => inRange(l.createdAt))

  const okCount = scoped.filter((l) => l.level === 'SUCCESS').length
  const issueCount = scoped.filter((l) => l.level === 'ERROR' || l.level === 'WARN').length
  const infoCount = scoped.filter((l) => l.level === 'INFO').length

  const filtered = scoped.filter((l) =>
    filter === 'all' ? true
    : filter === 'success' ? l.level === 'SUCCESS'
    : filter === 'issues' ? (l.level === 'ERROR' || l.level === 'WARN')
    : l.level === 'INFO')

  const parsed = useMemo(() => filtered.map((l) => ({ l, p: parseLog(l) })), [filtered])

  const TABS: { key: Filter; label: string; count: number; color?: string }[] = [
    { key: 'all', label: 'Все', count: scoped.length },
    { key: 'success', label: 'Успех', count: okCount, color: '#22c55e' },
    { key: 'issues', label: 'Ошибки', count: issueCount, color: '#ef4444' },
    { key: 'info', label: 'Инфо', count: infoCount, color: '#8b93a1' },
  ]
  const RANGES: { key: Range; label: string }[] = [
    { key: 'today', label: 'Сегодня' }, { key: '7d', label: '7 дней' }, { key: '30d', label: '30 дней' }, { key: 'all', label: 'Всё' },
  ]

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-3xl max-h-[86vh] flex flex-col animate-scale-in overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Шапка */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06] shrink-0 bg-gradient-to-b from-black/[0.015] to-transparent">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand/15 to-brand/5 flex items-center justify-center shrink-0 ring-1 ring-brand/10">
              <ScrollText className="w-[18px] h-[18px] text-brand" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[16px] tracking-tight truncate">{title}</div>
              {subtitle && <div className="text-[12px] text-subt truncate">{subtitle}</div>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={load} className="w-9 h-9 flex items-center justify-center rounded-xl text-subt hover:text-ink hover:bg-black/[0.04] transition-colors" title="Обновить">
              <RefreshCw className={cn('w-4 h-4', logs === null && 'animate-spin')} />
            </button>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-subt hover:text-ink hover:bg-black/[0.04] transition-colors" aria-label="Закрыть"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Фильтры по уровню */}
        {logs !== null && (logs.length > 0) && (
          <div className="flex items-center gap-1.5 px-5 pt-3 shrink-0 overflow-x-auto no-scrollbar">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12.5px] font-medium whitespace-nowrap transition-all',
                  filter === t.key ? 'bg-brand/10 text-brand shadow-sm ring-1 ring-brand/15' : 'text-subt hover:bg-black/[0.04]')}>
                {t.color && <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />}
                {t.label}
                <span className={cn('text-[11px] tabular-nums', filter === t.key ? 'text-brand/70' : 'text-subt/60')}>{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Диапазон по времени */}
        {logs !== null && logs.length > 0 && (
          <div className="flex items-center gap-1.5 px-5 pt-2 pb-3 shrink-0 overflow-x-auto no-scrollbar">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className={cn('px-3 py-1 rounded-full text-[12px] font-medium whitespace-nowrap transition-all',
                  range === r.key ? 'bg-brand text-white shadow-sm' : 'bg-black/[0.04] text-subt hover:bg-black/[0.07]')}>
                {r.label}
              </button>
            ))}
          </div>
        )}

        {/* Тело — две колонки карточек */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-1 bg-black/[0.008]">
          {logs === null ? (
            <div className="py-16 text-center text-subt text-[13px]">Загрузка…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 flex flex-col items-center text-center gap-2.5">
              <div className="w-14 h-14 rounded-2xl bg-canvas flex items-center justify-center"><ScrollText className="w-6 h-6 text-subt" /></div>
              <div className="text-[13px] text-subt">{scoped.length > 0 ? 'В этой категории записей нет' : 'Пока тихо — записей нет'}</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {parsed.map(({ l, p }, i) => <LogCard key={l.id} l={l} p={p} index={i} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LogCard({ l, p, index }: { l: LogEntry; p: Parsed; index: number }) {
  const m = LEVEL_META[l.level] ?? LEVEL_META.INFO
  return (
    <div className="relative rounded-2xl border border-black/[0.06] bg-white/70 backdrop-blur-sm px-3.5 py-3 overflow-hidden transition-all hover:border-black/[0.12] hover:shadow-[0_6px_20px_rgba(0,0,0,0.06)] rise"
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}>
      {/* цветная кромка по уровню */}
      <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full" style={{ background: m.color }} />

      {/* верх: для триггера — только время (у колонок свои подписи); для события — подпись + время */}
      <div className="flex items-center justify-between mb-2 pl-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-subt/70">
          {p.kind === 'trigger' ? '' : 'Событие'}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-subt shrink-0">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
          {relTime(l.createdAt)}
        </span>
      </div>

      {p.kind === 'trigger' ? (
        <div className="pl-1.5">
          {/* две колонки: ТРИГГЕР | ДЕЙСТВИЕ, у каждой значение + аккаунт снизу */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
            {/* ТРИГГЕР */}
            <div className="min-w-0">
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-subt/60 mb-1">Триггер</div>
              <span className="inline-flex max-w-full px-2 py-1 rounded-lg text-[12px] font-medium bg-brand/10 text-brand truncate" title={p.campaign}>
                {p.triggerType ?? p.campaign ?? 'триггер'}
              </span>
              {p.campaign && p.triggerType && <div className="text-[11px] text-subt truncate mt-0.5" title={p.campaign}>{p.campaign}</div>}
              {p.account && <div className="mt-1.5 text-[12.5px] font-semibold text-ink/80 truncate">@{p.account}</div>}
            </div>

            <ArrowRight className="w-4 h-4 text-subt/40 shrink-0 mt-6" />

            {/* ДЕЙСТВИЕ */}
            <div className="min-w-0">
              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-subt/60 mb-1">Действие</div>
              {p.done.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {p.done.map((a, k) => {
                    const c = ACTION_COLOR[a.toLowerCase()] ?? '#8b93a1'
                    return (
                      <span key={k} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-medium"
                        style={{ color: c, background: `${c}1f` }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />{a}
                      </span>
                    )
                  })}
                </div>
              ) : p.outcome ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-medium"
                  style={{ color: TONE[p.outcome.tone].fg, background: TONE[p.outcome.tone].bg }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE[p.outcome.tone].fg }} />
                  {p.outcome.label}
                </span>
              ) : null}
              {p.account && <div className="mt-1.5 text-[12.5px] font-semibold text-ink/80 truncate">@{p.account}</div>}
            </div>
          </div>

          {/* причина, если что-то не выполнено — во всю ширину */}
          {p.reason && p.outcome?.tone !== 'ok' && (
            <div className="mt-2 flex items-start gap-1.5 text-[11.5px] rounded-lg px-2 py-1.5"
              style={{ color: TONE[p.outcome?.tone ?? 'warn'].fg, background: TONE[p.outcome?.tone ?? 'warn'].bg }}>
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
              <span className="leading-snug">{p.reason}</span>
            </div>
          )}
        </div>
      ) : (
        /* обычное событие (инфо/сессия/прогрев) */
        <div className="pl-1.5 flex items-start gap-2">
          <span className="w-5 h-5 rounded-lg flex items-center justify-center shrink-0 mt-[1px]" style={{ background: `${m.color}22` }}>
            <m.Icon className="w-3 h-3" style={{ color: m.color }} />
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] text-ink/85 leading-snug">{p.text}</div>
            {p.account && <div className="mt-1 text-[12px] text-subt">@{p.account}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

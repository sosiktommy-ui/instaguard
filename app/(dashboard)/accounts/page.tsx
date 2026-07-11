'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Play, Pause, Trash2, X, Globe, Users, Zap, Send, UserPlus, RefreshCw, Loader2, RotateCcw, Pencil, Check, MessageCircle, Heart, Clapperboard, UserCheck, Activity, Calendar, TrendingUp, Info, ScrollText, Cookie } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddAccountModal } from '@/components/accounts/AddAccountModal'
import { ImportCookiesModal } from '@/components/accounts/ImportCookiesModal'
import { DraftsStatus } from '@/components/accounts/DraftsStatus'
import { SecurityBadge } from '@/components/accounts/SecurityBadge'
import { SectionBar, type SectionItem } from '@/components/accounts/SectionBar'
import { FolderTree } from 'lucide-react'
import { Tilt } from '@/components/ui/Tilt'
import { useStore, formatFollowers } from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { cn } from '@/lib/utils'
import { readStat, ACTION_KEYS } from '@/lib/stats'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Hint } from '@/components/common/Hint'
import { PageHeader } from '@/components/common/PageHeader'
import { IconTile } from '@/components/common/IconTile'
import { LogModal } from '@/components/common/LogModal'
import { TONE } from '@/lib/colors'

interface RealAccount {
  id: string
  username: string
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE'
  role?: string
  lastChecked: string | null
  errorCount: number
  proxy: string | null
  followerCount: number
  followers?: number | null
  followersHistory?: { d: string; n: number }[] | null
  limits?: Record<string, unknown> | null
  sectionId?: string | null
  hasSession?: boolean
  parseBlocked?: boolean
}

// Мини-спарклайн прироста подписчиков (инлайн SVG, без библиотек)
function Sparkline({ data, w = 116, h = 30 }: { data: { d: string; n: number }[]; w?: number; h?: number }) {
  const pts = (data ?? []).filter((p) => typeof p?.n === 'number')
  if (pts.length < 2) {
    return <div className="text-[11px] text-subt/70 h-[30px] flex items-center">Копим данные для графика…</div>
  }
  const ns = pts.map((p) => p.n)
  const min = Math.min(...ns), max = Math.max(...ns)
  const span = max - min || 1
  const stepX = w / (pts.length - 1)
  const y = (n: number) => h - 3 - ((n - min) / span) * (h - 6)
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(p.n).toFixed(1)}`).join(' ')
  const area = `${path} L${w},${h} L0,${h} Z`
  const delta = ns[ns.length - 1] - ns[0]
  const up = delta >= 0
  const col = up ? '#34c759' : '#ff3b30'
  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
        <defs>
          <linearGradient id="spark-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={col} stopOpacity="0.28" />
            <stop offset="1" stopColor={col} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spark-g)" />
        <path d={path} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={w} cy={y(ns[ns.length - 1])} r="2.6" fill={col} />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums" style={{ color: col }}>{up ? '+' : ''}{delta.toLocaleString('ru')}</span>
    </div>
  )
}


// ── Метаданные типов кампаний (совпадают с вкладкой «Триггеры») ───────────────
const TYPE_META: Record<string, { label: string; color: string; Icon: any }> = {
  NEW_FOLLOWER:  { label: 'Новая подписка',  color: '#663af1', Icon: UserPlus },
  NEW_COMMENT:   { label: 'Комментарий',     color: '#34c759', Icon: MessageCircle },
  NEW_LIKE:      { label: 'Лайк',            color: '#ff2d92', Icon: Heart },
  STORY_MENTION: { label: 'Ответ на сторис', color: '#ff9f0a', Icon: Clapperboard },
}
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
function darken(hex: string, f = 0.78) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}
// Разбивка суммарных действий аккаунта (из stats кампаний)
const ACT_META: Record<string, { label: string; color: string; Icon: any }> = {
  dm:      { label: 'DM',       color: '#663af1', Icon: Send },
  like:    { label: 'Лайки',    color: '#ff2d92', Icon: Heart },
  follow:  { label: 'Подписки', color: '#34c759', Icon: UserCheck },
  story:   { label: 'Сторис',   color: '#ff9f0a', Icon: Clapperboard },
  comment: { label: 'Комменты', color: '#34c759', Icon: MessageCircle },
}

// Действия кампании со счётчиком срабатываний по каждому (как на вкладке «Кампании»)
interface ActRow { key: string; label: string; color: string; Icon: any; fired: number; done: number; settings: string[] }
function campaignActionRows(c: any): ActRow[] {
  const on = (a: any) => a && a.enabled !== false
  const acts = c.actions ?? []
  const stats = c.stats ?? {}
  const isComment = c.triggerType === 'NEW_COMMENT'
  const rows: ActRow[] = []
  const dm = acts.find((a: any) => a.type === 'SEND_MESSAGE' && on(a))
  const legacyGate = acts.find((a: any) => a.type === 'COMMENT_GATE' && on(a))
  if (dm) {
    const set: string[] = []
    if (dm.link?.enabled) set.push('ссылка')
    if (dm.image?.enabled) set.push('фото')
    const gate = dm.gate ?? (legacyGate ? { mode: 'followed_by' } : null)
    if (gate) set.push(gate.mode === 'mutual' ? 'взаимная подписка' : 'проверка подписки')
    const st = readStat(stats, 'dm')
    rows.push({ key: 'dm', label: 'DM', color: '#663af1', Icon: Send, fired: st.fired, done: st.done, settings: set })
  }
  const reply = acts.find((a: any) => a.type === 'REPLY_COMMENT' && on(a))
  if (reply) { const st = readStat(stats, 'comment'); rows.push({ key: 'comment', label: 'Коммент', color: '#34c759', Icon: MessageCircle, fired: st.fired, done: st.done, settings: [`${(reply.replies ?? []).filter(Boolean).length} вар.`] }) }
  const likeMedia = acts.some((a: any) => a.type === 'LIKE_MEDIA' && on(a))
  const likeComment = acts.some((a: any) => a.type === 'LIKE_COMMENT' && on(a))
  if (likeMedia || likeComment) {
    const set: string[] = []
    if (likeMedia) set.push(isComment ? 'посты автора' : 'последний пост')
    if (likeComment) set.push('коммент')
    const st = readStat(stats, 'like')
    rows.push({ key: 'like', label: 'Лайк', color: '#ff2d92', Icon: Heart, fired: st.fired, done: st.done, settings: set })
  }
  if (acts.some((a: any) => a.type === 'FOLLOW_BACK' && on(a))) { const st = readStat(stats, 'follow'); rows.push({ key: 'follow', label: 'Подписка', color: '#34c759', Icon: UserCheck, fired: st.fired, done: st.done, settings: [] }) }
  const story = acts.find((a: any) => a.type === 'VIEW_STORIES' && on(a))
  if (story) { const st = readStat(stats, 'story'); rows.push({ key: 'story', label: 'Сторис', color: '#ff9f0a', Icon: Clapperboard, fired: st.fired, done: st.done, settings: [story.like ? 'просмотр + лайк' : 'просмотр'] }) }
  return rows
}

// ── Детальное окно аккаунта: статистика + кампании ────────────────────────────
function AccountDetailModal({ acc, ra, campaigns, sections = [], secCtx, onChanged, onClose, onOpenLog }: {
  acc: { username: string; followers?: number }
  ra?: RealAccount
  campaigns: any[]
  sections?: SectionItem[]
  secCtx?: { draftCount?: number; allowNoDrafts?: boolean }
  onChanged?: () => void
  onClose: () => void
  onOpenLog?: () => void
}) {
  const roots = sections.filter((s) => !s.parentId)
  const curSub = sections.find((s) => s.id === ra?.sectionId && s.parentId)
  const [secId, setSecId] = useState(curSub ? (curSub.parentId as string) : (ra?.sectionId ?? ''))
  const [subId, setSubId] = useState(curSub ? curSub.id : '')
  const [savingSec, setSavingSec] = useState(false)
  const subs = sections.filter((s) => s.parentId === secId)

  const saveSection = async (nextSec: string, nextSub: string) => {
    if (!ra?.id) return
    setSavingSec(true)
    try {
      await fetch(`/api/accounts/${ra.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId: nextSub || nextSec || null }),
      })
      onChanged?.()
    } finally { setSavingSec(false) }
  }

  const status = ra?.status ?? 'ACTIVE'
  const st = status === 'ACTIVE'
    ? { pill: 'bg-ok/10 text-ok', dot: 'bg-ok', t: 'Активен' }
    : status === 'BLOCKED'
      ? { pill: 'bg-bad/10 text-bad', dot: 'bg-bad', t: 'Заблокирован' }
      : status === 'CHALLENGE'
        ? { pill: 'bg-bad/10 text-bad', dot: 'bg-bad', t: 'Требует входа' }
        : { pill: 'bg-warn/10 text-warn', dot: 'bg-warn', t: 'Пауза' }

  const totalFires = campaigns.reduce((s, c) => s + (c.fireCount ?? 0), 0)
  const activeCount = campaigns.filter((c) => c.isActive).length
  const aggDone: Record<string, number> = {}
  const aggFired: Record<string, number> = {}
  campaigns.forEach((c) => {
    for (const k of ACTION_KEYS) {
      const st = readStat(c.stats ?? {}, k)
      aggDone[k] = (aggDone[k] ?? 0) + st.done
      aggFired[k] = (aggFired[k] ?? 0) + st.fired
    }
  })
  const aggEntries = Object.keys(ACT_META).filter((k) => (aggFired[k] ?? 0) > 0)

  const tile = (icon: any, val: string | number, label: string, color: string, tip?: string) => {
    const Icon = icon
    return (
      <div className="rounded-2xl bg-canvas p-3.5 text-center relative">
        {tip && <div className="absolute right-2 top-2"><Hint text={tip} /></div>}
        <div className="flex items-center justify-center gap-1.5 text-[18px] font-semibold tabular-nums">
          <Icon className="w-4 h-4" style={{ color }} />{val}
        </div>
        <div className="text-[11px] text-subt mt-0.5">{label}</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[86vh] overflow-y-auto animate-scale-in" onClick={(e) => e.stopPropagation()}>
        {/* Шапка с IG-градиентом */}
        <div className="relative p-6 pb-5 overflow-hidden border-b border-black/[0.05]">
          <div className="absolute inset-0 bg-gradient-to-br from-[#feda75]/15 via-[#d62976]/12 to-[#4f5bd5]/15 pointer-events-none" />
          <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
            {onOpenLog && (
              <button onClick={onOpenLog} title="Открыть лог" className="p-1.5 text-subt hover:text-brand transition-colors"><ScrollText size={18} /></button>
            )}
            <button onClick={onClose} className="p-1.5 text-subt hover:text-ink transition-colors"><X size={20} /></button>
          </div>
          <div className="relative flex items-center gap-4">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-bold text-2xl shadow-lg shrink-0">
              {acc.username[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-[20px] font-semibold tracking-tight truncate">@{acc.username}</div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={cn('flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-0.5 rounded-full', st.pill)}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', st.dot)} /> {st.t}
                </span>
                {ra && <SecurityBadge acc={ra} ctx={{ ...secCtx, totalFires }} size="lg" />}
                {ra?.lastChecked && (
                  <span className="flex items-center gap-1 text-[11px] text-subt">
                    <Calendar className="w-3 h-3" /> {new Date(ra.lastChecked).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {ra?.errorCount ? <span className="text-[11px] text-bad">⚠ {ra.errorCount} ошибок</span> : null}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Ключевые цифры */}
          <div className="grid grid-cols-3 gap-3">
            {tile(Users, formatFollowers(ra?.followers ?? ra?.followerCount ?? acc.followers ?? 0), 'подписчики', '#8e8e93')}
            {tile(Zap, `${activeCount}/${campaigns.length}`, 'кампаний активно', '#663af1', 'Слева — сколько кампаний сейчас включено, справа — сколько всего создано на этом аккаунте (включая поставленные на паузу).')}
            {tile(Send, totalFires.toLocaleString('ru'), 'срабатываний', '#34c759', 'Сколько раз кампании этого аккаунта поймали событие. Это попытки — не то же самое, что реально выполненные действия (см. ниже, «выполнено / сработало»).')}
          </div>

          {/* Раздел / подраздел (папка) — редактирование, план §C2 */}
          {ra?.id && roots.length > 0 && (
            <div className="rounded-2xl bg-canvas px-4 py-3">
              <div className="text-[12px] font-semibold text-subt mb-2 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5" /> Раздел {savingSec && <Loader2 className="w-3 h-3 animate-spin" />}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={secId} disabled={savingSec}
                  onChange={(e) => { const v = e.target.value; setSecId(v); setSubId(''); saveSection(v, '') }}
                  className="field text-[13px] py-2.5">
                  <option value="">— без раздела —</option>
                  {roots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={subId} disabled={savingSec || !secId || subs.length === 0}
                  onChange={(e) => { const v = e.target.value; setSubId(v); saveSection(secId, v) }}
                  className="field text-[13px] py-2.5 disabled:opacity-40">
                  <option value="">{secId && subs.length === 0 ? 'нет подразделов' : '— подраздел —'}</option>
                  {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Прирост подписчиков */}
          <div className="rounded-2xl bg-canvas px-4 py-3">
            <div className="text-[12px] font-semibold text-subt mb-1 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Прирост подписчиков</div>
            <Sparkline data={ra?.followersHistory ?? []} w={480} h={44} />
          </div>

          {/* Разбивка действий */}
          {aggEntries.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-subt mb-2">
                <TrendingUp className="w-3.5 h-3.5" /> Действия <span className="font-normal text-subt/70">· выполнено / сработало</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {aggEntries.map((k) => {
                  const m = ACT_META[k]; const Icon = m.Icon
                  const gap = (aggFired[k] ?? 0) - (aggDone[k] ?? 0)
                  return (
                    <span key={k} className="flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-xl" style={{ background: hexA(m.color, 0.1), color: m.color }} title="выполнено / сработало">
                      <Icon className="w-3.5 h-3.5" /> {m.label} <span className="tabular-nums font-semibold">{(aggDone[k] ?? 0).toLocaleString('ru')}/{(aggFired[k] ?? 0).toLocaleString('ru')}</span>
                      {gap > 0 && <span className="text-bad font-semibold">−{gap}</span>}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* Рекламные кампании */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-subt">
                <Activity className="w-3.5 h-3.5" /> Рекламные кампании ({campaigns.length})
              </div>
              <a href={`/triggers?account=${ra?.id ?? ''}`} target="_blank" rel="noopener" className="text-[12px] font-medium text-brand hover:underline">Открыть в отдельном окне ↗</a>
            </div>
            {campaigns.length === 0 ? (
              <div className="rounded-2xl bg-canvas p-6 text-center">
                <div className="text-[13px] text-subt">На этом аккаунте пока нет кампаний.</div>
                <a href={`/triggers?account=${ra?.id ?? ''}`} className="inline-block mt-2 text-[13px] font-medium text-brand hover:underline">Создать кампанию →</a>
              </div>
            ) : (
              <div className="space-y-2.5">
                {campaigns.map((c) => {
                  const meta = TYPE_META[c.triggerType] ?? { label: c.triggerType, color: '#8e8e93', Icon: Zap }
                  const Icon = meta.Icon
                  const rows = campaignActionRows(c)
                  return (
                    <div key={c.id} className={cn('rounded-2xl border p-3.5 transition-all', c.isActive ? 'border-line/60 bg-white' : 'border-line/40 bg-canvas/50 opacity-70')}>
                      <div className="flex items-start gap-3">
                        <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `linear-gradient(145deg, ${meta.color}, ${hexA(meta.color, 0.7)})`, boxShadow: `0 3px 10px ${hexA(meta.color, 0.4)}` }}>
                          <Icon className="w-4 h-4 text-white" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[14px] truncate">{c.name}</span>
                            <span className="flex items-center gap-1 text-[11px] shrink-0">
                              <span className={cn('w-1.5 h-1.5 rounded-full', c.isActive ? 'bg-ok' : 'bg-subt/40')} />
                              <span className={c.isActive ? 'text-ok' : 'text-subt'}>{c.isActive ? 'вкл' : 'выкл'}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: hexA(meta.color, 0.12), color: meta.color }}>{meta.label}</span>
                            <span className="text-[11px] text-subt">сработал <span className="font-semibold text-ink">{(c.fireCount ?? 0).toLocaleString('ru')}</span> раз</span>
                          </div>
                          {rows.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {rows.map((r) => {
                                const active = r.done > 0
                                const gap = r.fired - r.done
                                return (
                                  <span key={r.key} className={cn('flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg font-semibold', !active && 'opacity-80')}
                                    title="выполнено / сработало"
                                    style={active
                                      ? { background: `linear-gradient(135deg, ${r.color}, ${darken(r.color)})`, color: '#fff', boxShadow: `0 2px 6px ${hexA(r.color, 0.35)}` }
                                      : { background: hexA(r.color, 0.1), color: r.color }}>
                                    <r.Icon className="w-3 h-3" strokeWidth={2.4} /> {r.label}
                                    <span className="tabular-nums opacity-90">{r.done.toLocaleString('ru')}/{r.fired.toLocaleString('ru')}</span>
                                    {gap > 0 && <span className="opacity-90 font-normal">(−{gap})</span>}
                                    {r.settings.length > 0 && <span className="opacity-70 font-normal hidden sm:inline">· {r.settings.join(', ')}</span>}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Подробности */}
          <div>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-subt mb-2">
              <Info className="w-3.5 h-3.5" /> Подробности
            </div>
            <div className="rounded-2xl bg-canvas divide-y divide-black/[0.05] text-[12.5px]">
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-subt">Роль</span>
                <span className="font-medium">{ra?.role === 'HELPER' ? 'Черновой (парсер)' : ra?.role === 'BOTH' ? 'Универсальный' : 'Основной'}</span>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-subt">Последняя проверка</span>
                <span className="font-medium">{ra?.lastChecked ? new Date(ra.lastChecked).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-subt">Ошибок подряд</span>
                <span className={cn('font-medium', (ra?.errorCount ?? 0) > 0 ? 'text-bad' : 'text-ok')}>{ra?.errorCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="text-subt shrink-0">Прокси</span>
                <span className="font-mono text-[11px] text-ink/70 truncate flex items-center gap-1 min-w-0">
                  <Globe className="w-3 h-3 shrink-0 text-subt" /> {ra?.proxy || 'не задан'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Accounts() {
  const removeAccount          = useStore((s) => s.removeAccount)
  const toggleStatus           = useStore((s) => s.toggleAccountStatus)

  const [showAdd, setShowAdd]       = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [realAccounts, setReal]     = useState<RealAccount[]>([])
  const [allowNoDrafts, setAllowNoDrafts] = useState(false)  // из /api/settings — для индекса безопасности
  const [polling, setPolling]       = useState(false)
  const [pollMsg, setPollMsg]       = useState('')
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [editProxyId, setEditProxyId]   = useState<string | null>(null)
  const [editProxyVal, setEditProxyVal] = useState('')
  const [detail, setDetail] = useState<{ acc: any; ra?: RealAccount } | null>(null)
  const [pendingDel, setPendingDel] = useState<{ raId?: string; accId: string; username: string } | null>(null)
  const [logAcc, setLogAcc] = useState<{ id: string; username: string } | null>(null)

  const [dbTriggers, setDbTriggers] = useState<any[]>([])
  const [sections, setSections] = useState<SectionItem[]>([])
  const [selSection, setSelSection] = useState('')   // фильтр по разделу
  const [selSub, setSelSub] = useState('')            // фильтр по подразделу

  const loadSections = useCallback(async () => {
    try { const r = await fetch('/api/sections'); if (r.ok) setSections(await r.json()) } catch {}
  }, [])

  const loadRealAccounts = useCallback(async () => {
    try {
      const [accRes, trRes, secRes, setRes] = await Promise.all([fetch('/api/accounts'), fetch('/api/triggers'), fetch('/api/sections'), fetch('/api/settings')])
      if (accRes.ok) setReal(await accRes.json())
      if (trRes.ok) setDbTriggers(await trRes.json())
      if (secRes.ok) setSections(await secRes.json())
      if (setRes.ok) { const d = await setRes.json(); setAllowNoDrafts(Boolean(d.allowNoDrafts)) }
    } catch {}
  }, [])

  useEffect(() => { loadRealAccounts() }, [loadRealAccounts])

  // Живые черновые (HELPER) — глобально, для индекса безопасности основных.
  const draftCount = realAccounts.filter((r) => r.role === 'HELPER' && r.status === 'ACTIVE' && r.hasSession).length
  const secCtx = { draftCount, allowNoDrafts }

  // Статистика берётся из БД-триггеров (как на странице «Триггеры»), а не из Zustand —
  // иначе цифры не сходятся.
  const statsFor = (id: string) => {
    const ts = dbTriggers.filter((t) => t.responder?.id === id)
    return {
      triggerCount: ts.length,
      activeCount:  ts.filter((t) => t.isActive).length,
      runs:         ts.reduce((s, t) => s + (t.fireCount ?? 0), 0),
    }
  }

  const handlePoll = async () => {
    setPolling(true)
    setPollMsg('')
    try {
      // manual: true — ставим действия в очередь с разнесёнными задержками (безопасно от бана)
      const res = await fetch('/api/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manual: true }) })
      const data = await res.json()
      if (data.ok) {
        const sum = (k: string) => data.summary?.reduce((s: number, r: any) => s + (r[k] ?? 0), 0) ?? 0
        const totalDms = data.summary?.reduce((s: number, r: any) => s + (r.dmsQueued ?? r.dmsSent ?? 0), 0) ?? 0
        const parts = [
          `Подписчиков: ${sum('totalFollowers')}`,
          `новых: ${sum('newFollowers')}`,
          `запланировано: ${totalDms}`,
        ]
        if (sum('totalComments') > 0 || sum('newComments') > 0) {
          parts.push(`комментов: ${sum('totalComments')}`, `новых: ${sum('newComments')}`, `действий: ${sum('commentActions')}`)
        }
        if (sum('limited') > 0) parts.push(`лимит дня: ${sum('limited')}`)
        setPollMsg(parts.join(' | ') + ' — отправка с задержками')
        loadRealAccounts()
      } else {
        setPollMsg(data.error ?? 'Ошибка')
      }
    } catch {
      setPollMsg('Ошибка сети')
    } finally {
      setPolling(false)
    }
  }

  const handleDelete = async (id: string, _username: string) => {
    setLoadingIds((s) => new Set(s).add(id))
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setPollMsg(data.error ?? 'Не удалось удалить аккаунт')
        return
      }
      removeAccount(id)
      setReal((prev) => prev.filter((a) => a.id !== id))
    } catch {
      setPollMsg('Ошибка сети при удалении')
    } finally {
      setLoadingIds((s) => { const n = new Set(s); n.delete(id); return n })
    }
  }

  const handleResetSnapshot = async (id: string) => {
    const res = await fetch(`/api/accounts/${id}/reset-snapshot`, { method: 'DELETE' }).catch(() => null)
    setPollMsg(res && res.ok
      ? 'Сброшено ✓ При следующей «Проверить подписчиков» текущие подписчики будут обработаны как новые (сработают триггеры, в пределах дневных лимитов).'
      : 'Не удалось сбросить снапшот')
  }

  const handleSaveProxy = async (id: string) => {
    const proxy = editProxyVal.trim()
    await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: proxy || null }),
    }).catch(() => null)
    setReal((prev) => prev.map((a) => a.id === id ? { ...a, proxy: proxy || null } : a))
    setEditProxyId(null)
    setPollMsg(`Прокси ${proxy ? 'обновлён' : 'удалён'} для аккаунта`)
  }

  const handleToggle = async (id: string, accId: string) => {
    const ra = realAccounts.find((a) => a.id === id)
    const newStatus = ra?.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    }).catch(() => null)
    toggleStatus(accId)
    setReal((prev) => prev.map((a) => a.id === id ? { ...a, status: newStatus } : a))
  }

  // Список строится напрямую из реальных DB-аккаунтов (единственный источник правды).
  // Раньше сверялся с локальным Zustand-списком (localStorage) по username — если там
  // не было записи (другой браузер/устройство, очищенный кэш), аккаунт не показывался
  // вообще, и перезагрузка страницы не помогала, т.к. источник данных не обновляется.
  // Черновые (HELPER) сюда не показываем — у них своя вкладка «Черновые аккаунты».
  const mergedAccounts = realAccounts
    .filter((r) => r.role !== 'HELPER')
    .map((r) => ({ id: r.id, username: r.username, followers: r.followers ?? r.followerCount ?? 0, status: r.status, real: r }))

  // Счётчик аккаунтов по разделам (для чипов): раздел = свои + все его подразделы
  const sectionsWithCount: SectionItem[] = sections.map((s) => ({
    ...s,
    accountCount: mergedAccounts.filter((a) => a.real?.sectionId === s.id).length,
  }))

  // Фильтр по выбранному разделу/подразделу (раздел включает свои подразделы)
  const visibleAccounts = mergedAccounts.filter((a) => {
    const sid = a.real?.sectionId ?? null
    if (selSub) return sid === selSub
    if (selSection) {
      const subIds = sections.filter((s) => s.parentId === selSection).map((s) => s.id)
      return sid === selSection || subIds.includes(sid ?? '')
    }
    return true
  })

  return (
    <div className="space-y-6">
      <PageHeader icon={Users} color={TONE.brand} title="Основные аккаунты" subtitle="Отправляют директ, лайк и подписку — вход и действия через реальный браузер">
        <Button variant="secondary" onClick={handlePoll} disabled={polling}>
          {polling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {polling ? 'Проверка…' : 'Проверить подписчиков'}
        </Button>
        <Button variant="secondary" onClick={() => setShowImport(true)}><Cookie className="w-4 h-4" /> Импорт списком</Button>
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Добавить</Button>
      </PageHeader>

      {pollMsg && (
        <div className="text-[13px] text-subt bg-canvas rounded-2xl px-4 py-3">{pollMsg}</div>
      )}

      <DraftsStatus />

      {/* Разделы/подразделы (папки) + фильтр. Создание — кнопкой «+ Раздел». */}
      {mergedAccounts.length > 0 && (
        <SectionBar sections={sectionsWithCount} selSection={selSection} selSub={selSub}
          onSelect={(sec, sub) => { setSelSection(sec); setSelSub(sub) }} onReload={loadSections} />
      )}

      {realAccounts.length > 0 && mergedAccounts.length === 0 && (
        <div className="card p-5 text-[14px] text-subt">
          Все подключённые аккаунты ({realAccounts.length}) — черновые (парсеры). Они находятся на вкладке «Черновые аккаунты».
        </div>
      )}

      {mergedAccounts.length === 0 && realAccounts.length === 0 ? (
        <div className="card card-3d gloss p-16 text-center flex flex-col items-center">
          <IconTile icon={UserPlus} color={TONE.brand} size={64} className="mb-5 rounded-3xl" />
          <h3 className="text-[19px] font-semibold tracking-tight">Добавьте первый аккаунт</h3>
          <p className="text-subt text-[14px] mt-1.5 max-w-sm">
            Введите логин и пароль Instagram — бот авторизуется и начнёт отслеживать подписчиков.
          </p>
          <Button className="mt-6" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Подключить аккаунт</Button>
        </div>
      ) : visibleAccounts.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-2 text-center">
          <div className="text-[13px] text-subt">В этом разделе пока нет аккаунтов</div>
          <button onClick={() => { setSelSection(''); setSelSub('') }} className="text-[12.5px] text-brand hover:underline">Показать все</button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleAccounts.map((acc) => {
            const st = statsFor(acc.id)
            const ra = acc.real
            const status = ra?.status ?? acc.status
            const isLoading = loadingIds.has(ra?.id ?? '')
            return (
              <Tilt key={acc.id}>
                <div className="card card-3d gloss p-5 relative overflow-hidden">
                  <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br from-brand/10 to-transparent blur-2xl pointer-events-none" />
                  <div onClick={() => setDetail({ acc, ra })} className="group cursor-pointer rounded-2xl -m-1 p-1 hover:bg-black/[0.015] transition-colors" title="Открыть подробности аккаунта">
                  <div className="flex items-start justify-between relative">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold text-lg shadow-md">
                        {acc.username[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-[15px]">@{acc.username}</div>
                        {ra?.lastChecked && (
                          <div className="text-[11px] text-subt">
                            Проверен {new Date(ra.lastChecked).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                        {!ra && <div className="text-[11px] text-warn">Не в БД</div>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className={cn('flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full',
                        status === 'ACTIVE' ? 'bg-ok/10 text-ok' : status === 'BLOCKED' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>
                        <span className={cn('w-1.5 h-1.5 rounded-full',
                          status === 'ACTIVE' ? 'bg-ok' : status === 'BLOCKED' ? 'bg-bad' : 'bg-warn')} />
                        {status === 'ACTIVE' ? 'Активен' : status === 'BLOCKED' ? 'Заблокирован' : 'Пауза'}
                      </span>
                      {ra && <SecurityBadge acc={ra} ctx={{ ...secCtx, totalFires: st.runs }} />}
                    </div>
                  </div>

                  {ra?.parseBlocked && (
                    <div className="mt-3 flex items-start gap-2 text-[11.5px] text-warn bg-warn/[0.08] rounded-xl px-3 py-2 leading-snug relative" title="Instagram показывает полный список подписчиков только владельцу такого аккаунта. Комментарии и лайки постов парсятся нормально.">
                      <span className="shrink-0">⚠️</span>
                      <span>Парсинг подписчиков невозможен — аккаунт скрыл список (проверенный/приватный). Триггер «Новая подписка» не сработает; комментарии и лайки — работают.</span>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2 mt-5 relative">
                    <div className="rounded-2xl bg-canvas p-3 text-center">
                      <div className="flex items-center justify-center gap-1 text-[15px] font-semibold">
                        <Users className="w-3.5 h-3.5 text-subt" />{formatFollowers(ra?.followers ?? ra?.followerCount ?? acc.followers)}
                      </div>
                      <div className="text-[11px] text-subt mt-0.5">подписчики</div>
                    </div>
                    <div className="rounded-2xl bg-canvas p-3 text-center">
                      <div className="flex items-center justify-center gap-1 text-[15px] font-semibold">
                        <Zap className="w-3.5 h-3.5 text-brand" />{st.triggerCount}
                      </div>
                      <div className="text-[11px] text-subt mt-0.5">{st.activeCount} активны</div>
                    </div>
                    <div className="rounded-2xl bg-canvas p-3 text-center">
                      <div className="flex items-center justify-center gap-1 text-[15px] font-semibold">
                        <Send className="w-3.5 h-3.5 text-ok" />{st.runs.toLocaleString('ru')}
                      </div>
                      <div className="text-[11px] text-subt mt-0.5">срабатываний</div>
                    </div>
                  </div>

                  {/* Спарклайн прироста подписчиков */}
                  <div className="mt-3 rounded-2xl bg-canvas px-3 py-2 relative">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10.5px] text-subt uppercase tracking-wider">Прирост подписчиков</span>
                    </div>
                    <Sparkline data={ra?.followersHistory ?? []} />
                  </div>
                  <div className="mt-2 text-[11px] text-brand/70 text-center opacity-0 group-hover:opacity-100 transition-opacity">Подробная статистика →</div>
                  </div>

                  {ra?.errorCount ? (
                    <div className="mt-3 text-[12px] text-bad text-center">⚠ {ra.errorCount} ошибок</div>
                  ) : null}

                  {/* Прокси — показываем/редактируем */}
                  {ra && (
                    <div className="mt-3 relative">
                      {editProxyId === ra.id ? (
                        <div className="flex gap-1.5">
                          <input
                            autoFocus
                            value={editProxyVal}
                            onChange={(e) => setEditProxyVal(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveProxy(ra.id); if (e.key === 'Escape') setEditProxyId(null) }}
                            className="field flex-1 font-mono text-[11px] py-1.5"
                            placeholder="user:pass@host:port"
                          />
                          <button onClick={() => handleSaveProxy(ra.id)}
                            className="px-2 rounded-xl bg-ok/10 text-ok hover:bg-ok/20 transition-colors">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setEditProxyId(null)}
                            className="px-2 rounded-xl bg-canvas text-subt hover:text-ink transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditProxyId(ra.id); setEditProxyVal(ra.proxy ?? '') }}
                          className="w-full flex items-center gap-1.5 text-[11px] text-subt hover:text-ink transition-colors group">
                          <Globe className="w-3 h-3 shrink-0" />
                          <span className="truncate font-mono">
                            {ra.proxy ? ra.proxy : 'Без прокси — нажмите чтобы добавить'}
                          </span>
                          <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 ml-auto" />
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 mt-4 pt-4 border-t border-black/[0.05] relative">
                    <Button variant="secondary" size="sm" className="flex-1"
                      onClick={() => ra ? handleToggle(ra.id, acc.id) : toggleStatus(acc.id)}>
                      {status === 'ACTIVE' ? <><Pause className="w-3.5 h-3.5" /> Пауза</> : <><Play className="w-3.5 h-3.5" /> Запустить</>}
                    </Button>
                    {ra && (
                      <Button variant="secondary" size="icon" title="Открыть лог"
                        onClick={() => setLogAcc({ id: ra.id, username: acc.username })}>
                        <ScrollText className="w-4 h-4" />
                      </Button>
                    )}
                    {ra && (
                      <Button variant="secondary" size="icon" title="Сбросить историю: текущие подписчики снова станут «новыми» и сработают триггеры при следующей проверке (в пределах дневных лимитов)"
                        onClick={(e) => { e.stopPropagation(); handleResetSnapshot(ra.id) }}>
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    )}
                    <Button variant="danger" size="icon" disabled={isLoading}
                      onClick={() => setPendingDel({ raId: ra?.id, accId: acc.id, username: acc.username })}>
                      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </Tilt>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDel)}
        title="Удалить аккаунт?"
        message={`@${pendingDel?.username ?? ''} будет отключён и удалён вместе со своими кампаниями и статистикой.`}
        confirmLabel="Удалить"
        onConfirm={() => {
          const p = pendingDel
          setPendingDel(null)
          if (p?.raId) handleDelete(p.raId, p.username)
          else if (p) removeAccount(p.accId)
        }}
        onCancel={() => setPendingDel(null)}
      />

      {showAdd && <AddAccountModal onClose={() => setShowAdd(false)} onAdded={() => loadRealAccounts()} />}
      {showImport && <ImportCookiesModal onClose={() => setShowImport(false)} onDone={() => loadRealAccounts()} />}

      {detail && (
        <AccountDetailModal
          acc={detail.acc}
          ra={detail.ra}
          sections={sections}
          secCtx={secCtx}
          onChanged={loadRealAccounts}
          campaigns={dbTriggers.filter((t) => t.responder?.id === (detail.ra?.id ?? detail.acc.id))}
          onClose={() => setDetail(null)}
          onOpenLog={detail.ra ? () => setLogAcc({ id: detail.ra!.id, username: detail.acc.username }) : undefined}
        />
      )}

      {logAcc && <LogModal accountId={logAcc.id} title={`@${logAcc.username}`} subtitle="Журнал аккаунта" onClose={() => setLogAcc(null)} />}
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Accounts /></ClientOnly>
}

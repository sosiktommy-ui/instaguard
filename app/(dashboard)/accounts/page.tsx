'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Play, Pause, Trash2, X, AtSign, Lock, Globe, Users, Zap, Send, UserPlus, RefreshCw, Loader2, RotateCcw, Pencil, Check, MessageCircle, Heart, Clapperboard, UserCheck, Activity, Calendar, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tilt } from '@/components/ui/Tilt'
import { useStore, formatFollowers } from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { cn } from '@/lib/utils'

interface RealAccount {
  id: string
  username: string
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE'
  lastChecked: string | null
  errorCount: number
  proxy: string | null
  followerCount: number
}

type AuthMode = 'password' | 'cookies'

function AddModal({ onClose, onAdded }: { onClose: () => void; onAdded: (username: string) => void }) {
  const addAccount = useStore((s) => s.addAccount)
  const [mode, setMode]         = useState<AuthMode>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [cookies, setCookies]   = useState('')
  const [proxy, setProxy]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [step, setStep]         = useState<'form' | 'auth'>('form')

  const canSubmit = mode === 'password'
    ? username.trim() && password.trim()
    : cookies.trim()

  const save = async () => {
    setLoading(true)
    setError('')
    setStep('auth')

    try {
      const body = mode === 'cookies'
        ? { authMethod: 'cookies', cookies: cookies.trim(), proxy: proxy.trim() || undefined }
        : { username: username.replace(/^@/, '').trim(), password, proxy: proxy.trim() || undefined }

      const res = await fetch('/api/accounts/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Ошибка авторизации'); setStep('form'); return }

      addAccount({ id: data.account.id, username: data.account.username, followers: 0 })
      onAdded(data.account.username)
      onClose()
    } catch {
      setError('Ошибка сети — проверьте подключение')
      setStep('form')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-md p-7 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[22px] font-semibold tracking-tight">Подключить аккаунт</h2>
          <button onClick={onClose} className="text-subt hover:text-ink"><X size={22} /></button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 p-1 bg-canvas rounded-2xl mb-5">
          {(['password', 'cookies'] as AuthMode[]).map((m) => (
            <button key={m} onClick={() => { setMode(m); setError('') }}
              className={cn('flex-1 py-2 text-[13px] font-medium rounded-xl transition-all',
                mode === m ? 'bg-card shadow text-ink' : 'text-subt hover:text-ink')}>
              {m === 'password' ? '🔑 Логин / Пароль' : '🍪 Куки'}
            </button>
          ))}
        </div>

        {step === 'auth' ? (
          <div className="py-12 flex flex-col items-center gap-4 text-center">
            <Loader2 className="w-10 h-10 text-brand animate-spin" />
            <div className="font-medium">Авторизация в Instagram…</div>
            <div className="text-[13px] text-subt">Это может занять 15–30 секунд</div>
          </div>
        ) : mode === 'password' ? (
          <div className="space-y-4">
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Instagram логин</label>
              <div className="relative">
                <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input value={username} onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  autoFocus className="field pl-10" placeholder="username" />
              </div>
            </div>
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  className="field pl-10" placeholder="••••••••" />
              </div>
            </div>
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Прокси (необязательно)</label>
              <div className="relative">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input value={proxy} onChange={(e) => setProxy(e.target.value)}
                  className="field pl-10 font-mono text-[13px]" placeholder="user:pass@host:port" />
              </div>
              <p className="text-[11px] text-subt mt-1.5 pl-1">Форматы: <code className="font-mono">user:pass@host:port</code> или <code className="font-mono">http://user:pass@host:port</code></p>
            </div>
            {error && <p className="text-bad text-[13px] text-center">{error}</p>}
            <div className="text-[12px] text-subt bg-canvas rounded-2xl p-3.5 leading-relaxed">
              Пароль не хранится — только сессия Instagram.
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Отмена</Button>
              <Button className="flex-1" onClick={save} disabled={!canSubmit}>Авторизоваться</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Куки Instagram</label>
              <textarea
                value={cookies} onChange={(e) => setCookies(e.target.value)}
                autoFocus rows={6}
                className="field font-mono text-[11px] resize-none leading-relaxed"
                placeholder={'{"sessionid": "abc123...", "ds_user_id": "12345", "csrftoken": "..."}\n\nИли просто sessionid:\nabc123...'}
              />
            </div>
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Прокси (необязательно)</label>
              <div className="relative">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input value={proxy} onChange={(e) => setProxy(e.target.value)}
                  className="field pl-10 font-mono text-[13px]" placeholder="user:pass@host:port" />
              </div>
              <p className="text-[11px] text-subt mt-1.5 pl-1">Форматы: <code className="font-mono">user:pass@host:port</code> или <code className="font-mono">http://user:pass@host:port</code></p>
            </div>
            {error && <p className="text-bad text-[13px] text-center">{error}</p>}
            <div className="text-[12px] text-subt bg-canvas rounded-2xl p-3.5 leading-relaxed">
              Экспортируйте куки с instagram.com через расширение браузера (например, Cookie-Editor). Нужен как минимум <code className="font-mono bg-black/5 px-1 rounded">sessionid</code>.
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Отмена</Button>
              <Button className="flex-1" onClick={save} disabled={!canSubmit}>Подключить</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Метаданные типов кампаний (совпадают с вкладкой «Триггеры») ───────────────
const TYPE_META: Record<string, { label: string; color: string; Icon: any }> = {
  NEW_FOLLOWER:  { label: 'Новая подписка',  color: '#0071e3', Icon: UserPlus },
  NEW_COMMENT:   { label: 'Комментарий',     color: '#34c759', Icon: MessageCircle },
  NEW_LIKE:      { label: 'Лайк',            color: '#ff2d92', Icon: Heart },
  STORY_MENTION: { label: 'Ответ на сторис', color: '#ff9f0a', Icon: Clapperboard },
}
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
// Разбивка суммарных действий аккаунта (из stats кампаний)
const ACT_META: Record<string, { label: string; color: string; Icon: any }> = {
  dm:      { label: 'DM',       color: '#0071e3', Icon: Send },
  like:    { label: 'Лайки',    color: '#ff2d92', Icon: Heart },
  follow:  { label: 'Подписки', color: '#34c759', Icon: UserCheck },
  story:   { label: 'Сторис',   color: '#ff9f0a', Icon: Clapperboard },
  comment: { label: 'Комменты', color: '#34c759', Icon: MessageCircle },
}
// Значки действий кампании из её actions[]
function campaignBadges(actions: any[]): { label: string; color: string; Icon: any }[] {
  const isOn = (a: any) => a && a.enabled !== false
  const out: { label: string; color: string; Icon: any }[] = []
  const msg = (actions ?? []).find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
  if (msg) out.push({ label: 'DM', color: '#0071e3', Icon: Send })
  if (msg?.gate) out.push({ label: msg.gate.mode === 'mutual' ? 'взаимная подписка' : 'проверка подписки', color: '#0071e3', Icon: UserCheck })
  if ((actions ?? []).some((a: any) => a.type === 'REPLY_COMMENT' && isOn(a))) out.push({ label: 'ответ в комментах', color: '#34c759', Icon: MessageCircle })
  if ((actions ?? []).some((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))) out.push({ label: 'лайк', color: '#ff2d92', Icon: Heart })
  if ((actions ?? []).some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))) out.push({ label: 'подписка', color: '#34c759', Icon: UserCheck })
  if ((actions ?? []).some((a: any) => a.type === 'VIEW_STORIES' && isOn(a))) out.push({ label: 'сторис', color: '#ff9f0a', Icon: Clapperboard })
  return out
}

// ── Детальное окно аккаунта: статистика + кампании ────────────────────────────
function AccountDetailModal({ acc, ra, campaigns, onClose }: {
  acc: { username: string; followers?: number }
  ra?: RealAccount
  campaigns: any[]
  onClose: () => void
}) {
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
  const agg: Record<string, number> = {}
  campaigns.forEach((c) => {
    const s = (c.stats ?? {}) as Record<string, any>
    for (const k in s) agg[k] = (agg[k] ?? 0) + (Number(s[k]) || 0)
  })
  const aggEntries = Object.keys(ACT_META).filter((k) => (agg[k] ?? 0) > 0)

  const tile = (icon: any, val: string | number, label: string, color: string) => {
    const Icon = icon
    return (
      <div className="rounded-2xl bg-canvas p-3.5 text-center">
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
          <button onClick={onClose} className="absolute top-4 right-4 z-10 text-subt hover:text-ink transition-colors"><X size={20} /></button>
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
            {tile(Users, formatFollowers(ra?.followerCount ?? acc.followers ?? 0), 'подписчики', '#8e8e93')}
            {tile(Zap, `${activeCount}/${campaigns.length}`, 'кампаний активно', '#0071e3')}
            {tile(Send, totalFires.toLocaleString('ru'), 'срабатываний', '#34c759')}
          </div>

          {/* Разбивка действий */}
          {aggEntries.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-subt mb-2">
                <TrendingUp className="w-3.5 h-3.5" /> Выполнено действий
              </div>
              <div className="flex flex-wrap gap-2">
                {aggEntries.map((k) => {
                  const m = ACT_META[k]; const Icon = m.Icon
                  return (
                    <span key={k} className="flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-xl" style={{ background: hexA(m.color, 0.1), color: m.color }}>
                      <Icon className="w-3.5 h-3.5" /> {m.label} <span className="tabular-nums font-semibold">×{agg[k].toLocaleString('ru')}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* Рекламные кампании */}
          <div>
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-subt mb-2">
              <Activity className="w-3.5 h-3.5" /> Рекламные кампании ({campaigns.length})
            </div>
            {campaigns.length === 0 ? (
              <div className="rounded-2xl bg-canvas p-6 text-center">
                <div className="text-[13px] text-subt">На этом аккаунте пока нет кампаний.</div>
                <a href="/triggers" className="inline-block mt-2 text-[13px] font-medium text-brand hover:underline">Создать триггер →</a>
              </div>
            ) : (
              <div className="space-y-2.5">
                {campaigns.map((c) => {
                  const meta = TYPE_META[c.triggerType] ?? { label: c.triggerType, color: '#8e8e93', Icon: Zap }
                  const Icon = meta.Icon
                  const badges = campaignBadges(c.actions ?? [])
                  const cs = (c.stats ?? {}) as Record<string, any>
                  const csEntries = Object.keys(ACT_META).filter((k) => (Number(cs[k]) || 0) > 0)
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
                          {badges.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {badges.map((b, i) => {
                                const BI = b.Icon
                                return (
                                  <span key={i} className="flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full font-medium" style={{ background: hexA(b.color, 0.1), color: b.color }}>
                                    <BI className="w-2.5 h-2.5" /> {b.label}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                          {csEntries.length > 0 && (
                            <div className="text-[11px] text-subt mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                              {csEntries.map((k) => (
                                <span key={k}>{ACT_META[k].label}: <span className="font-medium text-ink tabular-nums">{Number(cs[k]).toLocaleString('ru')}</span></span>
                              ))}
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

          {/* Прокси */}
          {ra?.proxy && (
            <div className="flex items-center gap-1.5 text-[11px] text-subt font-mono bg-canvas rounded-xl px-3 py-2">
              <Globe className="w-3 h-3 shrink-0" /> <span className="truncate">{ra.proxy}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Accounts() {
  const accounts               = useStore((s) => s.accounts)
  const removeAccount          = useStore((s) => s.removeAccount)
  const toggleStatus           = useStore((s) => s.toggleAccountStatus)

  const [showAdd, setShowAdd]       = useState(false)
  const [realAccounts, setReal]     = useState<RealAccount[]>([])
  const [polling, setPolling]       = useState(false)
  const [pollMsg, setPollMsg]       = useState('')
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const [editProxyId, setEditProxyId]   = useState<string | null>(null)
  const [editProxyVal, setEditProxyVal] = useState('')
  const [detail, setDetail] = useState<{ acc: any; ra?: RealAccount } | null>(null)

  const [dbTriggers, setDbTriggers] = useState<any[]>([])

  const loadRealAccounts = useCallback(async () => {
    try {
      const [accRes, trRes] = await Promise.all([fetch('/api/accounts'), fetch('/api/triggers')])
      if (accRes.ok) setReal(await accRes.json())
      if (trRes.ok) setDbTriggers(await trRes.json())
    } catch {}
  }, [])

  useEffect(() => { loadRealAccounts() }, [loadRealAccounts])

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
      ? 'Снапшот сброшен — при следующей проверке все подписчики будут считаться новыми'
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

  // Merge Zustand accounts (UI) with real DB accounts for display
  const mergedAccounts = accounts.map((a) => ({
    ...a,
    real: realAccounts.find((r) => r.username === a.username),
  }))

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tighter leading-none">Основные аккаунты</h1>
          <p className="text-subt mt-1.5 text-[14px]">Аккаунты подключены через Instagram API</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handlePoll} disabled={polling}>
            {polling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {polling ? 'Проверка…' : 'Проверить подписчиков'}
          </Button>
          <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Добавить</Button>
        </div>
      </div>

      {pollMsg && (
        <div className="text-[13px] text-subt bg-canvas rounded-2xl px-4 py-3">{pollMsg}</div>
      )}

      {realAccounts.length > 0 && mergedAccounts.length === 0 && (
        <div className="card p-5 text-[14px] text-subt">
          В БД есть {realAccounts.length} аккаунтов — перезагрузите страницу чтобы увидеть их в UI.
        </div>
      )}

      {mergedAccounts.length === 0 && realAccounts.length === 0 ? (
        <div className="card p-16 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-3xl bg-brand/10 flex items-center justify-center mb-5">
            <UserPlus className="w-8 h-8 text-brand" />
          </div>
          <h3 className="text-[19px] font-semibold tracking-tight">Добавьте первый аккаунт</h3>
          <p className="text-subt text-[14px] mt-1.5 max-w-sm">
            Введите логин и пароль Instagram — бот авторизуется и начнёт отслеживать подписчиков.
          </p>
          <Button className="mt-6" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Подключить аккаунт</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mergedAccounts.map((acc) => {
            const st = statsFor(acc.id)
            const ra = acc.real
            const status = ra?.status ?? acc.status
            const isLoading = loadingIds.has(ra?.id ?? '')
            return (
              <Tilt key={acc.id}>
                <div className="card p-5 relative overflow-hidden">
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
                    <span className={cn('flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full',
                      status === 'ACTIVE' ? 'bg-ok/10 text-ok' : status === 'BLOCKED' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>
                      <span className={cn('w-1.5 h-1.5 rounded-full',
                        status === 'ACTIVE' ? 'bg-ok' : status === 'BLOCKED' ? 'bg-bad' : 'bg-warn')} />
                      {status === 'ACTIVE' ? 'Активен' : status === 'BLOCKED' ? 'Заблокирован' : 'Пауза'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mt-5 relative">
                    <div className="rounded-2xl bg-canvas p-3 text-center">
                      <div className="flex items-center justify-center gap-1 text-[15px] font-semibold">
                        <Users className="w-3.5 h-3.5 text-subt" />{formatFollowers(ra?.followerCount ?? acc.followers)}
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
                      <div className="text-[11px] text-subt mt-0.5">ответов</div>
                    </div>
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
                      <Button variant="secondary" size="icon" title="Сбросить снапшот подписчиков"
                        onClick={() => handleResetSnapshot(ra.id)}>
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    )}
                    <Button variant="danger" size="icon" disabled={isLoading}
                      onClick={() => ra ? handleDelete(ra.id, acc.username) : removeAccount(acc.id)}>
                      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </Tilt>
            )
          })}
        </div>
      )}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onAdded={() => loadRealAccounts()} />}

      {detail && (
        <AccountDetailModal
          acc={detail.acc}
          ra={detail.ra}
          campaigns={dbTriggers.filter((t) => t.responder?.id === (detail.ra?.id ?? detail.acc.id))}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Accounts /></ClientOnly>
}

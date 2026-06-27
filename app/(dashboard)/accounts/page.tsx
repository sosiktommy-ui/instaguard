'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Play, Pause, Trash2, X, AtSign, Lock, Globe, Users, Zap, Send, UserPlus, RefreshCw, Loader2, RotateCcw } from 'lucide-react'
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
                  className="field pl-10 font-mono text-[13px]" placeholder="host:port:user:pass" />
              </div>
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
                  className="field pl-10 font-mono text-[13px]" placeholder="host:port:user:pass" />
              </div>
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

function Accounts() {
  const accounts               = useStore((s) => s.accounts)
  const triggers               = useStore((s) => s.triggers)
  const removeAccount          = useStore((s) => s.removeAccount)
  const toggleStatus           = useStore((s) => s.toggleAccountStatus)
  const updateAccountFollowers = useStore((s) => s.updateAccountFollowers)

  const [showAdd, setShowAdd]       = useState(false)
  const [realAccounts, setReal]     = useState<RealAccount[]>([])
  const [polling, setPolling]       = useState(false)
  const [pollMsg, setPollMsg]       = useState('')
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())

  const loadRealAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts')
      if (res.ok) setReal(await res.json())
    } catch {}
  }, [])

  useEffect(() => { loadRealAccounts() }, [loadRealAccounts])

  const statsFor = (id: string) => {
    const pairs = triggers.flatMap((t) => t.accounts.filter((a) => a.accountId === id).map((a) => ({ a, t })))
    return {
      triggerCount: new Set(pairs.map((p) => p.t.id)).size,
      activeCount:  pairs.filter((p) => p.a.active).length,
      runs:         pairs.reduce((s, p) => s + p.a.runs, 0),
    }
  }

  const handlePoll = async () => {
    setPolling(true)
    setPollMsg('')
    try {
      const res = await fetch('/api/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.ok) {
        const totalDms = data.summary?.reduce((s: number, r: any) => s + (r.dmsQueued ?? r.dmsSent ?? 0), 0) ?? 0
        const totalFollowers = data.summary?.reduce((s: number, r: any) => s + (r.totalFollowers ?? 0), 0) ?? 0
        const newFollowers = data.summary?.reduce((s: number, r: any) => s + (r.newFollowers ?? 0), 0) ?? 0
        data.summary?.forEach((r: any) => {
          if (r.totalFollowers != null) updateAccountFollowers(r.accountId, r.totalFollowers)
        })
        setPollMsg(`Подписчиков: ${totalFollowers} | Новых: ${newFollowers} | DM в очереди: ${totalDms}`)
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

  const handleDelete = async (id: string, username: string) => {
    setLoadingIds((s) => new Set(s).add(id))
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' }).catch(() => null)
    removeAccount(id)
    setReal((prev) => prev.filter((a) => a.id !== id))
    setLoadingIds((s) => { const n = new Set(s); n.delete(id); return n })
  }

  const handleResetSnapshot = async (id: string) => {
    await fetch(`/api/accounts/${id}/reset-snapshot`, { method: 'DELETE' }).catch(() => null)
    setPollMsg('Снапшот сброшен — при следующей проверке все подписчики будут считаться новыми')
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
                        <Users className="w-3.5 h-3.5 text-subt" />{formatFollowers(acc.followers)}
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

                  {ra?.errorCount ? (
                    <div className="mt-3 text-[12px] text-bad text-center">⚠ {ra.errorCount} ошибок</div>
                  ) : null}

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
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Accounts /></ClientOnly>
}

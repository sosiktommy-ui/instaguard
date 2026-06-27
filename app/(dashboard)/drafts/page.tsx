'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Globe, Zap, ShieldCheck, Loader2, AlertTriangle, Link2, X, AtSign, Lock, RotateCcw, Pencil, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ClientOnly from '@/components/common/ClientOnly'

interface HelperAccount {
  id: string
  username: string
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE'
  lastChecked: string | null
  errorCount: number
  proxy: string | null
}

type AuthMode = 'cookies' | 'password'

function AddHelperModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<AuthMode>('cookies')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [cookies, setCookies] = useState('')
  const [proxy, setProxy] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canSubmit = mode === 'cookies' ? cookies.trim() : username.trim() && password.trim()

  const save = async () => {
    setLoading(true)
    setError('')
    try {
      const body = mode === 'cookies'
        ? { authMethod: 'cookies', cookies: cookies.trim(), proxy: proxy.trim() || undefined, role: 'HELPER' }
        : { username: username.replace(/^@/, '').trim(), password, proxy: proxy.trim() || undefined, role: 'HELPER' }

      const res = await fetch('/api/accounts/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Ошибка авторизации'); return }
      onAdded()
      onClose()
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-md p-7 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight">Черновой аккаунт</h2>
            <p className="text-[13px] text-subt mt-0.5">Для парсинга — не используется для отправки</p>
          </div>
          <button onClick={onClose} className="text-subt hover:text-ink"><X size={22} /></button>
        </div>

        {/* Mode toggle — куки первые */}
        <div className="flex gap-1 p-1 bg-canvas rounded-2xl mb-5">
          {(['cookies', 'password'] as AuthMode[]).map((m) => (
            <button key={m} onClick={() => { setMode(m); setError('') }}
              className={cn('flex-1 py-2 text-[13px] font-medium rounded-xl transition-all',
                mode === m ? 'bg-card shadow text-ink' : 'text-subt hover:text-ink')}>
              {m === 'cookies' ? '🍪 Куки (рекомендуется)' : '🔑 Логин / Пароль'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center gap-4 text-center">
            <Loader2 className="w-10 h-10 text-brand animate-spin" />
            <div className="font-medium">Авторизация…</div>
            <div className="text-[13px] text-subt">15–30 секунд</div>
          </div>
        ) : mode === 'cookies' ? (
          <div className="space-y-4">
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Куки Instagram</label>
              <textarea value={cookies} onChange={(e) => setCookies(e.target.value)}
                autoFocus rows={5}
                className="field font-mono text-[11px] resize-none leading-relaxed"
                placeholder={'{"sessionid": "abc123...", "ds_user_id": "12345", "csrftoken": "..."}\n\nИли просто sessionid:\nabc123...'} />
            </div>
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Прокси (необязательно)</label>
              <div className="relative">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input value={proxy} onChange={(e) => setProxy(e.target.value)}
                  className="field pl-10 font-mono text-[13px]" placeholder="user:pass@host:port" />
              </div>
            </div>
            <div className="text-[12px] text-subt bg-canvas rounded-2xl p-3.5 leading-relaxed">
              Экспортируйте куки с instagram.com через Cookie-Editor. Нужен как минимум <code className="font-mono bg-black/5 px-1 rounded">sessionid</code>.
            </div>
            {error && <p className="text-bad text-[13px] text-center">{error}</p>}
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Отмена</Button>
              <Button className="flex-1" onClick={save} disabled={!canSubmit}>Подключить</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Instagram логин</label>
              <div className="relative">
                <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input value={username} onChange={(e) => setUsername(e.target.value)}
                  autoFocus className="field pl-10" placeholder="username" />
              </div>
            </div>
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
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
            </div>
            {error && <p className="text-bad text-[13px] text-center">{error}</p>}
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Отмена</Button>
              <Button className="flex-1" onClick={save} disabled={!canSubmit}>Авторизоваться</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Drafts() {
  const [accounts, setAccounts] = useState<HelperAccount[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [editProxyId, setEditProxyId] = useState<string | null>(null)
  const [editProxyVal, setEditProxyVal] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts')
      if (res.ok) {
        const all = await res.json()
        setAccounts(all.filter((a: any) => a.role === 'HELPER'))
      }
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' }).catch(() => null)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  const handleSaveProxy = async (id: string) => {
    const proxy = editProxyVal.trim()
    await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: proxy || null }),
    }).catch(() => null)
    setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, proxy: proxy || null } : a))
    setEditProxyId(null)
    setMsg(`Прокси ${proxy ? 'обновлён' : 'удалён'}`)
  }

  const handleResetSnapshot = async (id: string) => {
    await fetch(`/api/accounts/${id}/reset-snapshot`, { method: 'DELETE' }).catch(() => null)
    setMsg('Снапшот сброшен')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[26px] font-semibold tracking-tighter leading-none">Черновые аккаунты</h1>
              <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-warn/15 text-warn">BETA</span>
            </div>
            <p className="text-subt mt-1 text-[14px]">Парсят подписчиков — основные только отправляют</p>
          </div>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Добавить</Button>
      </div>

      {msg && <div className="text-[13px] text-subt bg-canvas rounded-2xl px-4 py-3">{msg}</div>}

      {accounts.length === 0 ? (
        <div className="card p-14 text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-3xl bg-[#5e5ce6]/10 flex items-center justify-center mb-4">
            <Zap className="w-7 h-7 text-[#5e5ce6]" />
          </div>
          <h3 className="text-[18px] font-semibold tracking-tight">Нет черновых аккаунтов</h3>
          <p className="text-subt text-[13px] mt-1.5 max-w-xs">
            Черновые аккаунты парсят подписчиков и комментарии — основные аккаунты остаются чистыми.
          </p>
          <Button className="mt-5" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Добавить аккаунт</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((a) => (
            <div key={a.id} className="card p-5 relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-[#5e5ce6]/10 blur-2xl pointer-events-none" />
              <div className="flex items-start justify-between relative">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-zinc-300 to-zinc-500 flex items-center justify-center text-white font-semibold text-lg shadow-md">
                    {a.username[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-[15px]">@{a.username}</div>
                    <div className="text-[11px] text-[#5e5ce6] font-medium">черновой · парсер</div>
                  </div>
                </div>
                <span className={cn('flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full',
                  a.status === 'ACTIVE' ? 'bg-ok/10 text-ok' : a.status === 'BLOCKED' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>
                  <span className={cn('w-1.5 h-1.5 rounded-full',
                    a.status === 'ACTIVE' ? 'bg-ok' : a.status === 'BLOCKED' ? 'bg-bad' : 'bg-warn')} />
                  {a.status === 'ACTIVE' ? 'Активен' : a.status === 'BLOCKED' ? 'Заблокирован' : 'Пауза'}
                </span>
              </div>

              {a.lastChecked && (
                <div className="text-[11px] text-subt mt-3 relative">
                  Последний парсинг: {new Date(a.lastChecked).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}

              {/* Прокси */}
              <div className="mt-3 relative">
                {editProxyId === a.id ? (
                  <div className="flex gap-1.5">
                    <input autoFocus value={editProxyVal} onChange={(e) => setEditProxyVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveProxy(a.id); if (e.key === 'Escape') setEditProxyId(null) }}
                      className="field flex-1 font-mono text-[11px] py-1.5" placeholder="user:pass@host:port" />
                    <button onClick={() => handleSaveProxy(a.id)} className="px-2 rounded-xl bg-ok/10 text-ok hover:bg-ok/20 transition-colors">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditProxyId(null)} className="px-2 rounded-xl bg-canvas text-subt hover:text-ink transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setEditProxyId(a.id); setEditProxyVal(a.proxy ?? '') }}
                    className="w-full flex items-center gap-1.5 text-[11px] text-subt hover:text-ink transition-colors group">
                    <Globe className="w-3 h-3 shrink-0" />
                    <span className="truncate font-mono">{a.proxy ?? 'Без прокси — нажмите чтобы добавить'}</span>
                    <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 ml-auto" />
                  </button>
                )}
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t border-black/[0.05] relative">
                <button onClick={() => handleResetSnapshot(a.id)}
                  className="flex items-center gap-1.5 text-[12px] text-subt hover:text-ink transition-colors px-2">
                  <RotateCcw className="w-3.5 h-3.5" /> Сбросить
                </button>
                <div className="flex-1" />
                <Button variant="danger" size="icon" onClick={() => handleDelete(a.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddHelperModal onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Drafts /></ClientOnly>
}

'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, AtSign, Lock, Globe, Loader2, FolderTree } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

type AuthMode = 'password' | 'cookies'

interface SectionItem { id: string; parentId: string | null; name: string }

/**
 * Единый переиспользуемый попап подключения Instagram-аккаунта.
 * Используется и на вкладке «Аккаунты», и на главном экране (кнопка «+ Аккаунт»).
 */
export function AddAccountModal({ onClose, onAdded }: { onClose: () => void; onAdded: (username: string) => void }) {
  const addAccount = useStore((s) => s.addAccount)
  const [mode, setMode]         = useState<AuthMode>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [cookies, setCookies]   = useState('')
  const [proxy, setProxy]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [step, setStep]         = useState<'form' | 'auth'>('form')

  // Разделы/подразделы (папки) — для назначения аккаунту при создании
  const [sections, setSections] = useState<SectionItem[]>([])
  const [secId, setSecId]       = useState('')  // корневой раздел
  const [subId, setSubId]       = useState('')  // подраздел

  useEffect(() => {
    fetch('/api/sections').then((r) => r.ok ? r.json() : []).then(setSections).catch(() => {})
  }, [])

  const roots = useMemo(() => sections.filter((s) => !s.parentId), [sections])
  const subs = useMemo(() => sections.filter((s) => s.parentId === secId), [sections, secId])

  const canSubmit = mode === 'password'
    ? username.trim() && password.trim()
    : cookies.trim()

  const save = async () => {
    setLoading(true)
    setError('')
    setStep('auth')

    try {
      const sectionId = subId || secId || undefined
      const body = mode === 'cookies'
        ? { authMethod: 'cookies', cookies: cookies.trim(), proxy: proxy.trim() || undefined, sectionId }
        : { username: username.replace(/^@/, '').trim(), password, proxy: proxy.trim() || undefined, sectionId }

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

        {/* Раздел / подраздел (папка). Создаются на главном экране кнопкой «+ Раздел». */}
        {step === 'form' && roots.length > 0 && (
          <div className="mb-4">
            <label className="text-[13px] text-subt font-medium mb-2 flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5" /> Раздел (необязательно)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select value={secId} onChange={(e) => { setSecId(e.target.value); setSubId('') }} className="field text-[13px] py-2.5">
                <option value="">— без раздела —</option>
                {roots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={subId} onChange={(e) => setSubId(e.target.value)} disabled={!secId || subs.length === 0}
                className="field text-[13px] py-2.5 disabled:opacity-40">
                <option value="">{secId && subs.length === 0 ? 'нет подразделов' : '— подраздел —'}</option>
                {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        )}

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

'use client'

import { useState } from 'react'
import { Plus, Trash2, Globe, Zap, ShieldCheck, Loader2, AlertTriangle, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore, Proxy } from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { cn } from '@/lib/utils'

function ProxyStatusBadge({ p }: { p: Proxy }) {
  if (p.status === 'CHECKING')
    return <span className="flex items-center gap-1.5 text-[12px] font-medium text-subt"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Проверка…</span>
  if (p.status === 'ERROR')
    return <span className="flex items-center gap-1.5 text-[12px] font-medium text-bad"><AlertTriangle className="w-3.5 h-3.5" /> Не отвечает</span>
  return <span className="flex items-center gap-1.5 text-[12px] font-medium text-ok"><ShieldCheck className="w-3.5 h-3.5" /> Подключён · {p.latency} ms</span>
}

function Drafts() {
  const proxies = useStore((s) => s.proxies)
  const draftAccounts = useStore((s) => s.draftAccounts)
  const addProxy = useStore((s) => s.addProxy)
  const updateProxy = useStore((s) => s.updateProxy)
  const removeProxy = useStore((s) => s.removeProxy)
  const addDraftAccount = useStore((s) => s.addDraftAccount)
  const removeDraftAccount = useStore((s) => s.removeDraftAccount)
  const assignProxy = useStore((s) => s.assignProxy)

  const [raw, setRaw] = useState('')
  const [error, setError] = useState('')
  const [draftName, setDraftName] = useState('')

  const connectProxy = () => {
    const id = addProxy(raw)
    if (!id) { setError('Неверный формат. Примеры: 1.2.3.4:8080 · host:port:user:pass · socks5://user:pass@host:port'); return }
    setError(''); setRaw('')
    // simulate a connection check
    setTimeout(() => {
      const ok = Math.random() < 0.85
      updateProxy(id, { status: ok ? 'CONNECTED' : 'ERROR', latency: ok ? 40 + Math.floor(Math.random() * 180) : undefined })
    }, 1200)
  }

  const addDraft = () => {
    const clean = draftName.replace(/^@/, '').trim()
    if (!clean) return
    addDraftAccount(clean)
    setDraftName('')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-[26px] font-semibold tracking-tighter leading-none">Черновые аккаунты и прокси</h1>
        <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-warn/15 text-warn">BETA</span>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Proxies */}
        <div className="card p-6">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-2xl bg-brand/10 flex items-center justify-center"><Globe className="w-[18px] h-[18px] text-brand" /></div>
            <div>
              <div className="font-semibold text-[16px]">Прокси</div>
              <div className="text-[12px] text-subt">Вставьте прокси — подключение проверится сразу</div>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <input value={raw} onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connectProxy()}
              className="field font-mono text-[13px]" placeholder="host:port:user:pass" />
            <Button onClick={connectProxy} disabled={!raw.trim()}><Link2 className="w-4 h-4" /> Подключить</Button>
          </div>
          {error && <p className="text-bad text-[12px] mt-2">{error}</p>}

          <div className="mt-5 space-y-2">
            {proxies.length === 0 && <div className="py-8 text-center text-subt text-[13px]">Нет добавленных прокси</div>}
            {proxies.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-3.5 rounded-2xl bg-canvas">
                <span className={cn('w-2.5 h-2.5 rounded-full shrink-0',
                  p.status === 'CONNECTED' ? 'bg-ok' : p.status === 'ERROR' ? 'bg-bad' : 'bg-warn animate-pulse')} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px] font-medium truncate">{p.host}:{p.port}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-black/[0.06] text-subt">{p.protocol}</span>
                    {p.username && <span className="text-[11px] text-subt">авторизация ✓</span>}
                  </div>
                </div>
                <ProxyStatusBadge p={p} />
                <button onClick={() => removeProxy(p.id)} className="text-subt hover:text-bad p-1 shrink-0"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </div>

        {/* Draft accounts */}
        <div className="card p-6">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-2xl bg-[#5e5ce6]/10 flex items-center justify-center"><Zap className="w-[18px] h-[18px] text-[#5e5ce6]" /></div>
            <div>
              <div className="font-semibold text-[16px]">Черновые аккаунты</div>
              <div className="text-[12px] text-subt">Резервные аккаунты с привязкой прокси</div>
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addDraft()}
              className="field text-[14px]" placeholder="username аккаунта" />
            <Button onClick={addDraft} disabled={!draftName.trim()}><Plus className="w-4 h-4" /> Добавить</Button>
          </div>

          <div className="mt-5 space-y-2">
            {draftAccounts.length === 0 && <div className="py-8 text-center text-subt text-[13px]">Нет черновых аккаунтов</div>}
            {draftAccounts.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3.5 rounded-2xl bg-canvas">
                <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-300 to-zinc-400 flex items-center justify-center text-white font-semibold shrink-0">
                  {d.username[0]?.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[14px] truncate">@{d.username}</div>
                  <div className="text-[12px] text-subt">черновой</div>
                </div>
                <select value={d.proxyId ?? ''} onChange={(e) => assignProxy(d.id, e.target.value || undefined)}
                  className="field py-2 text-[12px] w-40 shrink-0 cursor-pointer">
                  <option value="">Без прокси</option>
                  {proxies.filter((p) => p.status === 'CONNECTED').map((p) => (
                    <option key={p.id} value={p.id}>{p.host}:{p.port}</option>
                  ))}
                </select>
                <button onClick={() => removeDraftAccount(d.id)} className="text-subt hover:text-bad p-1 shrink-0"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Drafts /></ClientOnly>
}

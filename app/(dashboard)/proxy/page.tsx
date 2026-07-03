'use client'

import { useState, useEffect, useCallback } from 'react'
import { Globe, Plus, Trash2, RefreshCw, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ClientOnly from '@/components/common/ClientOnly'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { cn } from '@/lib/utils'

interface ProxyItem { id: string; url: string; kind: string; label: string | null; accountCount: number }

function Proxies() {
  const [proxies, setProxies] = useState<ProxyItem[]>([])
  const [cap, setCap] = useState(3)
  const [capInput, setCapInput] = useState('3')
  const [addVal, setAddVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [pendingDel, setPendingDel] = useState<ProxyItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/proxies')
      if (r.ok) {
        const d = await r.json()
        setProxies(d.proxies ?? [])
        setCap(d.accountsPerProxy ?? 3)
        setCapInput(String(d.accountsPerProxy ?? 3))
      }
    } catch {}
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const pool = proxies.filter((p) => p.kind === 'pool')
  const individual = proxies.filter((p) => p.kind === 'individual')
  const poolFree = pool.filter((p) => p.accountCount < cap).length

  const saveCap = async () => {
    const n = Math.max(1, Math.min(100, Math.round(Number(capInput) || cap)))
    await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountsPerProxy: n }) }).catch(() => null)
    setCap(n); setCapInput(String(n)); setMsg('Настройка сохранена'); load()
  }
  const addProxy = async () => {
    if (!addVal.trim()) return
    const r = await fetch('/api/proxies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: addVal }) }).catch(() => null)
    if (r && r.ok) { setAddVal(''); setMsg('Прокси добавлены в пул'); load() }
    else { const d = r ? await r.json().catch(() => ({})) : {}; setMsg(d.error ?? 'Ошибка добавления') }
  }
  const doDelete = async () => {
    const p = pendingDel; setPendingDel(null); if (!p) return
    await fetch(`/api/proxies/${p.id}`, { method: 'DELETE' }).catch(() => null)
    setProxies((prev) => prev.filter((x) => x.id !== p.id))
    setMsg('Прокси удалён')
  }

  const usageColor = (n: number) => n >= cap ? 'text-bad' : n >= Math.ceil(cap * 0.7) ? 'text-warn' : 'text-ok'

  const row = (p: ProxyItem) => (
    <div key={p.id} className="card p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0"><Globe className="w-4 h-4 text-brand" /></div>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[13px] truncate">{p.url}</div>
        <div className="text-[11px] text-subt">
          {p.kind === 'pool'
            ? <>пуловый · привязано аккаунтов: <span className={cn('font-semibold tabular-nums', usageColor(p.accountCount))}>{p.accountCount}/{cap}</span></>
            : <>индивидуальный · аккаунтов: <span className="font-semibold tabular-nums">{p.accountCount}</span></>}
        </div>
      </div>
      <button onClick={() => setPendingDel(p)} className="text-subt hover:text-bad p-2" title="Удалить прокси"><Trash2 className="w-4 h-4" /></button>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tighter leading-none">Прокси</h1>
          <p className="text-subt mt-1.5 text-[14px]">Пул прокси для авто-привязки и индивидуальные прокси аккаунтов</p>
        </div>
        <button onClick={load} className="p-2 text-subt hover:text-ink transition-colors" title="Обновить">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Легенда — что это и зачем */}
      <div className="card p-4 flex gap-3 text-[13px] text-subt leading-relaxed">
        <Info className="w-4 h-4 text-brand shrink-0 mt-0.5" />
        <div>
          <span className="text-ink font-medium">Пуловый</span> прокси делится между несколькими аккаунтами: при добавлении аккаунта с режимом «Авто» бот берёт свободный из пула.{' '}
          <span className="text-ink font-medium">Индивидуальный</span> — вводится вручную для одного аккаунта. Чем меньше аккаунтов на один прокси, тем безопаснее.
        </div>
      </div>

      {msg && <div className="text-[13px] text-subt bg-canvas rounded-2xl px-4 py-3">{msg}</div>}

      {/* Настройка: аккаунтов на прокси */}
      <div className="card p-5">
        <div className="text-[15px] font-semibold mb-1">Аккаунтов на один пуловый прокси</div>
        <div className="text-[12px] text-subt mb-3">Сколько аккаунтов авто-режим повесит на один прокси, прежде чем взять следующий.</div>
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={100} value={capInput} onChange={(e) => setCapInput(e.target.value)}
            className="field w-28 py-2 text-[14px]" />
          <Button variant="secondary" onClick={saveCap}>Сохранить</Button>
          <span className="text-[12px] text-subt ml-2">Свободных прокси в пуле: <span className="font-semibold text-ink tabular-nums">{poolFree}</span></span>
        </div>
      </div>

      {/* Добавление пуловых прокси */}
      <div className="card p-5">
        <div className="text-[15px] font-semibold mb-1">Добавить прокси в пул</div>
        <div className="text-[12px] text-subt mb-3">По одному на строку. Форматы: <code className="font-mono">user:pass@host:port</code> или <code className="font-mono">http://user:pass@host:port</code>.</div>
        <textarea value={addVal} onChange={(e) => setAddVal(e.target.value)} rows={3}
          className="field font-mono text-[12px] resize-none leading-relaxed" placeholder={'user:pass@host:port\nuser2:pass2@host2:port2'} />
        <div className="flex justify-end mt-3">
          <Button onClick={addProxy} disabled={!addVal.trim()}><Plus className="w-4 h-4" /> Добавить в пул</Button>
        </div>
      </div>

      {/* Пул */}
      <div>
        <div className="flex items-center gap-2 px-1 mb-2">
          <span className="font-semibold text-[15px]">Пул</span>
          <span className="text-[12px] text-subt">({pool.length})</span>
        </div>
        {pool.length === 0 ? (
          <div className="card p-10 text-center text-[13px] text-subt">Пул пуст. Добавьте прокси выше — тогда при создании аккаунта появится режим «Авто».</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">{pool.map(row)}</div>
        )}
      </div>

      {/* Индивидуальные */}
      {individual.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-1 mb-2">
            <span className="font-semibold text-[15px]">Индивидуальные</span>
            <span className="text-[12px] text-subt">({individual.length})</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">{individual.map(row)}</div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDel)}
        title="Удалить прокси?"
        message={`${pendingDel?.url ?? ''} будет удалён. Привязанные аккаунты останутся, но без этого прокси в списке — переназначьте им прокси при необходимости.`}
        confirmLabel="Удалить"
        onConfirm={doDelete}
        onCancel={() => setPendingDel(null)}
      />
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Proxies /></ClientOnly>
}

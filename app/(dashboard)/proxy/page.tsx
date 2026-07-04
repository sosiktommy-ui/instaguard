'use client'

import { useState, useEffect, useCallback } from 'react'
import { Globe, Plus, Trash2, RefreshCw, Info, Users, ChevronDown, ChevronUp, Sliders, Layers, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ClientOnly from '@/components/common/ClientOnly'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { cn } from '@/lib/utils'

interface AccRef { username: string; role: string; status: string }
interface ProxyItem { id: string; url: string; kind: string; label: string | null; accountCount: number; accounts: AccRef[] }

const STATUS_DOT: Record<string, string> = { ACTIVE: 'bg-ok', PAUSED: 'bg-warn', BLOCKED: 'bg-bad', CHALLENGE: 'bg-bad' }
const roleLabel = (r: string) => (r === 'HELPER' ? 'черновой' : 'основной')

function Proxies() {
  const [proxies, setProxies] = useState<ProxyItem[]>([])
  const [cap, setCap] = useState(3)
  const [capInput, setCapInput] = useState('3')
  const [addVal, setAddVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [pendingDel, setPendingDel] = useState<ProxyItem | null>(null)
  const [addOpen, setAddOpen] = useState(false)   // блок «Добавить в пул» — свёрнут
  const [capOpen, setCapOpen] = useState(false)   // настройка «аккаунтов на прокси» — свёрнута

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
    setProxies((prev) => prev.filter((x) => x.id !== p.id)); setMsg('Прокси удалён')
  }

  const usageColor = (n: number) => (n >= cap ? 'text-bad' : n >= Math.ceil(cap * 0.7) ? 'text-warn' : 'text-ok')

  // Список привязанных аккаунтов с ролью и статусом
  const accountList = (accs: AccRef[]) => (
    accs.length === 0
      ? <span className="text-[11px] text-subt">аккаунтов нет</span>
      : (
        <div className="flex flex-wrap gap-1.5">
          {accs.map((a) => (
            <span key={a.username} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-lg bg-canvas border border-line/50">
              <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[a.status] ?? 'bg-subt')} />
              @{a.username}
              <span className={cn('font-medium', a.role === 'HELPER' ? 'text-[#6a7df9]' : 'text-brand')}>· {roleLabel(a.role)}</span>
            </span>
          ))}
        </div>
      )
  )

  const proxyRow = (p: ProxyItem, showCap: boolean) => (
    <div key={p.id} className="card p-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0"><Globe className="w-4 h-4 text-brand" /></div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[13px] truncate">{p.url}</div>
          <div className="text-[11px] text-subt mt-0.5 flex items-center gap-1">
            <Users className="w-3 h-3" />
            привязано: <span className={cn('font-semibold tabular-nums', showCap ? usageColor(p.accountCount) : 'text-ink')}>{p.accountCount}{showCap ? `/${cap}` : ''}</span>
          </div>
        </div>
        <button onClick={() => setPendingDel(p)} className="text-subt hover:text-bad p-2 shrink-0" title="Удалить прокси"><Trash2 className="w-4 h-4" /></button>
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-line/40">{accountList(p.accounts)}</div>
    </div>
  )

  return (
    <div className="space-y-5" data-tour="page">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tighter leading-none">Прокси</h1>
          <p className="text-subt mt-1.5 text-[14px]">Пуловые (общие, авто-привязка) и уникальные (для одного аккаунта)</p>
        </div>
        <button onClick={load} className="p-2 text-subt hover:text-ink transition-colors" title="Обновить">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Сводка */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Layers, label: 'Пуловые', value: pool.length, color: '#663af1' },
          { icon: Link2, label: 'Уникальные', value: individual.length, color: '#6a7df9' },
          { icon: Globe, label: 'Свободно в пуле', value: poolFree, color: '#34c759' },
        ].map((s) => (
          <div key={s.label} className="card px-4 py-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${s.color}1a` }}>
              <s.icon className="w-4 h-4" style={{ color: s.color }} />
            </div>
            <div>
              <div className="text-[20px] font-semibold tracking-tighter leading-none tabular-nums">{s.value}</div>
              <div className="text-[11.5px] text-subt mt-0.5">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Подробное описание */}
      <div className="card p-4 flex gap-3 text-[13px] text-subt leading-relaxed">
        <Info className="w-4 h-4 text-brand shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div><span className="text-ink font-medium">Пуловый прокси</span> — общий: при добавлении аккаунта в режиме «Авто» бот сам берёт из пула свободный (у которого меньше аккаунтов, чем задано). Один прокси может обслуживать несколько аккаунтов.</div>
          <div><span className="text-ink font-medium">Уникальный прокси</span> — вводится вручную при добавлении аккаунта и закреплён только за ним.</div>
          <div>У каждого прокси показаны привязанные аккаунты: <span className="text-ok font-medium">●</span> статус и роль — <span className="text-brand font-medium">основной</span> (шлёт действия) или <span className="text-[#6a7df9] font-medium">черновой</span> (парсит).</div>
        </div>
      </div>

      {msg && <div className="text-[13px] text-subt bg-canvas rounded-2xl px-4 py-3">{msg}</div>}

      {/* Добавление пуловых прокси — свёрнутый блок с «+» (как «Создать кампанию») */}
      <div className="card overflow-hidden">
        <button onClick={() => setAddOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-black/[0.02] transition-colors">
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center shrink-0"><Plus className="w-4 h-4 text-brand" /></div>
            <div>
              <span className="font-semibold text-[15px] block">Добавить прокси в пул</span>
              <span className="text-[12px] text-subt">Общие прокси для авто-привязки к аккаунтам</span>
            </div>
          </div>
          <span className="flex items-center gap-2 shrink-0">
            {!addOpen && <span className="hidden sm:inline text-[12px] font-medium text-brand">Нажмите, чтобы добавить</span>}
            {addOpen ? <ChevronUp className="w-4 h-4 text-subt" /> : <ChevronDown className="w-4 h-4 text-brand" />}
          </span>
        </button>
        {addOpen && (
          <div className="border-t border-black/[0.05] p-5">
            <div className="text-[12px] text-subt mb-3">По одному на строку. Форматы: <code className="font-mono">user:pass@host:port</code> или <code className="font-mono">http://user:pass@host:port</code>.</div>
            <textarea value={addVal} onChange={(e) => setAddVal(e.target.value)} rows={3}
              className="field font-mono text-[12px] resize-none leading-relaxed" placeholder={'user:pass@host:port\nuser2:pass2@host2:port2'} />
            <div className="flex justify-end mt-3">
              <Button onClick={addProxy} disabled={!addVal.trim()}><Plus className="w-4 h-4" /> Добавить в пул</Button>
            </div>
          </div>
        )}
      </div>

      {/* Таблица 1 — Пуловые */}
      <div>
        <div className="flex items-center gap-2 px-1 mb-2">
          <span className="font-semibold text-[15px]">Пуловые</span>
          <span className="text-[12px] text-subt">({pool.length})</span>
        </div>
        {pool.length === 0 ? (
          <div className="card p-10 text-center text-[13px] text-subt">Пул пуст. Добавьте прокси через блок выше — тогда при создании аккаунта появится режим «Авто».</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">{pool.map((p) => proxyRow(p, true))}</div>
        )}
      </div>

      {/* Таблица 2 — Уникальные */}
      <div>
        <div className="flex items-center gap-2 px-1 mb-2">
          <span className="font-semibold text-[15px]">Уникальные</span>
          <span className="text-[12px] text-subt">({individual.length})</span>
        </div>
        {individual.length === 0 ? (
          <div className="card p-10 text-center text-[13px] text-subt">Уникальных прокси нет. Они появляются, когда при добавлении аккаунта выбирают «Уникальный» и вводят прокси вручную.</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">{individual.map((p) => proxyRow(p, false))}</div>
        )}
      </div>

      {/* Настройка «аккаунтов на прокси» — компактная, свёрнутая, внизу (дублирует «Настройки») */}
      <div className="card overflow-hidden">
        <button onClick={() => setCapOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/[0.02] transition-colors">
          <div className="flex items-center gap-2.5 text-left">
            <Sliders className="w-4 h-4 text-subt shrink-0" />
            <div>
              <span className="font-medium text-[13.5px] block">Аккаунтов на один пуловый прокси: <b className="text-ink tabular-nums">{cap}</b></span>
              <span className="text-[11.5px] text-subt">Дублирует настройку из «Настроек»</span>
            </div>
          </div>
          {capOpen ? <ChevronUp className="w-4 h-4 text-subt shrink-0" /> : <ChevronDown className="w-4 h-4 text-subt shrink-0" />}
        </button>
        {capOpen && (
          <div className="border-t border-black/[0.05] px-4 py-3.5">
            <div className="text-[12px] text-subt mb-3">Сколько аккаунтов авто-режим повесит на один прокси, прежде чем взять следующий.</div>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={100} value={capInput} onChange={(e) => setCapInput(e.target.value)} className="field w-24 py-2 text-[14px] text-center" />
              <Button variant="secondary" onClick={saveCap}>Сохранить</Button>
              <span className="text-[12px] text-subt ml-2">Свободных в пуле: <span className="font-semibold text-ink tabular-nums">{poolFree}</span></span>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDel)}
        title="Удалить прокси?"
        message={`${pendingDel?.url ?? ''} будет удалён. Привязанные аккаунты останутся, но без этого прокси — переназначьте им прокси при необходимости.`}
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

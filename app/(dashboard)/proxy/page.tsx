'use client'

import { useState, useEffect, useCallback } from 'react'
import { Globe, Plus, Trash2, RefreshCw, Info, Users, ChevronDown, ChevronUp, Sliders, Layers, Link2, X, UserPlus, Link as LinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ClientOnly from '@/components/common/ClientOnly'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Hint } from '@/components/common/Hint'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { IconTile } from '@/components/common/IconTile'
import { AddAccountModal } from '@/components/accounts/AddAccountModal'
import { TONE } from '@/lib/colors'
import { cn } from '@/lib/utils'

interface AccRef { id: string; username: string; role: string; status: string }
interface ProxyItem { id: string; url: string; kind: string; label: string | null; accountCount: number; accounts: AccRef[] }
interface MainAccount { id: string; username: string; role: string; status: string; proxyId: string | null }

const STATUS_DOT: Record<string, string> = { ACTIVE: 'bg-ok', PAUSED: 'bg-warn', BLOCKED: 'bg-bad', CHALLENGE: 'bg-bad' }
const roleLabel = (r: string) => (r === 'HELPER' ? 'черновой' : 'основной')

function Proxies() {
  const [proxies, setProxies] = useState<ProxyItem[]>([])
  const [accounts, setAccounts] = useState<MainAccount[]>([])
  const [cap, setCap] = useState(3)
  const [capInput, setCapInput] = useState('3')
  const [addVal, setAddVal] = useState('')
  const [addKind, setAddKind] = useState<'pool' | 'individual'>('pool')  // что добавляем: в пул или приватные
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [pendingDel, setPendingDel] = useState<ProxyItem | null>(null)
  const [addOpen, setAddOpen] = useState(false)   // блок «Добавить прокси» — свёрнут
  const [capOpen, setCapOpen] = useState(false)   // настройка «аккаунтов на прокси» — свёрнута
  const [attachFor, setAttachFor] = useState<string | null>(null)  // id прокси, у которого открыт выбор аккаунта
  const [attachSel, setAttachSel] = useState('')                    // выбранный в пикере аккаунт
  const [newAcctProxy, setNewAcctProxy] = useState<string | null>(null)  // presetProxy для модалки нового аккаунта

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pr, ac] = await Promise.all([fetch('/api/proxies'), fetch('/api/accounts')])
      if (pr.ok) {
        const d = await pr.json()
        setProxies(d.proxies ?? [])
        setCap(d.accountsPerProxy ?? 3)
        setCapInput(String(d.accountsPerProxy ?? 3))
      }
      if (ac.ok) {
        const all = await ac.json()
        setAccounts((all as MainAccount[]).filter((a) => a.role !== 'HELPER'))
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
    const r = await fetch('/api/proxies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: addVal, kind: addKind }) }).catch(() => null)
    if (r && r.ok) { setAddVal(''); setMsg(addKind === 'pool' ? 'Прокси добавлены в пул' : 'Приватные прокси добавлены — привяжите к ним аккаунт'); load() }
    else { const d = r ? await r.json().catch(() => ({})) : {}; setMsg(d.error ?? 'Ошибка добавления') }
  }
  const doDelete = async () => {
    const p = pendingDel; setPendingDel(null); if (!p) return
    await fetch(`/api/proxies/${p.id}`, { method: 'DELETE' }).catch(() => null)
    setProxies((prev) => prev.filter((x) => x.id !== p.id)); setMsg('Прокси удалён')
  }

  // Привязать/отвязать аккаунт к приватному прокси
  const attach = async (proxyId: string, accountId: string) => {
    const r = await fetch(`/api/proxies/${proxyId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'attach', accountId }) }).catch(() => null)
    if (r && r.ok) { setMsg('Аккаунт привязан к прокси'); setAttachFor(null); setAttachSel(''); load() }
    else { const d = r ? await r.json().catch(() => ({})) : {}; setMsg(d.error ?? 'Не удалось привязать') }
  }
  const detach = async (proxyId: string, accountId: string) => {
    const r = await fetch(`/api/proxies/${proxyId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'detach', accountId }) }).catch(() => null)
    if (r && r.ok) { setMsg('Аккаунт отвязан'); load() }
    else setMsg('Не удалось отвязать')
  }

  const usageColor = (n: number) => (n >= cap ? 'text-bad' : n >= Math.ceil(cap * 0.7) ? 'text-warn' : 'text-ok')

  // Чипы привязанных аккаунтов (в приватных — с кнопкой «отвязать»)
  const accountList = (accs: AccRef[], proxyId?: string) => (
    accs.length === 0
      ? <span className="text-[11px] text-subt">аккаунтов нет</span>
      : (
        <div className="flex flex-wrap gap-1.5">
          {accs.map((a) => (
            <span key={a.username} className="group inline-flex items-center gap-1.5 text-[11px] pl-2 pr-1.5 py-0.5 rounded-lg bg-canvas border border-line/50">
              <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_DOT[a.status] ?? 'bg-subt')} />
              @{a.username}
              <span className={cn('font-medium', a.role === 'HELPER' ? 'text-[#6a7df9]' : 'text-brand')}>· {roleLabel(a.role)}</span>
              {proxyId && (
                <button onClick={() => detach(proxyId, a.id)} title="Отвязать от прокси"
                  className="opacity-40 group-hover:opacity-100 hover:text-bad transition-all rounded p-0.5">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )
  )

  // Аккаунты, которых можно привязать к этому прокси (все основные, не привязанные к нему)
  const attachable = (p: ProxyItem) => accounts.filter((a) => a.proxyId !== p.id)

  // Пуловый прокси — без управления аккаунтами (авто)
  const poolRow = (p: ProxyItem) => (
    <div key={p.id} className="card card-3d gloss p-4">
      <div className="flex items-center gap-3">
        <IconTile icon={Globe} color={TONE.brand} size={36} />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[13px] truncate">{p.url}</div>
          <div className="text-[11px] text-subt mt-0.5 flex items-center gap-1">
            <Users className="w-3 h-3" />
            привязано: <span className={cn('font-semibold tabular-nums', usageColor(p.accountCount))}>{p.accountCount}/{cap}</span>
            <Hint text="Сколько аккаунтов уже на этом прокси / лимит из настройки «Аккаунтов на один пуловый прокси». Зелёный — есть место, жёлтый — почти заполнен, красный — лимит достигнут, новые аккаунты пойдут на другой прокси." />
          </div>
        </div>
        <button onClick={() => setPendingDel(p)} className="text-subt hover:text-bad p-2 shrink-0" title="Удалить прокси"><Trash2 className="w-4 h-4" /></button>
      </div>
      <div className="mt-2.5 pt-2.5 border-t border-line/40">{accountList(p.accounts)}</div>
    </div>
  )

  // Приватный прокси — с ручной привязкой аккаунтов
  const individualRow = (p: ProxyItem) => {
    const cands = attachable(p)
    const picking = attachFor === p.id
    return (
      <div key={p.id} className="card card-3d gloss p-4">
        <div className="flex items-center gap-3">
          <IconTile icon={LinkIcon} color={TONE.alt} size={36} />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[13px] truncate">{p.url}</div>
            <div className="text-[11px] text-subt mt-0.5 flex items-center gap-1">
              <Users className="w-3 h-3" /> привязано: <span className="font-semibold tabular-nums text-ink">{p.accountCount}</span>
            </div>
          </div>
          <button onClick={() => setPendingDel(p)} className="text-subt hover:text-bad p-2 shrink-0" title="Удалить прокси"><Trash2 className="w-4 h-4" /></button>
        </div>

        <div className="mt-2.5 pt-2.5 border-t border-line/40">{accountList(p.accounts, p.id)}</div>

        {/* Привязка аккаунта */}
        <div className="mt-3">
          {picking ? (
            <div className="flex items-center gap-2">
              <select autoFocus value={attachSel} onChange={(e) => setAttachSel(e.target.value)} className="field flex-1 text-[13px] py-2">
                <option value="">— выберите аккаунт —</option>
                {cands.map((a) => (
                  <option key={a.id} value={a.id}>@{a.username}{a.proxyId ? ' (сменит прокси)' : ''}</option>
                ))}
              </select>
              <Button size="sm" onClick={() => attachSel && attach(p.id, attachSel)} disabled={!attachSel}>Привязать</Button>
              <button onClick={() => { setAttachFor(null); setAttachSel('') }} className="p-2 text-subt hover:text-ink"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setAttachFor(p.id); setAttachSel('') }} disabled={cands.length === 0}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand hover:bg-brand/[0.06] disabled:opacity-40 disabled:hover:bg-transparent px-2.5 py-1.5 rounded-xl border border-dashed border-brand/40 transition-colors">
                <LinkIcon className="w-3.5 h-3.5" /> Привязать аккаунт
              </button>
              <button onClick={() => setNewAcctProxy(p.url)}
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-subt hover:text-brand hover:bg-brand/[0.06] px-2.5 py-1.5 rounded-xl border border-dashed border-line hover:border-brand/40 transition-colors">
                <UserPlus className="w-3.5 h-3.5" /> Новый аккаунт
              </button>
            </div>
          )}
          {picking && cands.length === 0 && (
            <p className="text-[11px] text-subt mt-1.5">Нет доступных аккаунтов. Добавьте новый через «Новый аккаунт».</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={Globe} color={TONE.brand} title="Прокси" subtitle="Пуловые (общие, авто-привязка) и приватные (для одного аккаунта)" tourId="page">
        <button onClick={load} className="p-2 text-subt hover:text-ink transition-colors" title="Обновить">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </PageHeader>

      {/* Сводка */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Layers, label: 'Пуловые', value: pool.length, color: TONE.brand, tip: 'Общие прокси — бот сам раздаёт их аккаунтам в режиме «Авто», по несколько аккаунтов на один.' },
          { icon: Link2, label: 'Приватные', value: individual.length, color: TONE.alt, tip: 'Прокси, закреплённые вручную за одним конкретным аккаунтом.' },
          { icon: Globe, label: 'Свободно в пуле', value: poolFree, color: TONE.ok, tip: 'Сколько пуловых прокси ещё не достигли лимита «Аккаунтов на один прокси» и могут принять новый аккаунт в режиме «Авто».' },
        ].map((s, i) => (
          <StatCard key={s.label} icon={s.icon} color={s.color} value={s.value} label={s.label} tip={s.tip} delay={i * 60} />
        ))}
      </div>

      {/* Подробное описание */}
      <div className="card card-3d gloss p-4 flex gap-3 text-[13px] text-subt leading-relaxed">
        <Info className="w-4 h-4 text-brand shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div><span className="text-ink font-medium">Пуловый прокси</span> — общий: при добавлении аккаунта в режиме «Авто» бот сам берёт из пула свободный (у которого меньше аккаунтов, чем задано). Один прокси может обслуживать несколько аккаунтов.</div>
          <div><span className="text-ink font-medium">Приватный прокси</span> — закреплён за конкретным аккаунтом. Добавьте его здесь и нажмите <span className="text-brand font-medium">«Привязать аккаунт»</span> (или «Новый аккаунт», чтобы сразу подключить аккаунт на этот прокси).</div>
          <div>У каждого прокси показаны привязанные аккаунты: <span className="text-ok font-medium">●</span> статус и роль — <span className="text-brand font-medium">основной</span> (шлёт действия) или <span className="text-[#6a7df9] font-medium">черновой</span> (парсит).</div>
        </div>
      </div>

      {msg && <div className="text-[13px] text-subt bg-canvas rounded-2xl px-4 py-3">{msg}</div>}

      {/* Добавление прокси — свёрнутый блок с «+» (в пул или приватные) */}
      <div className="card overflow-hidden">
        <button onClick={() => setAddOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-black/[0.02] transition-colors">
          <div className="flex items-center gap-3 text-left">
            <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center shrink-0"><Plus className="w-4 h-4 text-brand" /></div>
            <div>
              <span className="font-semibold text-[15px] block">Добавить прокси</span>
              <span className="text-[12px] text-subt">В общий пул или приватный — для одного аккаунта</span>
            </div>
          </div>
          <span className="flex items-center gap-2 shrink-0">
            {!addOpen && <span className="hidden sm:inline text-[12px] font-medium text-brand">Нажмите, чтобы добавить</span>}
            {addOpen ? <ChevronUp className="w-4 h-4 text-subt" /> : <ChevronDown className="w-4 h-4 text-brand" />}
          </span>
        </button>
        {addOpen && (
          <div className="border-t border-black/[0.05] p-5">
            {/* Выбор типа: пул / приватный */}
            <div className="flex gap-1 p-1 bg-canvas rounded-2xl mb-3 max-w-sm">
              {([['pool', 'В пул (общие)'], ['individual', 'Приватные']] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setAddKind(k)}
                  className={cn('flex-1 py-2 text-[12.5px] font-medium rounded-xl transition-all', addKind === k ? 'bg-card shadow text-ink' : 'text-subt hover:text-ink')}>
                  {lbl}
                </button>
              ))}
            </div>
            <div className="text-[12px] text-subt mb-3">
              {addKind === 'pool'
                ? <>Пуловые: бот сам раздаёт их аккаунтам в режиме «Авто». По одному на строку. Форматы: <code className="font-mono">user:pass@host:port</code> или <code className="font-mono">http://user:pass@host:port</code>.</>
                : <>Приватные: добавятся в список ниже — потом привяжете к ним аккаунт. По одному на строку.</>}
            </div>
            <textarea value={addVal} onChange={(e) => setAddVal(e.target.value)} rows={3}
              className="field font-mono text-[12px] resize-none leading-relaxed" placeholder={'user:pass@host:port\nuser2:pass2@host2:port2'} />
            <div className="flex justify-end mt-3">
              <Button onClick={addProxy} disabled={!addVal.trim()}><Plus className="w-4 h-4" /> {addKind === 'pool' ? 'Добавить в пул' : 'Добавить приватные'}</Button>
            </div>
          </div>
        )}
      </div>

      {/* Пуловые и Приватные — две колонки бок о бок */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Колонка 1 — Пуловые */}
        <div>
          <div className="flex items-center gap-2 px-1 mb-2">
            <span className="font-semibold text-[15px]">Пуловые</span>
            <span className="text-[12px] text-subt">({pool.length})</span>
          </div>
          {pool.length === 0 ? (
            <div className="card p-10 text-center text-[13px] text-subt">Пул пуст. Добавьте прокси через блок выше («В пул») — тогда при создании аккаунта появится режим «Авто».</div>
          ) : (
            <div className="space-y-3">{pool.map((p) => poolRow(p))}</div>
          )}
        </div>

        {/* Колонка 2 — Приватные */}
        <div>
          <div className="flex items-center gap-2 px-1 mb-2">
            <span className="font-semibold text-[15px]">Приватные</span>
            <span className="text-[12px] text-subt">({individual.length})</span>
          </div>
          {individual.length === 0 ? (
            <div className="card p-10 text-center text-[13px] text-subt">Приватных прокси нет. Добавьте их через блок выше («Приватные») и привяжите аккаунт — или они появятся, когда при подключении аккаунта выберут «Уникальный».</div>
          ) : (
            <div className="space-y-3">{individual.map((p) => individualRow(p))}</div>
          )}
        </div>
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

      {newAcctProxy && (
        <AddAccountModal presetProxy={newAcctProxy}
          onClose={() => setNewAcctProxy(null)}
          onAdded={() => { setNewAcctProxy(null); load() }} />
      )}
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Proxies /></ClientOnly>
}

'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Search, Check, Trash2, Users, Zap, Send, Filter,
  AlertCircle, Heart, MessageCircle, UserPlus, Clapperboard, CheckCircle2, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TriggerType, Condition, ConditionType,
  TRIGGER_LABELS, TRIGGER_DESC, CONDITION_LABELS,
} from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { cn } from '@/lib/utils'

const TRIGGER_ICONS: Record<TriggerType, any> = {
  FOLLOW: UserPlus,
  COMMENT: MessageCircle,
  LIKE: Heart,
  STORY_REPLY: Clapperboard,
}

const DB_TYPE_LABELS: Record<string, string> = {
  NEW_FOLLOWER: 'Новая подписка',
  NEW_COMMENT: 'Комментарий',
  NEW_LIKE: 'Лайк',
  STORY_MENTION: 'Ответ на сторис',
}

interface DbAccount {
  id: string
  username: string
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE'
}

interface DbTrigger {
  id: string
  name: string
  triggerType: string
  isActive: boolean
  fireCount: number
  actions: any[]
  createdAt: string
  responder: { id: string; username: string }
}

function StatChip({ icon: Icon, value, label, tone }: { icon: any; value: string | number; label: string; tone: string }) {
  return (
    <div className="card px-5 py-4 flex items-center gap-3.5">
      <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center shrink-0', tone)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[22px] font-semibold tracking-tighter leading-none">{value}</div>
        <div className="text-[12px] text-subt mt-1 truncate">{label}</div>
      </div>
    </div>
  )
}

function TriggersScreen() {
  const [dbAccounts, setDbAccounts] = useState<DbAccount[]>([])
  const [dbTriggers, setDbTriggers] = useState<DbTrigger[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [loadingTriggers, setLoadingTriggers] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [type, setType] = useState<TriggerType>('FOLLOW')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('Привет, @{{username}}! Вижу, ты заинтересован в наших мероприятиях. Скажи, чем могу помочь? 🙌')
  const [conditions, setConditions] = useState<Condition[]>([])
  const [delayMin, setDelayMin] = useState(45)
  const [delayMax, setDelayMax] = useState(180)

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const res = await fetch('/api/accounts')
      if (res.ok) setDbAccounts(await res.json())
    } catch {}
    setLoadingAccounts(false)
  }, [])

  const loadTriggers = useCallback(async () => {
    setLoadingTriggers(true)
    try {
      const res = await fetch('/api/triggers')
      if (res.ok) setDbTriggers(await res.json())
    } catch {}
    setLoadingTriggers(false)
  }, [])

  useEffect(() => { loadAccounts(); loadTriggers() }, [loadAccounts, loadTriggers])

  const filtered = useMemo(
    () => dbAccounts.filter((a) => a.username.toLowerCase().includes(search.toLowerCase())),
    [dbAccounts, search]
  )
  const allSelected = filtered.length > 0 && filtered.every((a) => selected.includes(a.id))
  const toggleAll = () => setSelected(allSelected ? [] : filtered.map((a) => a.id))
  const toggleOne = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const canSave = selected.length > 0 && name.trim()
  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setSaveMsg('')
    try {
      const res = await fetch('/api/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), accountIds: selected, type, conditions, message, delayMin, delayMax }),
      })
      const data = await res.json()
      if (res.ok) {
        setSaveMsg(`Создано ${data.count} триггер(а)`)
        setSelected([])
        setName('')
        loadTriggers()
      } else {
        setSaveMsg(data.error ?? 'Ошибка')
      }
    } catch {
      setSaveMsg('Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  const deleteTrigger = async (id: string) => {
    await fetch(`/api/triggers/${id}`, { method: 'DELETE' })
    setDbTriggers((prev) => prev.filter((t) => t.id !== id))
  }

  const toggleTrigger = async (id: string, isActive: boolean) => {
    await fetch(`/api/triggers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    setDbTriggers((prev) => prev.map((t) => (t.id === id ? { ...t, isActive: !isActive } : t)))
  }

  const activeAccounts = dbAccounts.filter((a) => a.status === 'ACTIVE').length
  const activeTriggers = dbTriggers.filter((t) => t.isActive).length
  const totalRuns = dbTriggers.reduce((s, t) => s + (t.fireCount ?? 0), 0)

  return (
    <div className="space-y-5 pb-24">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatChip icon={Users} value={activeAccounts} label="Аккаунтов активно" tone="bg-brand/10 text-brand" />
        <StatChip icon={Zap} value={activeTriggers} label="Триггеров запущено" tone="bg-[#5e5ce6]/10 text-[#5e5ce6]" />
        <StatChip icon={CheckCircle2} value={totalRuns.toLocaleString('ru')} label="Ответов отправлено" tone="bg-ok/10 text-ok" />
        <StatChip icon={AlertCircle} value={dbTriggers.length} label="Всего триггеров" tone="bg-warn/10 text-warn" />
      </div>

      {/* 3-step flow */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Step 1 — accounts */}
        <div className="card flex flex-col overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-brand text-white text-[12px] font-bold flex items-center justify-center">1</span>
                <span className="font-semibold text-[15px]">Аккаунты</span>
              </div>
              <button onClick={toggleAll} className="text-[13px] font-medium text-brand hover:underline">
                {allSelected ? 'Снять' : 'Все'}
              </button>
            </div>
            <div className="text-[12px] text-subt mt-1">{selected.length} из {dbAccounts.length} выбрано</div>
            <div className="relative mt-3">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск…"
                className="field pl-10 py-2.5 text-[14px]" />
            </div>
          </div>
          <div className="px-3 pb-3 space-y-1 overflow-y-auto max-h-[380px]">
            {loadingAccounts ? (
              <div className="py-10 text-center text-subt text-[13px]">Загрузка…</div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-subt text-[13px]">
                {dbAccounts.length === 0 ? (
                  <>Нет аккаунтов. Добавьте их во вкладке <a href="/accounts" className="text-brand font-medium hover:underline">«Аккаунты»</a></>
                ) : 'Ничего не найдено'}
              </div>
            ) : filtered.map((a) => {
              const on = selected.includes(a.id)
              return (
                <button key={a.id} onClick={() => toggleOne(a.id)}
                  className={cn('w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition-all',
                    on ? 'bg-brand/5' : 'hover:bg-black/[0.03]')}>
                  <span className={cn('w-5 h-5 rounded-md border flex items-center justify-center shrink-0',
                    on ? 'bg-brand border-brand' : 'border-line')}>
                    {on && <Check className="w-3.5 h-3.5 text-white" />}
                  </span>
                  <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold shrink-0">
                    {a.username[0].toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-[14px] truncate">@{a.username}</span>
                    <span className="block text-[12px] text-subt">{a.status === 'ACTIVE' ? 'Активен' : 'Пауза'}</span>
                  </span>
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', a.status === 'ACTIVE' ? 'bg-ok' : 'bg-warn')} />
                </button>
              )
            })}
          </div>
        </div>

        {/* Step 2 — trigger type */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-brand text-white text-[12px] font-bold flex items-center justify-center">2</span>
            <span className="font-semibold text-[15px]">Тип триггера</span>
          </div>
          <div className="text-[12px] text-subt mb-4">На какое событие реагировать</div>
          <div className="space-y-2.5">
            {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => {
              const Icon = TRIGGER_ICONS[t]
              const on = type === t
              return (
                <button key={t} onClick={() => setType(t)}
                  className={cn('w-full flex items-center gap-3 p-3.5 rounded-2xl border text-left transition-all',
                    on ? 'border-brand bg-brand/5 ring-4 ring-brand/10' : 'border-line/60 hover:border-line')}>
                  <span className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    on ? 'bg-brand text-white' : 'bg-black/[0.04] text-subt')}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium text-[14px]">
                      {TRIGGER_LABELS[t]}
                      {t === 'FOLLOW' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-brand/10 text-brand">ОСНОВНОЙ</span>}
                    </span>
                    <span className="block text-[12px] text-subt mt-0.5">{TRIGGER_DESC[t]}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Step 3 — settings */}
        <div className="card p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-brand text-white text-[12px] font-bold flex items-center justify-center">3</span>
            <span className="font-semibold text-[15px]">Настройка триггера</span>
          </div>
          <div className="text-[12px] text-subt mb-4">Ответ в директ и параметры</div>

          <div className="space-y-4 flex-1">
            <input value={name} onChange={(e) => setName(e.target.value)} className="field py-2.5 text-[14px]"
              placeholder="Название триггера" />

            <div>
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-subt mb-2"><Send className="w-3.5 h-3.5" /> Текст ответа</div>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                className="field h-24 resize-none text-[14px] leading-relaxed" placeholder="Используйте {{username}}" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-subt"><Filter className="w-3.5 h-3.5" /> Условия</div>
                <button onClick={() => setConditions([...conditions, { type: 'KEYWORDS', value: '' }])}
                  className="text-[12px] font-medium text-brand hover:underline">+ добавить</button>
              </div>
              {conditions.length === 0 ? (
                <div className="text-[12px] text-subt">Без условий — срабатывает всегда</div>
              ) : (
                <div className="space-y-2">
                  {conditions.map((c, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <select value={c.type}
                        onChange={(e) => setConditions(conditions.map((x, idx) => idx === i ? { ...x, type: e.target.value as ConditionType } : x))}
                        className="field py-2 text-[12px] w-36 shrink-0 cursor-pointer">
                        {(Object.keys(CONDITION_LABELS) as ConditionType[]).map((ct) => <option key={ct} value={ct}>{CONDITION_LABELS[ct]}</option>)}
                      </select>
                      <input value={c.value}
                        onChange={(e) => setConditions(conditions.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))}
                        className="field py-2 text-[12px] flex-1" placeholder="значение…" />
                      <button onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))} className="text-subt hover:text-bad p-1"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[12px] font-medium text-subt mb-1.5">Задержка от (сек)</div>
                <input type="number" value={delayMin} onChange={(e) => setDelayMin(+e.target.value)} className="field py-2 text-[14px]" />
              </div>
              <div>
                <div className="text-[12px] font-medium text-subt mb-1.5">до (сек)</div>
                <input type="number" value={delayMax} onChange={(e) => setDelayMax(+e.target.value)} className="field py-2 text-[14px]" />
              </div>
            </div>
          </div>

          {saveMsg && <div className="text-[13px] text-center mt-3 text-ok">{saveMsg}</div>}

          <Button className="w-full mt-5" onClick={save} disabled={!canSave || saving}>
            <Zap className="w-4 h-4" fill="white" />
            {saving ? 'Сохранение…' : selected.length > 0 ? `Запустить на ${selected.length} акк.` : 'Выберите аккаунты'}
          </Button>
        </div>
      </div>

      {/* Saved triggers list */}
      {(loadingTriggers || dbTriggers.length > 0) && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.05]">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-brand" />
              <span className="font-semibold text-[15px]">Активные триггеры</span>
              <span className="text-[12px] text-subt">({dbTriggers.length})</span>
            </div>
            <button onClick={loadTriggers} className="p-1 text-subt hover:text-ink">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {loadingTriggers ? (
            <div className="py-8 text-center text-subt text-[13px]">Загрузка…</div>
          ) : (
            <div className="divide-y divide-black/[0.04]">
              {dbTriggers.map((t) => {
                const msgAction = t.actions?.find((a: any) => a.type === 'SEND_MESSAGE')
                const msgText: string = msgAction?.templates?.[0] ?? ''
                return (
                  <div key={t.id} className={cn('flex items-center gap-4 px-5 py-3.5', !t.isActive && 'opacity-60')}>
                    <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold shrink-0 text-[15px]">
                      {t.responder.username[0].toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-[14px] truncate">{t.name}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium shrink-0">
                          {DB_TYPE_LABELS[t.triggerType] ?? t.triggerType}
                        </span>
                        <span className="text-[11px] text-subt shrink-0">@{t.responder.username}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[12px] text-subt">
                        <span className="text-ok font-medium">{t.fireCount ?? 0} срабатываний</span>
                        {msgText && <span className="truncate max-w-[200px]">{msgText}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleTrigger(t.id, t.isActive)}
                        className={cn('text-[12px] font-medium px-3 py-1.5 rounded-xl transition-colors',
                          t.isActive ? 'bg-ok/10 text-ok hover:bg-ok/20' : 'bg-black/[0.05] text-subt hover:bg-black/[0.08]')}>
                        {t.isActive ? 'Вкл' : 'Выкл'}
                      </button>
                      <button onClick={() => deleteTrigger(t.id)} className="p-1.5 text-subt hover:text-bad transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Page() {
  return <ClientOnly><TriggersScreen /></ClientOnly>
}

'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Search, Check, Trash2, Users, Zap, Send, Filter,
  Heart, MessageCircle, UserPlus, Clapperboard, RefreshCw,
  Plus, ChevronDown, ChevronUp, ToggleLeft, ToggleRight,
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

const TYPE_ICONS: Record<string, any> = {
  NEW_FOLLOWER: UserPlus,
  NEW_COMMENT: MessageCircle,
  NEW_LIKE: Heart,
  STORY_MENTION: Clapperboard,
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

// ── Карточка одного триггера ─────────────────────────────────────────────────
function TriggerCard({
  trigger,
  onToggle,
  onDelete,
}: {
  trigger: DbTrigger
  onToggle: () => void
  onDelete: () => void
}) {
  const Icon = TYPE_ICONS[trigger.triggerType] ?? Zap
  const msgAction = trigger.actions?.find((a: any) => a.type === 'SEND_MESSAGE')
  const msgText: string = msgAction?.templates?.[0] ?? ''
  const delayMin: number = msgAction?.delayMin ?? 45
  const delayMax: number = msgAction?.delayMax ?? 180

  return (
    <div className={cn(
      'card p-4 flex flex-col gap-3 transition-all',
      !trigger.isActive && 'opacity-55'
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={cn(
          'w-10 h-10 rounded-2xl flex items-center justify-center shrink-0',
          trigger.isActive ? 'bg-brand/10 text-brand' : 'bg-black/[0.05] text-subt'
        )}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14px] truncate">{trigger.name}</div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium">
              {DB_TYPE_LABELS[trigger.triggerType] ?? trigger.triggerType}
            </span>
            <span className="text-[11px] text-subt">@{trigger.responder.username}</span>
          </div>
        </div>
        {/* Toggle */}
        <button
          onClick={onToggle}
          className={cn(
            'flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-xl shrink-0 transition-colors',
            trigger.isActive
              ? 'bg-ok/10 text-ok hover:bg-ok/20'
              : 'bg-black/[0.05] text-subt hover:bg-black/[0.08]'
          )}
        >
          {trigger.isActive
            ? <><ToggleRight className="w-3.5 h-3.5" /> Вкл</>
            : <><ToggleLeft className="w-3.5 h-3.5" /> Выкл</>}
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-canvas rounded-xl px-3 py-2 text-center">
          <div className="text-[15px] font-semibold text-ok">{trigger.fireCount ?? 0}</div>
          <div className="text-[10px] text-subt mt-0.5">срабатываний</div>
        </div>
        <div className="bg-canvas rounded-xl px-3 py-2 text-center">
          <div className="text-[12px] font-medium text-ink">{delayMin}–{delayMax}с</div>
          <div className="text-[10px] text-subt mt-0.5">задержка DM</div>
        </div>
        <div className="bg-canvas rounded-xl px-3 py-2 text-center">
          <div className="text-[12px] font-medium text-ink truncate">{new Date(trigger.createdAt).toLocaleDateString('ru-RU')}</div>
          <div className="text-[10px] text-subt mt-0.5">создан</div>
        </div>
      </div>

      {/* Message preview */}
      {msgText && (
        <div className="text-[12px] text-subt bg-canvas rounded-xl px-3 py-2 leading-relaxed line-clamp-2">
          {msgText}
        </div>
      )}

      {/* Delete */}
      <div className="flex justify-end pt-1 border-t border-black/[0.04]">
        <button onClick={onDelete} className="flex items-center gap-1.5 text-[12px] text-subt hover:text-bad transition-colors">
          <Trash2 className="w-3.5 h-3.5" /> Удалить
        </button>
      </div>
    </div>
  )
}

// ── Форма создания триггера ───────────────────────────────────────────────────
function CreateForm({
  dbAccounts,
  loadingAccounts,
  onCreated,
}: {
  dbAccounts: DbAccount[]
  loadingAccounts: boolean
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [type, setType] = useState<TriggerType>('FOLLOW')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('Привет, @{{username}}! Вижу, ты заинтересован в наших мероприятиях. Скажи, чем могу помочь? 🙌')
  const [conditions, setConditions] = useState<Condition[]>([])
  const [delayMin, setDelayMin] = useState(45)
  const [delayMax, setDelayMax] = useState(180)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const filtered = useMemo(
    () => dbAccounts.filter((a) => a.username.toLowerCase().includes(search.toLowerCase())),
    [dbAccounts, search]
  )
  const allSelected = filtered.length > 0 && filtered.every((a) => selected.includes(a.id))
  const toggleAll = () => setSelected(allSelected ? [] : filtered.map((a) => a.id))
  const toggleOne = (id: string) =>
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

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
        setOpen(false)
        onCreated()
      } else {
        setSaveMsg(data.error ?? 'Ошибка')
      }
    } catch {
      setSaveMsg('Ошибка сети')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center">
            <Plus className="w-4 h-4 text-brand" />
          </div>
          <span className="font-semibold text-[15px]">Создать триггер</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-subt" /> : <ChevronDown className="w-4 h-4 text-subt" />}
      </button>

      {open && (
        <div className="border-t border-black/[0.05] p-5">
          <div className="grid lg:grid-cols-3 gap-4">
            {/* Step 1 — accounts */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">1</span>
                  Аккаунты
                </span>
                <button onClick={toggleAll} className="text-[12px] text-brand hover:underline">{allSelected ? 'Снять' : 'Все'}</button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-subt" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск…"
                  className="field pl-9 py-2 text-[13px]" />
              </div>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {loadingAccounts ? (
                  <div className="py-6 text-center text-subt text-[12px]">Загрузка…</div>
                ) : filtered.length === 0 ? (
                  <div className="py-6 text-center text-subt text-[12px]">
                    {dbAccounts.length === 0
                      ? <><a href="/accounts" className="text-brand hover:underline">Добавьте аккаунт</a> сначала</>
                      : 'Ничего не найдено'}
                  </div>
                ) : filtered.map((a) => {
                  const on = selected.includes(a.id)
                  return (
                    <button key={a.id} onClick={() => toggleOne(a.id)}
                      className={cn('w-full flex items-center gap-2.5 p-2 rounded-xl text-left transition-all',
                        on ? 'bg-brand/5' : 'hover:bg-black/[0.03]')}>
                      <span className={cn('w-4 h-4 rounded-md border flex items-center justify-center shrink-0',
                        on ? 'bg-brand border-brand' : 'border-line')}>
                        {on && <Check className="w-2.5 h-2.5 text-white" />}
                      </span>
                      <span className="font-medium text-[13px]">@{a.username}</span>
                      <span className={cn('ml-auto w-1.5 h-1.5 rounded-full shrink-0',
                        a.status === 'ACTIVE' ? 'bg-ok' : 'bg-warn')} />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Step 2 — type */}
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">2</span>
                Событие
              </span>
              <div className="space-y-2">
                {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => {
                  const Icon = TRIGGER_ICONS[t]
                  const on = type === t
                  return (
                    <button key={t} onClick={() => setType(t)}
                      className={cn('w-full flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all',
                        on ? 'border-brand bg-brand/5 ring-2 ring-brand/10' : 'border-line/60 hover:border-line')}>
                      <span className={cn('w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
                        on ? 'bg-brand text-white' : 'bg-black/[0.04] text-subt')}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-[13px]">{TRIGGER_LABELS[t]}</span>
                        <span className="block text-[11px] text-subt">{TRIGGER_DESC[t]}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Step 3 — settings */}
            <div className="flex flex-col gap-3">
              <span className="text-[13px] font-semibold flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">3</span>
                Настройка
              </span>

              <input value={name} onChange={(e) => setName(e.target.value)}
                className="field py-2 text-[13px]" placeholder="Название триггера" />

              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-subt mb-1.5"><Send className="w-3 h-3" /> Текст DM</div>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                  className="field h-20 resize-none text-[13px] leading-relaxed" placeholder="Используйте {{username}}" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-subt"><Filter className="w-3 h-3" /> Условия</div>
                  <button onClick={() => setConditions([...conditions, { type: 'KEYWORDS', value: '' }])}
                    className="text-[11px] font-medium text-brand hover:underline">+ добавить</button>
                </div>
                {conditions.length === 0
                  ? <div className="text-[11px] text-subt">Без условий — срабатывает всегда</div>
                  : <div className="space-y-1.5">
                    {conditions.map((c, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <select value={c.type}
                          onChange={(e) => setConditions(conditions.map((x, idx) => idx === i ? { ...x, type: e.target.value as ConditionType } : x))}
                          className="field py-1.5 text-[11px] w-32 shrink-0 cursor-pointer">
                          {(Object.keys(CONDITION_LABELS) as ConditionType[]).map((ct) => <option key={ct} value={ct}>{CONDITION_LABELS[ct]}</option>)}
                        </select>
                        <input value={c.value}
                          onChange={(e) => setConditions(conditions.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))}
                          className="field py-1.5 text-[11px] flex-1" placeholder="значение…" />
                        <button onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))} className="text-subt hover:text-bad p-1"><Trash2 size={13} /></button>
                      </div>
                    ))}
                  </div>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] font-medium text-subt mb-1">Задержка от (сек)</div>
                  <input type="number" value={delayMin} onChange={(e) => setDelayMin(+e.target.value)} className="field py-2 text-[13px]" />
                </div>
                <div>
                  <div className="text-[11px] font-medium text-subt mb-1">до (сек)</div>
                  <input type="number" value={delayMax} onChange={(e) => setDelayMax(+e.target.value)} className="field py-2 text-[13px]" />
                </div>
              </div>

              {saveMsg && <div className="text-[12px] text-center text-ok">{saveMsg}</div>}

              <Button className="w-full mt-1" onClick={save} disabled={!canSave || saving}>
                <Zap className="w-3.5 h-3.5" fill="white" />
                {saving ? 'Сохранение…' : selected.length > 0 ? `Создать для ${selected.length} акк.` : 'Выберите аккаунты'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Главный экран ─────────────────────────────────────────────────────────────
function TriggersScreen() {
  const [dbAccounts, setDbAccounts] = useState<DbAccount[]>([])
  const [dbTriggers, setDbTriggers] = useState<DbTrigger[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [loadingTriggers, setLoadingTriggers] = useState(true)

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
    setDbTriggers((prev) => prev.map((t) => t.id === id ? { ...t, isActive: !isActive } : t))
  }

  const activeTriggers = dbTriggers.filter((t) => t.isActive)
  const inactiveTriggers = dbTriggers.filter((t) => !t.isActive)
  const totalFires = dbTriggers.reduce((s, t) => s + (t.fireCount ?? 0), 0)

  return (
    <div className="space-y-5 pb-24">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5 text-brand" />
          </div>
          <div>
            <div className="text-[22px] font-semibold tracking-tighter leading-none">{activeTriggers.length}</div>
            <div className="text-[12px] text-subt mt-1">Активных</div>
          </div>
        </div>
        <div className="card px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-ok/10 flex items-center justify-center shrink-0">
            <Send className="w-5 h-5 text-ok" />
          </div>
          <div>
            <div className="text-[22px] font-semibold tracking-tighter leading-none">{totalFires.toLocaleString('ru')}</div>
            <div className="text-[12px] text-subt mt-1">DM отправлено</div>
          </div>
        </div>
        <div className="card px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#5e5ce6]/10 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-[#5e5ce6]" />
          </div>
          <div>
            <div className="text-[22px] font-semibold tracking-tighter leading-none">{dbAccounts.filter((a) => a.status === 'ACTIVE').length}</div>
            <div className="text-[12px] text-subt mt-1">Аккаунтов</div>
          </div>
        </div>
      </div>

      {/* Active triggers list — ALWAYS visible */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.05]">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-brand" />
            <span className="font-semibold text-[15px]">Триггеры</span>
            <span className="text-[12px] text-subt">({dbTriggers.length})</span>
          </div>
          <button onClick={loadTriggers} className="p-1 text-subt hover:text-ink transition-colors" title="Обновить">
            <RefreshCw className={cn('w-4 h-4', loadingTriggers && 'animate-spin')} />
          </button>
        </div>

        {loadingTriggers ? (
          <div className="py-12 text-center text-subt text-[13px]">Загрузка…</div>
        ) : dbTriggers.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-3 text-center px-6">
            <div className="w-14 h-14 rounded-3xl bg-brand/8 flex items-center justify-center">
              <Zap className="w-7 h-7 text-brand/50" />
            </div>
            <div className="font-semibold text-[16px] tracking-tight text-ink/70">Триггеров пока нет</div>
            <div className="text-[13px] text-subt max-w-xs">
              Создайте первый триггер ниже — система будет автоматически отправлять DM новым подписчикам
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {/* Active */}
            {activeTriggers.length > 0 && (
              <>
                <div className="text-[11px] font-semibold text-subt uppercase tracking-wider px-1">Активные</div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {activeTriggers.map((t) => (
                    <TriggerCard key={t.id} trigger={t}
                      onToggle={() => toggleTrigger(t.id, t.isActive)}
                      onDelete={() => deleteTrigger(t.id)} />
                  ))}
                </div>
              </>
            )}
            {/* Inactive */}
            {inactiveTriggers.length > 0 && (
              <>
                <div className="text-[11px] font-semibold text-subt uppercase tracking-wider px-1 mt-2">Выключенные</div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {inactiveTriggers.map((t) => (
                    <TriggerCard key={t.id} trigger={t}
                      onToggle={() => toggleTrigger(t.id, t.isActive)}
                      onDelete={() => deleteTrigger(t.id)} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Create trigger — collapsible */}
      <CreateForm
        dbAccounts={dbAccounts}
        loadingAccounts={loadingAccounts}
        onCreated={loadTriggers}
      />
    </div>
  )
}

export default function Page() {
  return <ClientOnly><TriggersScreen /></ClientOnly>
}

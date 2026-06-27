'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  Search, Check, Trash2, Users, Zap, Send, Filter,
  Heart, MessageCircle, UserPlus, Clapperboard, RefreshCw,
  Plus, ChevronDown, ChevronUp, ToggleLeft, ToggleRight,
  Link2, MessageSquare, Bookmark, FileText, X, UserCheck,
  Image as ImageIcon, Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TriggerType, Condition, ConditionType, CONDITION_LABELS,
} from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { cn } from '@/lib/utils'

// ── Метаданные типов триггеров (цвет, иконка, подпись) ────────────────────────
const TRIG_META = [
  { key: 'FOLLOW',      db: 'NEW_FOLLOWER',  label: 'Новая подписка',  desc: 'Основной триггер — ответ новым подписчикам', Icon: UserPlus,      color: '#0071e3' },
  { key: 'COMMENT',     db: 'NEW_COMMENT',   label: 'Комментарий',     desc: 'Реакция на комментарии под постами',         Icon: MessageCircle, color: '#34c759' },
  { key: 'LIKE',        db: 'NEW_LIKE',      label: 'Лайк',            desc: 'Когда кто-то ставит лайк',                   Icon: Heart,         color: '#ff2d92' },
  { key: 'STORY_REPLY', db: 'STORY_MENTION', label: 'Ответ на сторис', desc: 'Когда отвечают на вашу историю',             Icon: Clapperboard,  color: '#ff9f0a' },
] as const

type MetaKey = typeof TRIG_META[number]['key']
const META_BY_KEY = Object.fromEntries(TRIG_META.map((m) => [m.key, m])) as Record<MetaKey, typeof TRIG_META[number]>
const META_BY_DB = Object.fromEntries(TRIG_META.map((m) => [m.db, m])) as Record<string, typeof TRIG_META[number]>

// ── Цветовые помощники для 3D-свечения ───────────────────────────────────────
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
function darken(hex: string, f = 0.8) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

// ── 3D-иконка триггера (горит цветом, если активна; серая, если нет) ──────────
function TrigBadge({
  meta, active, size = 30, title,
}: {
  meta: typeof TRIG_META[number]
  active: boolean
  size?: number
  title?: string
}) {
  const Icon = meta.Icon
  return (
    <span
      title={title ?? `${meta.label}: ${active ? 'вкл' : 'выкл'}`}
      className="rounded-xl flex items-center justify-center transition-all shrink-0"
      style={
        active
          ? {
              width: size, height: size,
              background: `linear-gradient(145deg, ${meta.color} 0%, ${darken(meta.color)} 100%)`,
              boxShadow: `0 3px 9px ${hexA(meta.color, 0.5)}, 0 1px 2px ${hexA(meta.color, 0.45)}, inset 0 1px 1.5px rgba(255,255,255,0.45)`,
              color: '#fff',
            }
          : {
              width: size, height: size,
              background: 'rgba(0,0,0,0.05)',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)',
              color: '#b0b0b5',
            }
      }
    >
      <Icon style={{ width: size * 0.52, height: size * 0.52 }} />
    </span>
  )
}

// ── Типы данных из БД ─────────────────────────────────────────────────────────
interface DbAccount {
  id: string
  username: string
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE'
  errorCount?: number
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

type PlateState = 'green' | 'blue' | 'red' | 'yellow'
function plateState(acc: DbAccount, activeCount: number): PlateState {
  if (acc.status === 'BLOCKED' || acc.status === 'CHALLENGE') return 'red'
  if ((acc.errorCount ?? 0) > 0) return 'yellow'
  if (acc.status === 'ACTIVE' && activeCount > 0) return 'green'
  return 'blue'
}
const PLATE_STYLE: Record<PlateState, string> = {
  green:  'border-ok/40 bg-ok/[0.06]',
  blue:   'border-brand/30 bg-brand/[0.05]',
  red:    'border-bad/40 bg-bad/[0.06]',
  yellow: 'border-warn/45 bg-warn/[0.07]',
}
const PLATE_DOT: Record<PlateState, string> = {
  green: 'bg-ok', blue: 'bg-brand', red: 'bg-bad', yellow: 'bg-warn',
}
const PLATE_LABEL: Record<PlateState, string> = {
  green: 'Активно', blue: 'Готов', red: 'Проблема', yellow: 'Ошибки',
}

// ── Черновик триггера (используется и для шаблонов) ───────────────────────────
interface Draft {
  type: TriggerType
  actDM: boolean; actLike: boolean; actFollow: boolean
  name: string; message: string
  customOn: boolean
  linkOn: boolean; linkText: string; linkUrl: string
  dialogOn: boolean; dialogKeyword: string; dialogReply: string
  image: string
  conditions: Condition[]
  delayMin: number; delayMax: number
}

const DEFAULT_DRAFT: Draft = {
  type: 'FOLLOW',
  actDM: true, actLike: false, actFollow: false,
  name: '',
  message: 'Привет, @{{username}}! Вижу, ты заинтересован в наших мероприятиях. Скажи, чем могу помочь? 🙌',
  customOn: false,
  linkOn: false, linkText: '', linkUrl: '',
  dialogOn: false, dialogKeyword: '', dialogReply: '',
  image: '',
  conditions: [],
  delayMin: 45, delayMax: 180,
}

function buildActions(d: Draft): any[] {
  const actions: any[] = []
  if (d.actDM) {
    actions.push({
      type: 'SEND_MESSAGE',
      enabled: true,
      templates: [d.message],
      delayMin: d.delayMin,
      delayMax: d.delayMax,
      link: d.customOn && d.linkOn ? { enabled: true, text: d.linkText, url: d.linkUrl } : undefined,
      image: d.image ? { enabled: true, url: d.image } : undefined,
      dialogue: d.customOn && d.dialogOn ? { enabled: true, keyword: d.dialogKeyword, reply: d.dialogReply } : undefined,
    })
  }
  if (d.actLike) actions.push({ type: 'LIKE_MEDIA', enabled: true })
  if (d.actFollow) actions.push({ type: 'FOLLOW_BACK', enabled: true })
  return actions
}

// ════════════════════════════════════════════════════════════════════════════
// Карточка существующего триггера в списке
// ════════════════════════════════════════════════════════════════════════════
function TriggerCard({ trigger, onToggle, onDelete }: {
  trigger: DbTrigger; onToggle: () => void; onDelete: () => void
}) {
  const meta = META_BY_DB[trigger.triggerType]
  const actions = trigger.actions ?? []
  const isOn = (a: any) => a && a.enabled !== false
  const msg = actions.find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
  const hasLike = actions.some((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))
  const hasFollow = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
  const msgText: string = msg?.templates?.[0] ?? ''
  const delayMin: number = msg?.delayMin ?? 45
  const delayMax: number = msg?.delayMax ?? 180

  return (
    <div className={cn('card p-4 flex flex-col gap-3 transition-all', !trigger.isActive && 'opacity-55')}>
      <div className="flex items-start gap-3">
        {meta
          ? <TrigBadge meta={meta} active={trigger.isActive} size={40} />
          : <div className="w-10 h-10 rounded-xl bg-black/5 flex items-center justify-center"><Zap className="w-5 h-5 text-subt" /></div>}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14px] truncate">{trigger.name}</div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: hexA(meta?.color ?? '#888', 0.12), color: meta?.color ?? '#888' }}>
              {meta?.label ?? trigger.triggerType}
            </span>
            <span className="text-[11px] text-subt">@{trigger.responder.username}</span>
          </div>
        </div>
        <button onClick={onToggle} className={cn(
          'flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-xl shrink-0 transition-colors',
          trigger.isActive ? 'bg-ok/10 text-ok hover:bg-ok/20' : 'bg-black/[0.05] text-subt hover:bg-black/[0.08]'
        )}>
          {trigger.isActive ? <><ToggleRight className="w-3.5 h-3.5" /> Вкл</> : <><ToggleLeft className="w-3.5 h-3.5" /> Выкл</>}
        </button>
      </div>

      {/* Бейджи действий */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {msg && <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium flex items-center gap-1"><Send className="w-3 h-3" /> DM</span>}
        {msg?.link?.enabled && <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium flex items-center gap-1"><Link2 className="w-3 h-3" /> ссылка</span>}
        {msg?.image?.enabled && <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium flex items-center gap-1"><ImageIcon className="w-3 h-3" /> фото</span>}
        {msg?.dialogue?.enabled && <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#5e5ce6]/10 text-[#5e5ce6] font-medium flex items-center gap-1"><MessageSquare className="w-3 h-3" /> диалог</span>}
        {hasLike && <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#ff2d92]/10 text-[#ff2d92] font-medium flex items-center gap-1"><Heart className="w-3 h-3" /> лайк</span>}
        {hasFollow && <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-ok/10 text-ok font-medium flex items-center gap-1"><UserCheck className="w-3 h-3" /> подписка</span>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-canvas rounded-xl px-3 py-2 text-center">
          <div className="text-[15px] font-semibold text-ok">{trigger.fireCount ?? 0}</div>
          <div className="text-[10px] text-subt mt-0.5">срабатываний</div>
        </div>
        <div className="bg-canvas rounded-xl px-3 py-2 text-center">
          <div className="text-[12px] font-medium text-ink">{delayMin}–{delayMax}с</div>
          <div className="text-[10px] text-subt mt-0.5">задержка</div>
        </div>
      </div>

      {msgText && (
        <div className="text-[12px] text-subt bg-canvas rounded-xl px-3 py-2 leading-relaxed line-clamp-2">{msgText}</div>
      )}

      <div className="flex justify-end pt-1 border-t border-black/[0.04]">
        <button onClick={onDelete} className="flex items-center gap-1.5 text-[12px] text-subt hover:text-bad transition-colors">
          <Trash2 className="w-3.5 h-3.5" /> Удалить
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Чекбокс-строка (для кастомных опций)
// ════════════════════════════════════════════════════════════════════════════
function CheckRow({ on, onChange, icon: Icon, label }: {
  on: boolean; onChange: (v: boolean) => void; icon: any; label: string
}) {
  return (
    <button onClick={() => onChange(!on)} className="w-full flex items-center gap-2.5 py-1.5 text-left">
      <span className={cn('w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors',
        on ? 'bg-brand border-brand' : 'border-line')}>
        {on && <Check className="w-2.5 h-2.5 text-white" />}
      </span>
      <Icon className={cn('w-3.5 h-3.5', on ? 'text-brand' : 'text-subt')} />
      <span className={cn('text-[12.5px]', on ? 'font-medium text-ink' : 'text-subt')}>{label}</span>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Форма создания триггера
// ════════════════════════════════════════════════════════════════════════════
function CreateForm({
  dbAccounts, dbTriggers, loadingAccounts, onCreated, formRef,
}: {
  dbAccounts: DbAccount[]
  dbTriggers: DbTrigger[]
  loadingAccounts: boolean
  onCreated: () => void
  formRef: React.MutableRefObject<{ open: () => void; load: (d: Draft) => void } | null>
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [d, setD] = useState<Draft>(DEFAULT_DRAFT)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null)

  // Шаблоны
  const [tplName, setTplName] = useState('')
  const [tplSaving, setTplSaving] = useState(false)
  const [showTplSave, setShowTplSave] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  // Активные типы триггеров по каждому аккаунту (для 3D-иконок и цвета плашки)
  const activeByAccount = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const t of dbTriggers) {
      if (!t.isActive) continue
      if (!m.has(t.responder.id)) m.set(t.responder.id, new Set())
      m.get(t.responder.id)!.add(t.triggerType)
    }
    return m
  }, [dbTriggers])

  // Внешнее управление формой (из списка шаблонов)
  useEffect(() => {
    formRef.current = {
      open: () => setOpen(true),
      load: (draft: Draft) => { setD(draft); setOpen(true); setSaveMsg(null) },
    }
  }, [formRef])

  const filtered = useMemo(
    () => dbAccounts.filter((a) => a.username.toLowerCase().includes(search.toLowerCase())),
    [dbAccounts, search]
  )
  const allSelected = filtered.length > 0 && filtered.every((a) => selected.includes(a.id))
  const toggleAll = () => setSelected(allSelected ? [] : filtered.map((a) => a.id))
  const toggleOne = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

  const anyAction = d.actDM || d.actLike || d.actFollow
  const canSave = selected.length > 0 && d.name.trim() !== '' && anyAction && (!d.actDM || d.message.trim() !== '')

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setSaveMsg({ text: 'Картинка больше 2 МБ', ok: false }); return }
    const reader = new FileReader()
    reader.onload = () => set('image', reader.result as string)
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true); setSaveMsg(null)
    try {
      const res = await fetch('/api/triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: d.name.trim(), accountIds: selected, type: d.type,
          conditions: d.conditions, actions: buildActions(d),
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setSaveMsg({ text: `Создано триггеров: ${data.count}`, ok: true })
        setSelected([])
        setD({ ...DEFAULT_DRAFT })
        onCreated()
      } else {
        setSaveMsg({ text: data.error ?? 'Ошибка', ok: false })
      }
    } catch {
      setSaveMsg({ text: 'Ошибка сети', ok: false })
    } finally {
      setSaving(false)
    }
  }

  const saveTemplate = async () => {
    if (!tplName.trim()) return
    setTplSaving(true)
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tplName.trim(), draft: d }),
      })
      if (res.ok) {
        setSaveMsg({ text: 'Шаблон сохранён', ok: true })
        setShowTplSave(false); setTplName('')
        onCreated() // перезагрузит и список шаблонов
      } else {
        const data = await res.json()
        setSaveMsg({ text: data.error ?? 'Ошибка', ok: false })
      }
    } catch {
      setSaveMsg({ text: 'Ошибка сети', ok: false })
    } finally {
      setTplSaving(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-black/[0.02] transition-colors">
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
          <div className="grid lg:grid-cols-3 gap-5">

            {/* ── Шаг 1 — аккаунты ─────────────────────────────────────────── */}
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
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск…" className="field pl-9 py-2 text-[13px]" />
              </div>
              <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
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
                  const activeTypes = activeByAccount.get(a.id) ?? new Set<string>()
                  const ps = plateState(a, activeTypes.size)
                  return (
                    <button key={a.id} onClick={() => toggleOne(a.id)}
                      className={cn('w-full flex flex-col gap-2 p-2.5 rounded-2xl text-left border transition-all',
                        PLATE_STYLE[ps], on ? 'ring-2 ring-brand/30' : 'hover:brightness-[0.99]')}>
                      <div className="flex items-center gap-2.5">
                        <span className={cn('w-4 h-4 rounded-md border flex items-center justify-center shrink-0',
                          on ? 'bg-brand border-brand' : 'border-line bg-white')}>
                          {on && <Check className="w-2.5 h-2.5 text-white" />}
                        </span>
                        <span className="font-medium text-[13px] truncate">@{a.username}</span>
                        <span className="ml-auto flex items-center gap-1.5 shrink-0">
                          <span className={cn('w-1.5 h-1.5 rounded-full', PLATE_DOT[ps])} />
                          <span className="text-[10.5px] text-subt">{PLATE_LABEL[ps]}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 pl-6">
                        {TRIG_META.map((m) => (
                          <TrigBadge key={m.key} meta={m} active={activeTypes.has(m.db)} size={26} />
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── Шаг 2 — событие ──────────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">2</span>
                Событие
              </span>
              <div className="space-y-2">
                {TRIG_META.map((m) => {
                  const on = d.type === m.key
                  return (
                    <button key={m.key} onClick={() => set('type', m.key)}
                      className={cn('w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all',
                        on ? 'bg-white shadow-sm' : 'border-line/60 hover:border-line')}
                      style={on ? { borderColor: m.color, boxShadow: `0 0 0 3px ${hexA(m.color, 0.12)}` } : undefined}>
                      <TrigBadge meta={m} active={on} size={38} />
                      <span className="min-w-0">
                        <span className="block font-medium text-[13px]">{m.label}</span>
                        <span className="block text-[11px] text-subt">{m.desc}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── Шаг 3 — настройка ────────────────────────────────────────── */}
            <div className="flex flex-col gap-3">
              <span className="text-[13px] font-semibold flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">3</span>
                Настройка
              </span>

              {/* Действия */}
              <div>
                <div className="text-[11px] font-medium text-subt mb-1.5">Действие</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { k: 'actDM' as const,     icon: Send,      label: 'Директ',   color: '#0071e3' },
                    { k: 'actLike' as const,   icon: Heart,     label: 'Лайк',     color: '#ff2d92' },
                    { k: 'actFollow' as const, icon: UserCheck, label: 'Подписка', color: '#34c759' },
                  ].map(({ k, icon: Icon, label, color }) => {
                    const on = d[k]
                    return (
                      <button key={k} onClick={() => set(k, !on)}
                        className={cn('flex flex-col items-center gap-1.5 py-2.5 rounded-2xl border transition-all',
                          on ? 'bg-white' : 'border-line/60 text-subt hover:border-line')}
                        style={on ? { borderColor: color, boxShadow: `0 0 0 3px ${hexA(color, 0.12)}` } : undefined}>
                        <Icon className="w-4 h-4" style={on ? { color } : undefined} />
                        <span className="text-[11.5px] font-medium" style={on ? { color } : undefined}>{label}</span>
                      </button>
                    )
                  })}
                </div>
                {d.actFollow && <div className="text-[10.5px] text-subt mt-1">↳ Подписаться в ответ на нового подписчика</div>}
              </div>

              <input value={d.name} onChange={(e) => set('name', e.target.value)} className="field py-2 text-[13px]" placeholder="Название триггера" />

              {/* Настройки директа */}
              {d.actDM && (
                <>
                  <div>
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-subt mb-1.5"><Send className="w-3 h-3" /> Текст DM</div>
                    <textarea value={d.message} onChange={(e) => set('message', e.target.value)}
                      className="field h-20 resize-none text-[13px] leading-relaxed" placeholder="Используйте {{username}}" />
                  </div>

                  {/* Кнопка «кастом» */}
                  <button onClick={() => set('customOn', !d.customOn)}
                    className={cn('flex items-center justify-center gap-1.5 py-2 rounded-2xl border text-[12.5px] font-medium transition-all',
                      d.customOn ? 'border-brand bg-brand/5 text-brand' : 'border-line/60 text-subt hover:border-line')}>
                    <Sparkles className="w-3.5 h-3.5" /> {d.customOn ? 'Кастомный текст включён' : 'Кастомный текст'}
                  </button>

                  {d.customOn && (
                    <div className="rounded-2xl border border-line/60 p-3 space-y-2 bg-canvas/50">
                      <CheckRow on={d.linkOn} onChange={(v) => set('linkOn', v)} icon={Link2} label="Ссылка-кнопка" />
                      {d.linkOn && (
                        <div className="space-y-1.5 pl-6">
                          <input value={d.linkText} onChange={(e) => set('linkText', e.target.value)} className="field py-1.5 text-[12px]" placeholder="Текст (напр. «Записаться»)" />
                          <input value={d.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} className="field py-1.5 text-[12px]" placeholder="https://…" />
                          {d.linkUrl && (
                            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand text-white text-[12px] font-medium">
                              <Link2 className="w-3 h-3" /> {d.linkText || d.linkUrl}
                            </div>
                          )}
                        </div>
                      )}

                      <CheckRow on={d.dialogOn} onChange={(v) => set('dialogOn', v)} icon={MessageSquare} label="Продолжить диалог при ответе" />
                      {d.dialogOn && (
                        <div className="space-y-1.5 pl-6">
                          <input value={d.dialogKeyword} onChange={(e) => set('dialogKeyword', e.target.value)} className="field py-1.5 text-[12px]" placeholder="Триггер-фраза в ответе (напр. «да»)" />
                          <textarea value={d.dialogReply} onChange={(e) => set('dialogReply', e.target.value)} className="field h-14 resize-none py-1.5 text-[12px]" placeholder="Ответное сообщение бота" />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Картинка */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-subt"><ImageIcon className="w-3 h-3" /> Картинка</div>
                      {d.image && <button onClick={() => set('image', '')} className="text-[11px] text-bad hover:underline">Убрать</button>}
                    </div>
                    {d.image ? (
                      <img src={d.image} alt="" className="w-full max-h-40 object-cover rounded-2xl border border-line/60" />
                    ) : (
                      <button onClick={() => fileRef.current?.click()}
                        className="w-full py-3 rounded-2xl border border-dashed border-line text-[12px] text-subt hover:border-brand hover:text-brand transition-colors">
                        + Загрузить изображение
                      </button>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
                  </div>
                </>
              )}

              {/* Условия */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-subt"><Filter className="w-3 h-3" /> Условия</div>
                  <button onClick={() => set('conditions', [...d.conditions, { type: 'KEYWORDS', value: '' }])} className="text-[11px] font-medium text-brand hover:underline">+ добавить</button>
                </div>
                {d.conditions.length === 0
                  ? <div className="text-[11px] text-subt">Без условий — срабатывает всегда</div>
                  : <div className="space-y-1.5">
                      {d.conditions.map((c, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <select value={c.type}
                            onChange={(e) => set('conditions', d.conditions.map((x, idx) => idx === i ? { ...x, type: e.target.value as ConditionType } : x))}
                            className="field py-1.5 text-[11px] w-32 shrink-0 cursor-pointer">
                            {(Object.keys(CONDITION_LABELS) as ConditionType[]).map((ct) => <option key={ct} value={ct}>{CONDITION_LABELS[ct]}</option>)}
                          </select>
                          <input value={c.value}
                            onChange={(e) => set('conditions', d.conditions.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))}
                            className="field py-1.5 text-[11px] flex-1" placeholder="значение…" />
                          <button onClick={() => set('conditions', d.conditions.filter((_, idx) => idx !== i))} className="text-subt hover:text-bad p-1"><Trash2 size={13} /></button>
                        </div>
                      ))}
                    </div>}
              </div>

              {/* Задержки */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] font-medium text-subt mb-1">Задержка от (сек)</div>
                  <input type="number" value={d.delayMin} onChange={(e) => set('delayMin', +e.target.value)} className="field py-2 text-[13px]" />
                </div>
                <div>
                  <div className="text-[11px] font-medium text-subt mb-1">до (сек)</div>
                  <input type="number" value={d.delayMax} onChange={(e) => set('delayMax', +e.target.value)} className="field py-2 text-[13px]" />
                </div>
              </div>

              {saveMsg && <div className={cn('text-[12px] text-center', saveMsg.ok ? 'text-ok' : 'text-bad')}>{saveMsg.text}</div>}

              {/* Сохранение шаблона */}
              {showTplSave ? (
                <div className="flex gap-2">
                  <input value={tplName} onChange={(e) => setTplName(e.target.value)} autoFocus
                    className="field py-2 text-[13px]" placeholder="Название шаблона" />
                  <Button variant="secondary" onClick={saveTemplate} disabled={!tplName.trim() || tplSaving}>{tplSaving ? '…' : 'OK'}</Button>
                  <Button variant="ghost" onClick={() => setShowTplSave(false)}><X className="w-4 h-4" /></Button>
                </div>
              ) : (
                <button onClick={() => setShowTplSave(true)}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-2xl border border-line/60 text-[12.5px] font-medium text-subt hover:border-brand hover:text-brand transition-all">
                  <Bookmark className="w-3.5 h-3.5" /> Сохранить как шаблон
                </button>
              )}

              <Button className="w-full mt-1" onClick={save} disabled={!canSave || saving}>
                <Zap className="w-3.5 h-3.5" fill="white" />
                {saving ? 'Сохранение…'
                  : selected.length === 0 ? 'Выберите аккаунты'
                  : !anyAction ? 'Выберите действие'
                  : `Создать для ${selected.length} акк.`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Панель шаблонов
// ════════════════════════════════════════════════════════════════════════════
interface DbTemplate { id: string; name: string; usageCount: number; draft: Draft | null }

function TemplatesDrawer({ templates, loading, onClose, onApply, onDelete, onReload }: {
  templates: DbTemplate[]; loading: boolean
  onClose: () => void
  onApply: (d: Draft) => void
  onDelete: (id: string) => void
  onReload: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-card shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06]">
          <div className="flex items-center gap-2 font-semibold text-[15px]"><FileText className="w-4 h-4 text-brand" /> Шаблоны</div>
          <div className="flex items-center gap-1">
            <button onClick={onReload} className="p-1.5 text-subt hover:text-ink"><RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /></button>
            <button onClick={onClose} className="p-1.5 text-subt hover:text-ink"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-12 text-center text-subt text-[13px]">Загрузка…</div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center text-subt text-[13px]">Нет сохранённых шаблонов.<br />Создайте триггер и нажмите «Сохранить как шаблон».</div>
          ) : templates.map((t) => {
            const meta = t.draft ? META_BY_KEY[t.draft.type] : undefined
            return (
              <div key={t.id} className="card-flat p-3 flex items-center gap-3">
                {meta ? <TrigBadge meta={meta} active size={36} /> : <div className="w-9 h-9 rounded-xl bg-black/5" />}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13px] truncate">{t.name}</div>
                  <div className="text-[11px] text-subt truncate">{t.draft?.message || meta?.label || '—'}</div>
                </div>
                {t.draft && (
                  <Button size="sm" variant="secondary" onClick={() => { onApply(t.draft!); onClose() }}>Применить</Button>
                )}
                <button onClick={() => onDelete(t.id)} className="p-1.5 text-subt hover:text-bad"><Trash2 className="w-4 h-4" /></button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Главный экран
// ════════════════════════════════════════════════════════════════════════════
function TriggersScreen() {
  const [dbAccounts, setDbAccounts] = useState<DbAccount[]>([])
  const [dbTriggers, setDbTriggers] = useState<DbTrigger[]>([])
  const [templates, setTemplates] = useState<DbTemplate[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [loadingTriggers, setLoadingTriggers] = useState(true)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const formApi = useRef<{ open: () => void; load: (d: Draft) => void } | null>(null)

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try { const res = await fetch('/api/accounts'); if (res.ok) setDbAccounts(await res.json()) } catch {}
    setLoadingAccounts(false)
  }, [])

  const loadTriggers = useCallback(async () => {
    setLoadingTriggers(true)
    try { const res = await fetch('/api/triggers'); if (res.ok) setDbTriggers(await res.json()) } catch {}
    setLoadingTriggers(false)
  }, [])

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true)
    try { const res = await fetch('/api/templates'); if (res.ok) setTemplates(await res.json()) } catch {}
    setLoadingTemplates(false)
  }, [])

  useEffect(() => { loadAccounts(); loadTriggers(); loadTemplates() }, [loadAccounts, loadTriggers, loadTemplates])

  const deleteTrigger = async (id: string) => {
    await fetch(`/api/triggers/${id}`, { method: 'DELETE' })
    setDbTriggers((prev) => prev.filter((t) => t.id !== id))
  }
  const toggleTrigger = async (id: string, isActive: boolean) => {
    await fetch(`/api/triggers/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    setDbTriggers((prev) => prev.map((t) => t.id === id ? { ...t, isActive: !isActive } : t))
  }
  const deleteTemplate = async (id: string) => {
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  const activeTriggers = dbTriggers.filter((t) => t.isActive)
  const inactiveTriggers = dbTriggers.filter((t) => !t.isActive)
  const totalFires = dbTriggers.reduce((s, t) => s + (t.fireCount ?? 0), 0)

  return (
    <div className="space-y-5 pb-24">
      {/* Шапка со статистикой + кнопка шаблонов */}
      <div className="flex items-center justify-between gap-3">
        <div className="grid grid-cols-3 gap-3 flex-1">
          <div className="card px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-brand/10 flex items-center justify-center shrink-0"><Zap className="w-5 h-5 text-brand" /></div>
            <div>
              <div className="text-[22px] font-semibold tracking-tighter leading-none">{activeTriggers.length}</div>
              <div className="text-[12px] text-subt mt-1">Активных</div>
            </div>
          </div>
          <div className="card px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-ok/10 flex items-center justify-center shrink-0"><Send className="w-5 h-5 text-ok" /></div>
            <div>
              <div className="text-[22px] font-semibold tracking-tighter leading-none">{totalFires.toLocaleString('ru')}</div>
              <div className="text-[12px] text-subt mt-1">Срабатываний</div>
            </div>
          </div>
          <div className="card px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#5e5ce6]/10 flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-[#5e5ce6]" /></div>
            <div>
              <div className="text-[22px] font-semibold tracking-tighter leading-none">{dbAccounts.filter((a) => a.status === 'ACTIVE').length}</div>
              <div className="text-[12px] text-subt mt-1">Аккаунтов</div>
            </div>
          </div>
        </div>
      </div>

      {/* Список триггеров */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.05]">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-brand" />
            <span className="font-semibold text-[15px]">Триггеры</span>
            <span className="text-[12px] text-subt">({dbTriggers.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowTemplates(true); loadTemplates() }}
              className="flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-xl bg-black/[0.05] text-ink hover:bg-black/[0.08] transition-colors">
              <FileText className="w-3.5 h-3.5" /> Шаблоны
            </button>
            <button onClick={loadTriggers} className="p-1.5 text-subt hover:text-ink transition-colors" title="Обновить">
              <RefreshCw className={cn('w-4 h-4', loadingTriggers && 'animate-spin')} />
            </button>
          </div>
        </div>

        {loadingTriggers ? (
          <div className="py-12 text-center text-subt text-[13px]">Загрузка…</div>
        ) : dbTriggers.length === 0 ? (
          <div className="py-14 flex flex-col items-center gap-3 text-center px-6">
            <div className="w-14 h-14 rounded-3xl bg-brand/8 flex items-center justify-center"><Zap className="w-7 h-7 text-brand/50" /></div>
            <div className="font-semibold text-[16px] tracking-tight text-ink/70">Триггеров пока нет</div>
            <div className="text-[13px] text-subt max-w-xs">Создайте первый триггер ниже — система будет автоматически реагировать на новых подписчиков</div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {activeTriggers.length > 0 && (
              <>
                <div className="text-[11px] font-semibold text-subt uppercase tracking-wider px-1">Активные</div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {activeTriggers.map((t) => (
                    <TriggerCard key={t.id} trigger={t} onToggle={() => toggleTrigger(t.id, t.isActive)} onDelete={() => deleteTrigger(t.id)} />
                  ))}
                </div>
              </>
            )}
            {inactiveTriggers.length > 0 && (
              <>
                <div className="text-[11px] font-semibold text-subt uppercase tracking-wider px-1 mt-2">Выключенные</div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {inactiveTriggers.map((t) => (
                    <TriggerCard key={t.id} trigger={t} onToggle={() => toggleTrigger(t.id, t.isActive)} onDelete={() => deleteTrigger(t.id)} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Форма создания */}
      <CreateForm
        dbAccounts={dbAccounts}
        dbTriggers={dbTriggers}
        loadingAccounts={loadingAccounts}
        onCreated={() => { loadTriggers(); loadTemplates() }}
        formRef={formApi}
      />

      {showTemplates && (
        <TemplatesDrawer
          templates={templates}
          loading={loadingTemplates}
          onClose={() => setShowTemplates(false)}
          onApply={(d) => formApi.current?.load(d)}
          onDelete={deleteTemplate}
          onReload={loadTemplates}
        />
      )}
    </div>
  )
}

export default function Page() {
  return <ClientOnly><TriggersScreen /></ClientOnly>
}

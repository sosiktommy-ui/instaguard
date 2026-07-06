'use client'

import { useMemo, useState } from 'react'
import { Check, Minus, UserPlus, MessageCircle, Heart, Clapperboard, Send, type LucideIcon } from 'lucide-react'
import { readStat, ACTION_KEYS, type ActionKey } from '@/lib/stats'
import { TONE, hexA } from '@/lib/colors'

// Матрица срабатываний. Два вида:
//  • «По аккаунтам» — слева аккаунты, сверху ГРУППЫ = типы событий (подписка/коммент/
//    лайк/сторис), под ними подгруппы = действия. У каждой группы свой итог, справа —
//    общий «Итого» по аккаунту.
//  • «По кампаниям» — слева кампании, сверху действия + аккаунтов + итог.
// В ячейках — сколько РЕАЛЬНО выполнилось (данные stats.done/fired).

export interface MxTrigger {
  id: string
  name?: string
  triggerType: string
  actions?: any[]
  stats?: any
  responder?: { id: string; username: string } | null
}
export interface MxAccount { id: string; username: string }

interface Stat { fired: number; done: number }

const ACTION_META: Record<ActionKey, { label: string; Icon: LucideIcon }> = {
  dm: { label: 'Директ', Icon: Send },
  like: { label: 'Лайк', Icon: Heart },
  follow: { label: 'Подписка', Icon: UserPlus },
  story: { label: 'Сторис', Icon: Clapperboard },
  comment: { label: 'Коммент', Icon: MessageCircle },
}
// Типы событий = группы. Порядок фиксированный, у каждого свой цвет/иконка.
const TYPE_ORDER = ['NEW_FOLLOWER', 'NEW_COMMENT', 'NEW_LIKE', 'STORY_MENTION'] as const
const TYPE_META: Record<string, { label: string; color: string; Icon: LucideIcon }> = {
  NEW_FOLLOWER: { label: 'Новая подписка', color: TONE.brand, Icon: UserPlus },
  NEW_COMMENT: { label: 'Комментарий', color: TONE.ok, Icon: MessageCircle },
  NEW_LIKE: { label: 'Лайк', color: TONE.pink, Icon: Heart },
  STORY_MENTION: { label: 'Ответ на сторис', color: TONE.warn, Icon: Clapperboard },
}
const ACTION_FROM_TYPE: Record<string, ActionKey> = {
  SEND_MESSAGE: 'dm', LIKE_MEDIA: 'like', FOLLOW_BACK: 'follow', VIEW_STORIES: 'story',
  REPLY_COMMENT: 'comment', LIKE_COMMENT: 'comment', COMMENT_GATE: 'comment',
}

function configuredKeys(t: MxTrigger): Set<ActionKey> {
  const set = new Set<ActionKey>()
  for (const a of (t.actions ?? [])) {
    if (!a || a.enabled === false) continue
    const k = ACTION_FROM_TYPE[a.type]
    if (k) set.add(k)
  }
  return set
}
const addStat = (a: Stat, b: Stat): Stat => ({ fired: a.fired + b.fired, done: a.done + b.done })
const ZERO: Stat = { fired: 0, done: 0 }

export function CampaignMatrix({ triggers }: { triggers: MxTrigger[]; accounts?: MxAccount[] }) {
  const [view, setView] = useState<'accounts' | 'campaigns'>('accounts')

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="segment">
          {([['accounts', 'По аккаунтам'], ['campaigns', 'По кампаниям']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3.5 py-1.5 rounded-xl text-[13px] font-medium transition-all ${view === v ? 'bg-white shadow-sm text-ink' : 'text-subt hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="text-[12px] text-subt hidden sm:flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><Check className="w-3.5 h-3.5 text-ok" />выполнено</span>
          <span><span className="text-warn font-medium">0/N</span> — не выполнилось</span>
          <span>— нет</span>
        </div>
      </div>

      {view === 'accounts' ? <AccountsView triggers={triggers} /> : <CampaignsView triggers={triggers} />}
    </div>
  )
}

// ── Вид «По аккаунтам»: аккаунты × (тип события → действия) ────────────────────
function AccountsView({ triggers }: { triggers: MxTrigger[] }) {
  const model = useMemo(() => {
    const rowMap = new Map<string, string>()
    for (const t of triggers) if (t.responder) rowMap.set(t.responder.id, t.responder.username)
    const rows = [...rowMap.entries()].map(([id, username]) => ({ id, username }))
      .sort((a, b) => a.username.localeCompare(b.username))

    // Группы = типы событий, присутствующие среди триггеров
    const groups = TYPE_ORDER.filter((type) => triggers.some((t) => t.triggerType === type)).map((type) => {
      const list = triggers.filter((t) => t.triggerType === type)
      const actionKeys = ACTION_KEYS.filter((k) =>
        list.some((t) => configuredKeys(t).has(k)) ||
        list.some((t) => { const s = readStat(t.stats, k); return s.fired > 0 || s.done > 0 })
      )
      const cell = (accId: string, k: ActionKey): Stat | null => {
        const rel = list.filter((t) => t.responder?.id === accId)
        if (!rel.length) return null
        return rel.reduce((acc, t) => addStat(acc, readStat(t.stats, k)), { ...ZERO })
      }
      const groupTotal = (accId: string): Stat | null => {
        if (!list.some((t) => t.responder?.id === accId)) return null
        return actionKeys.reduce((acc, k) => addStat(acc, cell(accId, k) ?? ZERO), { ...ZERO })
      }
      return { type, ...TYPE_META[type], actionKeys, cell, groupTotal }
    }).filter((g) => g.actionKeys.length > 0)

    const grandTotal = (accId: string) => groups.reduce((s, g) => s + (g.groupTotal(accId)?.done ?? 0), 0)
    return { rows, groups, grandTotal }
  }, [triggers])

  if (!model.groups.length || !model.rows.length) {
    return <Empty />
  }

  return (
    <Scroll>
      <thead>
        <tr>
          <th rowSpan={2} className="sticky left-0 z-10 bg-white text-left align-bottom font-semibold text-ink/80 px-3 py-2.5 border-b border-black/10 min-w-[168px]">
            Аккаунт
          </th>
          {model.groups.map((g) => (
            <th key={g.type} colSpan={g.actionKeys.length + 1}
              className="px-2.5 py-2 border-b border-l-2 text-center"
              style={{ borderLeftColor: hexA(g.color, 0.35), background: hexA(g.color, 0.09) }}>
              <div className="inline-flex items-center gap-1.5 font-semibold" style={{ color: g.color }}>
                <g.Icon className="w-4 h-4" />{g.label}
              </div>
            </th>
          ))}
          <th rowSpan={2} className="px-3 py-2.5 border-b border-l-2 border-black/15 text-center align-bottom font-semibold text-ink min-w-[62px] bg-black/[0.02]">
            Итого
          </th>
        </tr>
        <tr>
          {model.groups.flatMap((g) => [
            ...g.actionKeys.map((k, idx) => {
              const A = ACTION_META[k]
              return (
                <th key={g.type + k}
                  className={`px-2.5 py-1.5 border-b border-black/10 font-medium text-subt whitespace-nowrap text-center min-w-[62px] ${idx === 0 ? 'border-l-2' : 'border-l border-black/[0.04]'}`}
                  style={idx === 0 ? { borderLeftColor: hexA(g.color, 0.35) } : undefined}>
                  <span className="inline-flex items-center gap-1"><A.Icon className="w-3 h-3 opacity-60" />{A.label}</span>
                </th>
              )
            }),
            <th key={g.type + '_sum'} className="px-2.5 py-1.5 border-b border-black/10 font-semibold text-center min-w-[52px]"
              style={{ color: g.color, background: hexA(g.color, 0.05) }} title={`Итог по «${g.label}»`}>Σ</th>,
          ])}
        </tr>
      </thead>
      <tbody>
        {model.rows.map((acc) => (
          <tr key={acc.id} className="hover:bg-black/[0.015]">
            <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-black/[0.05] whitespace-nowrap">
              <span className="inline-flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white text-[11px] font-semibold shrink-0">
                  {(acc.username?.[0] ?? '?').toUpperCase()}
                </span>
                <span className="font-medium truncate max-w-[120px]">@{acc.username}</span>
              </span>
            </td>
            {model.groups.flatMap((g) => [
              ...g.actionKeys.map((k, idx) => (
                <td key={g.type + k}
                  className={`text-center px-2.5 py-2 border-b border-black/[0.05] ${idx === 0 ? 'border-l-2' : 'border-l border-black/[0.04]'}`}
                  style={idx === 0 ? { borderLeftColor: hexA(g.color, 0.25) } : undefined}>
                  <Cell v={g.cell(acc.id, k)} />
                </td>
              )),
              <td key={g.type + '_sum'} className="text-center px-2.5 py-2 border-b border-black/[0.05] font-semibold tabular-nums"
                style={{ color: g.color, background: hexA(g.color, 0.04) }}>
                <SumCell v={g.groupTotal(acc.id)} />
              </td>,
            ])}
            <td className="text-center px-3 py-2 border-b border-black/[0.05] border-l-2 border-black/15 font-bold tabular-nums bg-black/[0.02]">
              {model.grandTotal(acc.id) || <span className="text-black/25">0</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </Scroll>
  )
}

// ── Вид «По кампаниям»: кампании × действия ───────────────────────────────────
function CampaignsView({ triggers }: { triggers: MxTrigger[] }) {
  const model = useMemo(() => {
    const map = new Map<string, MxTrigger[]>()
    for (const t of triggers) {
      const key = t.name || '(без названия)'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    const rows = [...map.entries()].map(([name, list]) => {
      const actionKeys = ACTION_KEYS.filter((k) =>
        list.some((t) => configuredKeys(t).has(k)) ||
        list.some((t) => { const s = readStat(t.stats, k); return s.fired > 0 || s.done > 0 })
      )
      const cell = (k: ActionKey) => list.reduce((acc, t) => addStat(acc, readStat(t.stats, k)), { ...ZERO })
      const accountsCount = new Set(list.map((t) => t.responder?.id).filter(Boolean)).size
      const total = actionKeys.reduce((s, k) => s + cell(k).done, 0)
      return { name, type: list[0]?.triggerType, actionKeys, cell, accountsCount, total }
    }).sort((a, b) => b.total - a.total)
    // Общий набор колонок-действий (объединение по всем кампаниям)
    const allKeys = ACTION_KEYS.filter((k) => rows.some((r) => r.actionKeys.includes(k)))
    return { rows, allKeys }
  }, [triggers])

  if (!model.rows.length) return <Empty />

  return (
    <Scroll>
      <thead>
        <tr>
          <th className="sticky left-0 z-10 bg-white text-left font-semibold text-ink/80 px-3 py-2.5 border-b border-black/10 min-w-[200px]">Кампания</th>
          <th className="px-2.5 py-2.5 border-b border-black/10 text-center font-medium text-subt min-w-[70px]">Аккаунтов</th>
          {model.allKeys.map((k) => {
            const A = ACTION_META[k]
            return (
              <th key={k} className="px-2.5 py-2.5 border-b border-black/10 border-l border-black/[0.04] font-medium text-subt text-center min-w-[64px]">
                <span className="inline-flex items-center gap-1"><A.Icon className="w-3 h-3 opacity-60" />{A.label}</span>
              </th>
            )
          })}
          <th className="px-3 py-2.5 border-b border-l-2 border-black/15 text-center font-semibold text-ink min-w-[62px] bg-black/[0.02]">Итого</th>
        </tr>
      </thead>
      <tbody>
        {model.rows.map((r) => {
          const tm = TYPE_META[r.type ?? '']
          return (
            <tr key={r.name} className="hover:bg-black/[0.015]">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-black/[0.05]">
                <div className="font-medium text-ink truncate max-w-[220px]" title={r.name}>{r.name}</div>
                {tm && <div className="inline-flex items-center gap-1 text-[11px]" style={{ color: tm.color }}><tm.Icon className="w-3 h-3" />{tm.label}</div>}
              </td>
              <td className="text-center px-2.5 py-2 border-b border-black/[0.05] tabular-nums text-subt">{r.accountsCount}</td>
              {model.allKeys.map((k) => (
                <td key={k} className="text-center px-2.5 py-2 border-b border-black/[0.05] border-l border-black/[0.04]">
                  {r.actionKeys.includes(k) ? <Cell v={r.cell(k)} /> : <Minus className="w-3.5 h-3.5 text-black/12 mx-auto" />}
                </td>
              ))}
              <td className="text-center px-3 py-2 border-b border-black/[0.05] border-l-2 border-black/15 font-bold tabular-nums bg-black/[0.02]">
                {r.total || <span className="text-black/25">0</span>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </Scroll>
  )
}

function Scroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-2 px-2 rounded-xl">
      <table className="border-collapse text-[13px]">{children}</table>
    </div>
  )
}
function Empty() {
  return <div className="py-8 text-center text-subt text-[13px]">Пока нет кампаний с аккаунтами</div>
}

function Cell({ v }: { v: Stat | null }) {
  if (!v) return <Minus className="w-3.5 h-3.5 text-black/15 mx-auto" />
  if (v.done > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-ok font-semibold tabular-nums" title={`Выполнено ${v.done} из ${v.fired}`}>
        <Check className="w-3.5 h-3.5" />{v.done}
      </span>
    )
  }
  if (v.fired > 0) return <span className="text-warn font-medium tabular-nums" title={`${v.fired} попыток, 0 успешных`}>0/{v.fired}</span>
  return <span className="text-black/25 tabular-nums">0</span>
}
function SumCell({ v }: { v: Stat | null }) {
  if (!v) return <Minus className="w-3.5 h-3.5 text-black/15 mx-auto" />
  return <span title={`Выполнено ${v.done} из ${v.fired}`}>{v.done}</span>
}

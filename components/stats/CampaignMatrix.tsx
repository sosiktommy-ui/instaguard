'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Minus, UserPlus, MessageCircle, Heart, Clapperboard, Send, type LucideIcon } from 'lucide-react'
import { readStat, ACTION_KEYS, type ActionKey } from '@/lib/stats'
import { hexA, darken } from '@/lib/colors'

// Матрица срабатываний. Два вида:
//  • «По аккаунтам» — слева аккаунты, сверху ГРУППЫ = типы событий (подписка/коммент/
//    лайк/сторис), под ними подгруппы = действия. У каждой группы свой итог, справа —
//    общий «Итого» по аккаунту.
//  • «По кампаниям» — слева кампании, сверху действия + аккаунтов + итог.
//  • «Сводка» — события (сработало) | действия (выполнено).
// В ячейках — сколько РЕАЛЬНО выполнилось (данные stats.done/fired).
//
// Оформление держим в ЕДИНОМ 3D-языке с диаграммой §13.13: те же брендовые цвета типов
// (подписка=фиолет #7C5CFC, коммент=зелёный, лайк=янтарь, сторис=голубой), объёмные
// заголовки-плитки (градиент+тень+глянец, как IconTile), глянцевые пилюли в ячейках.

export interface MxTrigger {
  id: string
  name?: string
  triggerType: string
  fireCount?: number
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
// Цвета действий = ровно как срез «По действию» на диаграмме (единый источник цвета).
const ACT_C: Record<ActionKey, string> = {
  dm: '#7C5CFC', like: '#F59E0B', follow: '#22C55E', story: '#38BDF8', comment: '#FF5CA8',
}
// Типы событий = группы. Порядок фиксированный; цвета СИНХРОНИЗИРОВАНЫ с диаграммой (§13.13).
const TYPE_ORDER = ['NEW_FOLLOWER', 'NEW_COMMENT', 'NEW_LIKE', 'STORY_MENTION'] as const
const TYPE_META: Record<string, { label: string; color: string; Icon: LucideIcon }> = {
  NEW_FOLLOWER: { label: 'Новая подписка', color: '#7C5CFC', Icon: UserPlus },
  NEW_COMMENT: { label: 'Комментарий', color: '#22C55E', Icon: MessageCircle },
  NEW_LIKE: { label: 'Лайк', color: '#F59E0B', Icon: Heart },
  STORY_MENTION: { label: 'Ответ на сторис', color: '#38BDF8', Icon: Clapperboard },
}
const TYPE_SHORT: Record<string, string> = {
  NEW_FOLLOWER: 'Подписка', NEW_COMMENT: 'Комментарий', NEW_LIKE: 'Лайк', STORY_MENTION: 'Сторис',
}
// Полный набор возможных действий для каждого типа события (таблица всегда полная;
// невключённые — серым). «Коммент» (ответ в комментах) есть только у события «Комментарий».
const TYPE_ACTIONS: Record<string, ActionKey[]> = {
  NEW_FOLLOWER: ['dm', 'like', 'follow', 'story'],
  NEW_COMMENT: ['dm', 'like', 'follow', 'story', 'comment'],
  NEW_LIKE: ['dm', 'like', 'follow', 'story'],
  STORY_MENTION: ['dm', 'like', 'follow', 'story'],
}
const MUTED = '#b4b4bd' // цвет неактивных (серых) элементов
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

// ─────────────────────────────────────────────────────────────────────────────
// Мелкая анимация числа (0 → значение) при появлении — «оживляет» матрицу в тон
// анимированной диаграмме. Уважает prefers-reduced-motion и SSR.
function useCountUp(target: number): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined') { setN(target); return }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduce || target <= 0) { setN(target); return }
    let raf = 0
    const start = performance.now()
    const dur = 460
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      setN(Math.round(target * e))
      if (p < 1) raf = requestAnimationFrame(step); else setN(target)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return n
}
function CountNum({ n }: { n: number }) {
  return <>{useCountUp(n)}</>
}
const popStyle = (i: number): React.CSSProperties => ({ animationDelay: `${Math.min(i * 45, 400)}ms` })

// Объёмная плитка-заголовок типа события (градиент+тень+глянец = язык IconTile/диаграммы).
function GroupTile({ color, Icon, label, active }: { color: string; Icon: LucideIcon; label: string; active: boolean }) {
  if (!active) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold text-[13px]"
        style={{ background: '#ececed', color: '#9a9aa2', boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.6)' }}>
        <Icon className="w-4 h-4" />{label}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold text-white text-[13px]"
      style={{
        background: `linear-gradient(145deg, ${color}, ${darken(color)})`,
        boxShadow: `0 4px 13px ${hexA(color, 0.42)}, inset 0 1.5px 1px rgba(255,255,255,0.5), inset 0 -2px 4px ${hexA(darken(color, 0.6), 0.5)}`,
      }}>
      <Icon className="w-4 h-4" />{label}
    </span>
  )
}

// Ячейка-значение: 3D-пилюля. Выполнено → зелёная выпуклая; попытки без успеха → янтарная
// «0/N»; настроено, но 0 → тусклый ноль; неприменимо → тире.
function ValuePill({ v }: { v: Stat | null }) {
  if (!v) return <Minus className="w-3.5 h-3.5 text-black/15 mx-auto" />
  if (v.done > 0) {
    return (
      <span title={`Выполнено ${v.done} из ${v.fired}`}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-semibold text-white tabular-nums"
        style={{
          background: 'linear-gradient(145deg, #3ad06e, #1fa34e)',
          boxShadow: '0 3px 9px rgba(31,163,78,0.38), inset 0 1px 1px rgba(255,255,255,0.5), inset 0 -2px 3px rgba(8,70,36,0.45)',
        }}>
        <Check className="w-3.5 h-3.5" strokeWidth={3} /><CountNum n={v.done} />
      </span>
    )
  }
  if (v.fired > 0) {
    return (
      <span title={`${v.fired} попыток, 0 успешных`}
        className="inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums"
        style={{ color: '#b26a00', background: hexA('#F59E0B', 0.15), boxShadow: 'inset 0 0 0 1px rgba(245,158,11,0.4)' }}>
        0/{v.fired}
      </span>
    )
  }
  return <span className="text-black/25 tabular-nums text-[12.5px]">0</span>
}

// Итог по группе (Σ) — мягкая пилюля в цвете типа.
function SumPill({ v, color, active }: { v: Stat | null; color: string; active: boolean }) {
  if (!v) return <Minus className="w-3.5 h-3.5 text-black/15 mx-auto" />
  const c = active ? color : MUTED
  if (v.done <= 0) return <span className="text-black/25 tabular-nums font-semibold text-[12.5px]">0</span>
  return (
    <span title={`Выполнено ${v.done} из ${v.fired}`}
      className="inline-flex items-center justify-center rounded-lg px-2 py-0.5 font-bold text-[13px] tabular-nums"
      style={{ color: c, background: hexA(c, 0.14), boxShadow: `inset 0 0 0 1px ${hexA(c, 0.28)}` }}>
      <CountNum n={v.done} />
    </span>
  )
}

// Общий итог по аккаунту/кампании — выпуклая нейтральная пилюля (акцент строки).
function GrandPill({ n }: { n: number }) {
  if (n <= 0) return <span className="text-black/25 tabular-nums font-semibold">0</span>
  return (
    <span className="inline-flex items-center justify-center rounded-lg px-2.5 py-1 font-bold text-white text-[13px] tabular-nums"
      style={{ background: 'linear-gradient(145deg, #56566380, #2b2b34)', boxShadow: '0 3px 9px rgba(20,18,40,0.26), inset 0 1px 1px rgba(255,255,255,0.28)' }}>
      <CountNum n={n} />
    </span>
  )
}

// Число со своим акцентным цветом (для «Сводки»).
function AccentNum({ n, color }: { n: number; color?: string }) {
  if (n <= 0) return <span className="text-black/25 tabular-nums">0</span>
  return <span className="font-semibold tabular-nums" style={color ? { color } : undefined}><CountNum n={n} /></span>
}

// Аватар-чип аккаунта с объёмом (в тон общей 3D-теме).
function AccountChip({ username }: { username: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-7 h-7 rounded-xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white text-[11px] font-semibold shrink-0"
        style={{ boxShadow: '0 3px 8px rgba(214,41,118,0.4), inset 0 1px 1px rgba(255,255,255,0.5)' }}>
        {(username?.[0] ?? '?').toUpperCase()}
      </span>
      <span className="font-medium truncate max-w-[120px]">@{username}</span>
    </span>
  )
}

export function CampaignMatrix({ triggers }: { triggers: MxTrigger[]; accounts?: MxAccount[] }) {
  const [view, setView] = useState<'accounts' | 'campaigns' | 'summary'>('accounts')

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="segment">
          {([['accounts', 'По аккаунтам'], ['campaigns', 'По кампаниям'], ['summary', 'Сводка']] as const).map(([v, label]) => {
            const on = view === v
            return (
              <button key={v} onClick={() => setView(v)}
                className={`px-3.5 py-1.5 rounded-xl text-[13px] font-medium transition-all ${on ? 'text-white' : 'text-subt hover:text-ink'}`}
                style={on ? { background: `linear-gradient(145deg, #7658ff, ${darken('#663af1')})`, boxShadow: '0 3px 10px rgba(102,58,241,0.4), inset 0 1px 1px rgba(255,255,255,0.4)' } : undefined}>
                {label}
              </button>
            )
          })}
        </div>
        {view !== 'summary' && (
          <div className="text-[12px] text-subt hidden sm:flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white"
                style={{ background: 'linear-gradient(145deg,#3ad06e,#1fa34e)', boxShadow: '0 1px 3px rgba(31,163,78,0.4)' }}>
                <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
              </span>
              выполнено
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ color: '#b26a00', background: hexA('#F59E0B', 0.15), boxShadow: 'inset 0 0 0 1px rgba(245,158,11,0.4)' }}>0/N</span>
              не выполнилось
            </span>
            <span className="inline-flex items-center gap-1"><Minus className="w-3 h-3 text-black/20" /> нет</span>
          </div>
        )}
      </div>

      {view === 'accounts' ? <AccountsView triggers={triggers} />
        : view === 'campaigns' ? <CampaignsView triggers={triggers} />
        : <SummaryView triggers={triggers} />}
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

    // Таблица ВСЕГДА полная: все типы событий и все их возможные действия.
    // Неиспользуемые (нет такой кампании / действие не включено) — серым.
    const groups = TYPE_ORDER.map((type) => {
      const list = triggers.filter((t) => t.triggerType === type)
      const active = list.length > 0
      const actionKeys = TYPE_ACTIONS[type]
      const actionActive = (k: ActionKey) =>
        list.some((t) => configuredKeys(t).has(k) || (() => { const s = readStat(t.stats, k); return s.fired > 0 || s.done > 0 })())
      const cell = (accId: string, k: ActionKey): Stat | null => {
        const rel = list.filter((t) => t.responder?.id === accId)
        if (!rel.length) return null
        return rel.reduce((acc, t) => addStat(acc, readStat(t.stats, k)), { ...ZERO })
      }
      const groupTotal = (accId: string): Stat | null => {
        if (!list.some((t) => t.responder?.id === accId)) return null
        return actionKeys.reduce((acc, k) => addStat(acc, cell(accId, k) ?? ZERO), { ...ZERO })
      }
      return { type, ...TYPE_META[type], active, actionKeys, actionActive, cell, groupTotal }
    })

    const grandTotal = (accId: string) => groups.reduce((s, g) => s + (g.groupTotal(accId)?.done ?? 0), 0)
    return { rows, groups, grandTotal }
  }, [triggers])

  if (!model.rows.length) return <Empty />

  return (
    <Scroll>
      <thead>
        <tr>
          <th rowSpan={2} className="sticky left-0 z-20 bg-white mx-sticky-shadow text-left align-bottom font-semibold text-ink/80 px-3 py-3 border-b border-black/10 min-w-[172px]">
            Аккаунт
          </th>
          {model.groups.map((g) => {
            const c = g.active ? g.color : MUTED
            return (
              <th key={g.type} colSpan={g.actionKeys.length + 1}
                className="px-2.5 py-2.5 border-b border-l-2 text-center mx-head-shadow"
                style={{ borderLeftColor: hexA(c, 0.35), background: g.active ? hexA(g.color, 0.08) : 'rgba(0,0,0,0.02)' }}>
                <GroupTile color={g.color} Icon={g.Icon} label={g.label} active={g.active} />
              </th>
            )
          })}
          <th rowSpan={2} className="px-3 py-3 border-b border-l-2 border-black/15 text-center align-bottom font-semibold text-ink min-w-[64px] bg-black/[0.02]">
            Итого
          </th>
        </tr>
        <tr>
          {model.groups.flatMap((g) => [
            ...g.actionKeys.map((k, idx) => {
              const A = ACTION_META[k]
              const on = g.active && g.actionActive(k)
              return (
                <th key={g.type + k}
                  className={`px-2.5 py-2 border-b border-black/10 font-medium whitespace-nowrap text-center min-w-[64px] ${on ? 'text-subt' : 'text-black/25'} ${idx === 0 ? 'border-l-2' : 'border-l border-black/[0.04]'}`}
                  style={idx === 0 ? { borderLeftColor: hexA(g.active ? g.color : MUTED, 0.35) } : undefined}>
                  <span className="inline-flex items-center gap-1">
                    <A.Icon className="w-3 h-3" style={{ color: on ? ACT_C[k] : undefined, opacity: on ? 0.85 : 0.5 }} />{A.label}
                  </span>
                </th>
              )
            }),
            <th key={g.type + '_sum'} className="px-2.5 py-2 border-b border-black/10 font-semibold text-center min-w-[54px]"
              style={{ color: g.active ? g.color : MUTED, background: g.active ? hexA(g.color, 0.05) : 'rgba(0,0,0,0.02)' }} title={`Итог по «${g.label}»`}>Σ</th>,
          ])}
        </tr>
      </thead>
      <tbody>
        {model.rows.map((acc, ri) => (
          <tr key={acc.id} className="mx-row mx-pop hover:bg-brand/[0.03]" style={popStyle(ri)}>
            <td className="sticky left-0 z-10 bg-white mx-sticky-shadow px-3 py-2.5 border-b border-black/[0.05] whitespace-nowrap">
              <AccountChip username={acc.username} />
            </td>
            {model.groups.flatMap((g) => [
              ...g.actionKeys.map((k, idx) => (
                <td key={g.type + k}
                  className={`text-center px-2.5 py-2.5 border-b border-black/[0.05] ${idx === 0 ? 'border-l-2' : 'border-l border-black/[0.04]'}`}
                  style={idx === 0 ? { borderLeftColor: hexA(g.active ? g.color : MUTED, 0.22) } : undefined}>
                  <ValuePill v={g.cell(acc.id, k)} />
                </td>
              )),
              <td key={g.type + '_sum'} className="text-center px-2.5 py-2.5 border-b border-black/[0.05]"
                style={{ background: g.active ? hexA(g.color, 0.035) : 'rgba(0,0,0,0.02)' }}>
                <SumPill v={g.groupTotal(acc.id)} color={g.color} active={g.active} />
              </td>,
            ])}
            <td className="text-center px-3 py-2.5 border-b border-black/[0.05] border-l-2 border-black/15 bg-black/[0.02]">
              <GrandPill n={model.grandTotal(acc.id)} />
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
          <th className="sticky left-0 z-20 bg-white mx-sticky-shadow text-left font-semibold text-ink/80 px-3 py-3 border-b border-black/10 min-w-[210px] mx-head-shadow">Кампания</th>
          <th className="px-2.5 py-3 border-b border-black/10 text-center font-medium text-subt min-w-[74px] mx-head-shadow">Аккаунтов</th>
          {model.allKeys.map((k) => {
            const A = ACTION_META[k]
            return (
              <th key={k} className="px-2.5 py-3 border-b border-black/10 border-l border-black/[0.04] font-medium text-subt text-center min-w-[66px] mx-head-shadow">
                <span className="inline-flex items-center gap-1"><A.Icon className="w-3 h-3" style={{ color: ACT_C[k], opacity: 0.85 }} />{A.label}</span>
              </th>
            )
          })}
          <th className="px-3 py-3 border-b border-l-2 border-black/15 text-center font-semibold text-ink min-w-[64px] bg-black/[0.02] mx-head-shadow">Итого</th>
        </tr>
      </thead>
      <tbody>
        {model.rows.map((r, ri) => {
          const tm = TYPE_META[r.type ?? '']
          return (
            <tr key={r.name} className="mx-row mx-pop hover:bg-brand/[0.03]" style={popStyle(ri)}>
              <td className="sticky left-0 z-10 bg-white mx-sticky-shadow px-3 py-2.5 border-b border-black/[0.05]">
                <div className="font-medium text-ink truncate max-w-[230px]" title={r.name}>{r.name}</div>
                {tm && (
                  <span className="inline-flex items-center gap-1 mt-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium"
                    style={{ color: tm.color, background: hexA(tm.color, 0.12) }}>
                    <tm.Icon className="w-3 h-3" />{tm.label}
                  </span>
                )}
              </td>
              <td className="text-center px-2.5 py-2.5 border-b border-black/[0.05] tabular-nums text-subt font-medium">{r.accountsCount}</td>
              {model.allKeys.map((k) => (
                <td key={k} className="text-center px-2.5 py-2.5 border-b border-black/[0.05] border-l border-black/[0.04]">
                  {r.actionKeys.includes(k) ? <ValuePill v={r.cell(k)} /> : <Minus className="w-3.5 h-3.5 text-black/12 mx-auto" />}
                </td>
              ))}
              <td className="text-center px-3 py-2.5 border-b border-black/[0.05] border-l-2 border-black/15 bg-black/[0.02]">
                <GrandPill n={r.total} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </Scroll>
  )
}

// ── Вид «Сводка»: аккаунты × (события — сработало | действия — выполнено) ──────
function SummaryView({ triggers }: { triggers: MxTrigger[] }) {
  const model = useMemo(() => {
    const rowMap = new Map<string, string>()
    for (const t of triggers) if (t.responder) rowMap.set(t.responder.id, t.responder.username)
    const rows = [...rowMap.entries()].map(([id, username]) => ({ id, username }))
      .sort((a, b) => a.username.localeCompare(b.username))

    // Таблица всегда полная: все типы событий и все действия (неактивные — серым)
    const eventTypes = [...TYPE_ORDER]
    const actionKeys = [...ACTION_KEYS]
    const eventActive = (type: string) => triggers.some((t) => t.triggerType === type)
    const actionActive = (k: ActionKey) =>
      triggers.some((t) => configuredKeys(t).has(k) || (() => { const s = readStat(t.stats, k); return s.fired > 0 || s.done > 0 })())

    // событие = сколько раз СРАБОТАЛ триггер этого типа (fireCount)
    const eventVal = (accId: string, type: string) =>
      triggers.filter((t) => t.responder?.id === accId && t.triggerType === type)
        .reduce((s, t) => s + (t.fireCount ?? 0), 0)
    // действие = сумма ВЫПОЛНЕННЫХ (done) по всем триггерам аккаунта
    const actionVal = (accId: string, k: ActionKey) =>
      triggers.filter((t) => t.responder?.id === accId)
        .reduce((s, t) => s + readStat(t.stats, k).done, 0)

    const eventSum = (accId: string) => eventTypes.reduce((s, ty) => s + eventVal(accId, ty), 0)
    const actionSum = (accId: string) => actionKeys.reduce((s, k) => s + actionVal(accId, k), 0)
    return { rows, eventTypes, actionKeys, eventActive, actionActive, eventVal, actionVal, eventSum, actionSum }
  }, [triggers])

  if (!model.rows.length) return <Empty />

  return (
    <Scroll>
      <thead>
        <tr>
          <th rowSpan={2} className="sticky left-0 z-20 bg-white mx-sticky-shadow text-left align-bottom font-semibold text-ink/80 px-3 py-3 border-b border-black/10 min-w-[172px]">
            Аккаунт
          </th>
          <th colSpan={model.eventTypes.length + 1} className="px-2.5 py-2.5 border-b border-l-2 border-black/15 text-center mx-head-shadow bg-black/[0.02]">
            <span className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold text-white text-[12.5px] uppercase tracking-wide"
              style={{ background: 'linear-gradient(145deg,#7658ff,#3f2a9e)', boxShadow: '0 4px 12px rgba(102,58,241,0.38), inset 0 1.5px 1px rgba(255,255,255,0.45)' }}>
              Сработало по событиям
            </span>
          </th>
          <th colSpan={model.actionKeys.length + 1} className="px-2.5 py-2.5 border-b border-l-2 border-black/25 text-center mx-head-shadow bg-black/[0.02]">
            <span className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold text-white text-[12.5px] uppercase tracking-wide"
              style={{ background: 'linear-gradient(145deg,#3ad06e,#178041)', boxShadow: '0 4px 12px rgba(31,163,78,0.36), inset 0 1.5px 1px rgba(255,255,255,0.45)' }}>
              Выполнено по действиям
            </span>
          </th>
        </tr>
        <tr>
          {model.eventTypes.map((type, idx) => {
            const m = TYPE_META[type]
            const on = model.eventActive(type)
            return (
              <th key={type}
                className={`px-2.5 py-2 border-b border-black/10 font-medium text-center min-w-[76px] whitespace-nowrap ${idx === 0 ? 'border-l-2 border-black/15' : 'border-l border-black/[0.04]'}`}
                style={{ color: on ? m.color : MUTED, background: on ? hexA(m.color, 0.07) : 'rgba(0,0,0,0.015)' }}>
                <span className="inline-flex items-center gap-1"><m.Icon className="w-3 h-3" />{TYPE_SHORT[type]}</span>
              </th>
            )
          })}
          <th className="px-2.5 py-2 border-b border-black/10 font-semibold text-center min-w-[54px] text-ink/70 bg-black/[0.03]">Σ</th>
          {model.actionKeys.map((k, idx) => {
            const A = ACTION_META[k]
            const on = model.actionActive(k)
            return (
              <th key={k}
                className={`px-2.5 py-2 border-b border-black/10 font-medium text-center min-w-[72px] whitespace-nowrap ${on ? 'text-subt' : 'text-black/25'} ${idx === 0 ? 'border-l-2 border-black/25' : 'border-l border-black/[0.04]'}`}>
                <span className="inline-flex items-center gap-1"><A.Icon className="w-3 h-3" style={{ color: on ? ACT_C[k] : undefined, opacity: on ? 0.85 : 0.5 }} />{A.label}</span>
              </th>
            )
          })}
          <th className="px-2.5 py-2 border-b border-black/10 font-semibold text-center min-w-[54px] text-ink/70 bg-black/[0.03]">Σ</th>
        </tr>
      </thead>
      <tbody>
        {model.rows.map((acc, ri) => (
          <tr key={acc.id} className="mx-row mx-pop hover:bg-brand/[0.03]" style={popStyle(ri)}>
            <td className="sticky left-0 z-10 bg-white mx-sticky-shadow px-3 py-2.5 border-b border-black/[0.05] whitespace-nowrap">
              <AccountChip username={acc.username} />
            </td>
            {model.eventTypes.map((type, idx) => (
              <td key={type} className={`text-center px-2.5 py-2.5 border-b border-black/[0.05] ${idx === 0 ? 'border-l-2 border-black/15' : 'border-l border-black/[0.04]'}`}>
                <AccentNum n={model.eventVal(acc.id, type)} color={TYPE_META[type].color} />
              </td>
            ))}
            <td className="text-center px-2.5 py-2.5 border-b border-black/[0.05] bg-black/[0.02]"><AccentNum n={model.eventSum(acc.id)} /></td>
            {model.actionKeys.map((k, idx) => (
              <td key={k} className={`text-center px-2.5 py-2.5 border-b border-black/[0.05] ${idx === 0 ? 'border-l-2 border-black/25' : 'border-l border-black/[0.04]'}`}>
                <AccentNum n={model.actionVal(acc.id, k)} color={ACT_C[k]} />
              </td>
            ))}
            <td className="text-center px-2.5 py-2.5 border-b border-black/[0.05] bg-black/[0.02]"><AccentNum n={model.actionSum(acc.id)} /></td>
          </tr>
        ))}
      </tbody>
    </Scroll>
  )
}

function Scroll({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-2 px-2 pb-1 rounded-2xl">
      <table className="border-collapse text-[13px]">{children}</table>
    </div>
  )
}
function Empty() {
  return <div className="py-10 text-center text-subt text-[13px]">Пока нет кампаний с аккаунтами</div>
}

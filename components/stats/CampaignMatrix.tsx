'use client'

import { useMemo } from 'react'
import { Check, Minus } from 'lucide-react'
import { readStat, ACTION_KEYS, type ActionKey } from '@/lib/stats'

// Таблица-матрица (как гугл-таблица): СЛЕВА — аккаунты (строки), СВЕРХУ — кампании
// (триггеры) и под ними действия (двухуровневая шапка). В ячейках — сколько РЕАЛЬНО
// выполнилось (галочка + число), с подсказкой «выполнено из попыток». Пусто (—) —
// у аккаунта нет такой кампании.

export interface MxTrigger {
  id: string
  name?: string
  triggerType: string
  actions?: any[]
  stats?: any
  responder?: { id: string; username: string } | null
}
export interface MxAccount { id: string; username: string }

const ACTION_LABELS: Record<ActionKey, string> = {
  dm: 'Директ', like: 'Лайк', follow: 'Подписка', story: 'Сторис', comment: 'Коммент',
}
const TYPE_LABELS: Record<string, string> = {
  NEW_FOLLOWER: 'Новая подписка', NEW_COMMENT: 'Комментарий', NEW_LIKE: 'Лайк', STORY_MENTION: 'Ответ на сторис',
}
// Тип действия из конфига кампании → ключ статистики
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

export function CampaignMatrix({ triggers }: { triggers: MxTrigger[]; accounts?: MxAccount[] }) {
  const model = useMemo(() => {
    // Строки — аккаунты, реально участвующие хотя бы в одной кампании
    const rowMap = new Map<string, string>() // id → username
    for (const t of triggers) if (t.responder) rowMap.set(t.responder.id, t.responder.username)
    const rows = [...rowMap.entries()].map(([id, username]) => ({ id, username }))
      .sort((a, b) => a.username.localeCompare(b.username))

    // Колонки-группы — кампании (по названию), в каждой подколонки = действия
    const groupsMap = new Map<string, MxTrigger[]>()
    for (const t of triggers) {
      const key = t.name || '(без названия)'
      if (!groupsMap.has(key)) groupsMap.set(key, [])
      groupsMap.get(key)!.push(t)
    }

    const groups = [...groupsMap.entries()].map(([name, list]) => {
      const actionKeys = ACTION_KEYS.filter((k) =>
        list.some((t) => configuredKeys(t).has(k)) ||
        list.some((t) => { const s = readStat(t.stats, k); return s.fired > 0 || s.done > 0 })
      )
      // ячейка: суммируем статистику всех триггеров этой кампании у данного аккаунта
      const cell = (accId: string, k: ActionKey) => {
        const rel = list.filter((t) => t.responder?.id === accId)
        if (!rel.length) return null
        return rel.reduce((acc, t) => {
          const s = readStat(t.stats, k)
          return { fired: acc.fired + s.fired, done: acc.done + s.done }
        }, { fired: 0, done: 0 })
      }
      const totalDone = list.reduce((sum, t) => sum + ACTION_KEYS.reduce((ss, k) => ss + readStat(t.stats, k).done, 0), 0)
      return { name, type: list[0]?.triggerType, actionKeys, cell, totalDone }
    })
      .filter((g) => g.actionKeys.length > 0)
      .sort((a, b) => b.totalDone - a.totalDone)

    // Итог по аккаунту (сумма done по всем кампаниям/действиям)
    const rowTotal = (accId: string) =>
      groups.reduce((sum, g) => sum + g.actionKeys.reduce((ss, k) => ss + (g.cell(accId, k)?.done ?? 0), 0), 0)

    return { rows, groups, rowTotal }
  }, [triggers])

  if (!model.groups.length || !model.rows.length) {
    return <div className="py-8 text-center text-subt text-[13px]">Пока нет кампаний с аккаунтами</div>
  }

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="border-collapse text-[13px]">
        <thead>
          {/* Уровень 1: кампании (растянуты на свои действия) */}
          <tr>
            <th rowSpan={2} className="sticky left-0 z-10 bg-white text-left align-bottom font-semibold text-ink/80 px-3 py-2 border-b border-black/10 min-w-[150px]">
              Аккаунт
            </th>
            {model.groups.map((g) => (
              <th key={g.name} colSpan={g.actionKeys.length}
                className="px-2.5 py-2 border-b border-l-2 border-black/10 bg-brand/[0.06] text-center">
                <div className="font-semibold text-ink truncate max-w-[220px] mx-auto" title={g.name}>{g.name}</div>
                <div className="text-[11px] text-subt font-normal">{TYPE_LABELS[g.type] ?? g.type}</div>
              </th>
            ))}
            <th rowSpan={2} className="px-3 py-2 border-b border-l-2 border-black/10 text-center align-bottom font-semibold text-ink/80 min-w-[64px]">
              Итого
            </th>
          </tr>
          {/* Уровень 2: действия */}
          <tr>
            {model.groups.flatMap((g) =>
              g.actionKeys.map((k, idx) => (
                <th key={g.name + k}
                  className={`px-2.5 py-1.5 border-b border-black/10 font-medium text-subt whitespace-nowrap text-center min-w-[68px] ${idx === 0 ? 'border-l-2 border-black/10' : 'border-l border-black/[0.04]'}`}>
                  {ACTION_LABELS[k]}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((acc) => (
            <tr key={acc.id} className="hover:bg-black/[0.015]">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-b border-black/[0.04] font-medium whitespace-nowrap">
                @{acc.username}
              </td>
              {model.groups.flatMap((g) =>
                g.actionKeys.map((k, idx) => (
                  <td key={g.name + k}
                    className={`text-center px-2.5 py-1.5 border-b border-black/[0.04] ${idx === 0 ? 'border-l-2 border-black/10' : 'border-l border-black/[0.04]'}`}>
                    <Cell v={g.cell(acc.id, k)} />
                  </td>
                ))
              )}
              <td className="text-center px-3 py-1.5 border-b border-black/[0.04] border-l-2 border-black/10 font-semibold tabular-nums">
                {model.rowTotal(acc.id) || <span className="text-black/25">0</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({ v }: { v: { fired: number; done: number } | null }) {
  if (!v) return <Minus className="w-3.5 h-3.5 text-black/15 mx-auto" />
  if (v.done > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-ok font-semibold tabular-nums" title={`Выполнено ${v.done} из ${v.fired}`}>
        <Check className="w-3.5 h-3.5" />{v.done}
      </span>
    )
  }
  if (v.fired > 0) {
    return <span className="text-warn font-medium tabular-nums" title={`${v.fired} попыток, 0 успешных`}>0/{v.fired}</span>
  }
  return <span className="text-black/25 tabular-nums">0</span>
}

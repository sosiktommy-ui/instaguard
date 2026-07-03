// Единый формат статистики действий кампании (триггера).
//
// Каждое действие хранит ДВА числа:
//   fired — сколько раз действие СРАБОТАЛО (мы попытались его выполнить),
//   done  — сколько раз ВЫПОЛНИЛОСЬ успешно.
// Разрыв fired − done = сколько раз не удалось (личка закрыта, нет поста для
// лайка, не прошла подписка, дневной лимит и т.п.). Именно это владелец просил
// показывать: триггер сработал, а действие могло не выполниться.
//
// Обратная совместимость: раньше stats хранил ПЛОСКОЕ число (только успехи),
// напр. { dm: 12 }. Такое значение читаем как { fired: 12, done: 12 }.

export const ACTION_KEYS = ['dm', 'like', 'follow', 'story', 'comment'] as const
export type ActionKey = (typeof ACTION_KEYS)[number]
export interface ActionStat {
  fired: number
  done: number
}

// Нормализует значение одного действия из любого формата в { fired, done }.
export function readStat(stats: any, key: string): ActionStat {
  const v = stats?.[key]
  if (v == null) return { fired: 0, done: 0 }
  if (typeof v === 'number') return { fired: v, done: v } // легаси: считали только успехи
  return { fired: Number(v.fired) || 0, done: Number(v.done) || 0 }
}

// Сливает прибавки попыток(fired)/успехов(done) в текущий stats и возвращает
// готовый объект для записи (легаси-числа апгрейдит в { fired, done }).
export function mergeStatsMap(
  cur: any,
  incFired: Record<string, number>,
  incDone: Record<string, number>,
): Record<string, ActionStat> {
  const keys = new Set<string>([
    ...Object.keys(cur ?? {}),
    ...Object.keys(incFired ?? {}),
    ...Object.keys(incDone ?? {}),
  ])
  const out: Record<string, ActionStat> = {}
  for (const k of keys) {
    const base = readStat(cur, k)
    out[k] = {
      fired: base.fired + (incFired?.[k] || 0),
      done: base.done + (incDone?.[k] || 0),
    }
  }
  return out
}

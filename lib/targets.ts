import { MAX_NEW_PER_POLL } from '@/lib/limits'

// Выбор новых целей для обработки. Вынесено из app/api/poll/route.ts
// (чистая логика, юнит-тестируется — §10.1 PLAN-IDEAL).

/**
 * Выбирает НОВЫЕ цели и помечает «известными» ТОЛЬКО обработанные (+ всю базу на
 * первом проходе). Раньше все найденные разом падали в снапшот → всё сверх
 * MAX_NEW_PER_POLL молча терялось (помечалось «видели», но действие не выполнялось).
 * Теперь лишние остаются «новыми» и добираются в следующих циклах (в пределах лимитов).
 */
export function selectTargets<T>(
  all: T[],
  known: Set<string>,
  hadBaseline: boolean,
  pkOf: (x: T) => string,
): { fresh: T[]; process: T[] } {
  if (!hadBaseline) { all.forEach((x) => { const k = pkOf(x); if (k) known.add(k) }); return { fresh: [], process: [] } }
  const fresh = all.filter((x) => { const k = pkOf(x); return Boolean(k) && !known.has(k) })
  const process = fresh.slice(0, MAX_NEW_PER_POLL)
  process.forEach((x) => known.add(pkOf(x)))
  return { fresh, process }
}

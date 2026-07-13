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
  limit: number = MAX_NEW_PER_POLL,
): { fresh: T[]; process: T[] } {
  if (!hadBaseline) { all.forEach((x) => { const k = pkOf(x); if (k) known.add(k) }); return { fresh: [], process: [] } }
  const fresh = all.filter((x) => { const k = pkOf(x); return Boolean(k) && !known.has(k) })
  // limit — сколько новых обработать за ЭТОТ цикл (остальные остаются «свежими» и добьются в
  // следующих циклах, НЕ помечаются известными). Дефолт — жёсткий MAX_NEW_PER_POLL; poll обычно
  // передаёт МАЛЕНЬКИЙ рандомный «дрип» (2–4), чтобы пачка новых не улетела залпом = анти-спам.
  const cap = Math.max(1, Math.min(MAX_NEW_PER_POLL, Math.floor(limit)))
  const process = fresh.slice(0, cap)
  process.forEach((x) => known.add(pkOf(x)))
  return { fresh, process }
}

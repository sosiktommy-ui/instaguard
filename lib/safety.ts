import { loadCounters, DAILY_CAPS, type ActionKind } from '@/lib/limits'

// «Индекс безопасности» аккаунта (0–100) — насколько он защищён от бана прямо сейчас.
// Складывается из статуса, ошибок подряд, запаса по дневным лимитам и наличия прокси.
// Чистая функция, данные уже есть в /api/accounts.

export interface Safety { score: number; label: string; color: string; reasons: string[] }

const CAP_ORDER: ActionKind[] = ['dm', 'follow', 'like', 'comment', 'story']

export function securityIndex(acc: {
  status?: string | null
  errorCount?: number | null
  limits?: unknown
  proxy?: string | null
}): Safety {
  const reasons: string[] = []
  let score = 100

  const status = acc.status ?? 'ACTIVE'
  if (status === 'BLOCKED') { score = Math.min(score, 8); reasons.push('аккаунт заблокирован') }
  else if (status === 'CHALLENGE') { score = Math.min(score, 12); reasons.push('требуется вход (challenge)') }
  else if (status === 'PAUSED') { score = Math.min(score, 55); reasons.push('на паузе') }

  const errs = acc.errorCount ?? 0
  if (errs > 0) { score -= Math.min(40, errs * 12); reasons.push(`ошибок подряд: ${errs}`) }

  // Дневная загрузка: чем ближе к суточным лимитам, тем выше риск ограничений
  const c = loadCounters(acc.limits) as any
  let maxPct = 0
  for (const k of CAP_ORDER) {
    const cap = DAILY_CAPS[k]
    const used = Number(c[k]) || 0
    if (cap) maxPct = Math.max(maxPct, Math.min(100, (used / cap) * 100))
  }
  if (maxPct > 0) {
    score -= Math.round(maxPct * 0.35)
    if (maxPct >= 70) reasons.push(`дневные лимиты почти исчерпаны (${Math.round(maxPct)}%)`)
  }

  if (!acc.proxy) { score -= 20; reasons.push('нет прокси') }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const label = score >= 80 ? 'Защищён' : score >= 60 ? 'Норма' : score >= 35 ? 'Риск' : 'Опасно'
  const color = score >= 60 ? '#34c759' : score >= 35 ? '#ff9500' : '#ff3b30'
  return { score, label, color, reasons }
}

/**
 * Суточный ритм активности аккаунта (антидетект PLAN-IDEAL §1.6/1.7).
 * Действуем ТОЛЬКО в «дневные» часы по таймзоне аккаунта, с per-account-per-day разбросом
 * границ окна и редкими «выходными». Ночью — тишина. Это один из главных вкладов в выживание:
 * живой человек не лайкает/не пишет директы в 4 утра по своему времени, а бот 24/7 — палится.
 *
 * Таймзона берётся из InstagramAccount.timezoneId (проставляется по гео прокси при входе).
 * Если tz неизвестна — НЕ гейтим (редкий случай, закроется, когда tz будет ставиться всем, D5).
 */

// Детерминированный 0..1 по строке (FNV-1a) — чтобы окно/выходной были стабильны в течение дня,
// но разные у разных аккаунтов и разные день ото дня.
function seed01(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

// Локальный час (0..23) в заданной таймзоне. null — если tz не распознана.
function localHour(timezoneId: string, now: Date): number | null {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: timezoneId, hour: 'numeric', hour12: false }).format(now)
    const h = parseInt(s, 10)
    return Number.isFinite(h) ? h % 24 : null
  } catch {
    return null
  }
}

export interface ActivityWindow {
  active: boolean
  reason?: 'quiet-hours' | 'rest-day'
  localHour?: number
}

/**
 * Активен ли аккаунт ПРЯМО СЕЙЧАС по своему суточному ритму.
 * - «Выходной»: ~1 день из 12 аккаунт почти не активен (человек тоже не каждый день онлайн).
 * - Окно активности: старт 7–9, конец 22–24 по локали (границы с суточным разбросом на аккаунт).
 * - Вне окна → тишина.
 */
export function activityWindow(
  timezoneId: string | null | undefined,
  username: string,
  now: Date = new Date(),
): ActivityWindow {
  if (!timezoneId) return { active: true } // tz неизвестна — не гейтим
  const h = localHour(timezoneId, now)
  if (h === null) return { active: true }

  const day = now.toISOString().slice(0, 10)
  if (seed01(`${username}:${day}:rest`) < 0.08) return { active: false, reason: 'rest-day', localHour: h }

  const start = 7 + Math.floor(seed01(`${username}:${day}:start`) * 3) // 7,8,9
  const end = 22 + Math.floor(seed01(`${username}:${day}:end`) * 3) // 22,23,24
  const active = h >= start && h < end
  return active ? { active: true, localHour: h } : { active: false, reason: 'quiet-hours', localHour: h }
}

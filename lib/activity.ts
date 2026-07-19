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
  reason?: 'quiet-hours' | 'rest-day' | 'off-peak-lull'
  localHour?: number
}

// §6.1 «пики утро/вечер»: относительная ИНТЕНСИВНОСТЬ активности по локальному часу (0..1). Живой
// человек кучкует активность на утро (8–11) и вечер (18–22), спадает в обед/поздно. НЕ обнуляем нигде
// внутри окна (пол ≥0.5), чтобы не «замолкать» надолго — лишь СНИЖАЕМ шанс активности вне пиков.
function hourIntensity(h: number): number {
  if (h >= 8 && h <= 11) return 1.0    // утренний пик
  if (h >= 18 && h <= 21) return 1.0   // вечерний пик
  if (h >= 12 && h <= 14) return 0.75  // обед — умеренно
  if (h === 7 || h === 17 || h === 22) return 0.7  // плечи окна
  if (h >= 15 && h <= 16) return 0.6   // послеобеденный спад
  return 0.5                           // ранние/поздние края окна
}

/**
 * Активен ли аккаунт ПРЯМО СЕЙЧАС по своему суточному ритму.
 * - «Выходной»: ~1 день из 12 аккаунт почти не активен (человек тоже не каждый день онлайн).
 * - Окно активности: старт 7–9, конец 22–24 по локали (границы с суточным разбросом на аккаунт).
 * - Вне окна → тишина.
 * - Внутри окна — ПИКИ утро/вечер (§6.1): в непиковый час с вероятностью (1−intensity) берём «лулл»
 *   (человек отошёл). Решение стабильно в пределах ЧАСА (seed по часу) — не мигает между опросами;
 *   пропущенное событие подхватится следующим опросом (не теряется). Ручной запуск это НЕ гейтит.
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
  if (h < start || h >= end) return { active: false, reason: 'quiet-hours', localHour: h }

  // Внутри окна: непиковые часы иногда «отдыхают» (кластеризация активности к пикам).
  const intensity = hourIntensity(h)
  if (intensity < 1 && seed01(`${username}:${day}:${h}:lull`) > intensity) {
    return { active: false, reason: 'off-peak-lull', localHour: h }
  }
  return { active: true, localHour: h }
}

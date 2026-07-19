// Простой in-memory ограничитель частоты по ключу (обычно IP) — ПЕРВЫЙ рубеж против брутфорса
// пароля и спама аккаунтов на публичных роутах (/api/auth/login, /register). PLAN-MASTER §10.1.
//
// Живёт в памяти процесса Next.js (`next start` — долгоживущий процесс, тот же, где крутится
// setInterval-поллинг): сбрасывается на редеплое и НЕ делится между инстансами. Сейчас инстанс
// один, поэтому этого достаточно как первый слой; для распределённого лимита на масштабе —
// вынести окно в Redis (§9.2). Фиксированное окно (не скользящее) — проще и достаточно для цели.

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

// Периодическая чистка протухших вёдер — иначе обстрел с тысяч разных IP растит Map без предела.
let lastSweep = 0
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}

/**
 * Учесть попытку под ключом. Возвращает { ok:false, retryAfter } если лимит в текущем окне исчерпан.
 * @param key    уникальный ключ (например `login:1.2.3.4`)
 * @param limit  максимум попыток в окне
 * @param windowMs длительность окна в мс
 */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now()
  sweep(now)
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfter: 0 }
  }
  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) }
  }
  b.count++
  return { ok: true, retryAfter: 0 }
}

// Клиентский IP из заголовков (Railway/прокси ставит x-forwarded-for; первый адрес — реальный клиент).
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

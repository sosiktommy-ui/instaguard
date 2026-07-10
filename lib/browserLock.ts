// §4.8 [T5] — МЕЖПРОЦЕССНЫЙ per-account лок на браузерную сессию.
// poll (веб-процесс) и dm-воркер (instrumentation) пишут `browserState` ОДНОГО аккаунта из
// РАЗНЫХ процессов. Без сериализации «свежая» сессия одного затирается «старой» другого
// (dm-воркер к тому же берёт browserState из job.data, снятый в момент постановки в очередь —
// он мог устареть за десятки минут ожидания). Реюзаем механизм AppLock (как глобальный
// `poll:all`): атомарный updateMany по (key, lockedUntil<now) — работает без Redis, из обоих
// процессов через их Prisma-клиент. Лизинг с запасом (браузерная секция поллинга может тянуться
// долго из-за пауз между комментами §1.6/[A2]); при краше держателя — лок авто-истекает.

type LockDb = {
  appLock: {
    upsert(args: any): Promise<unknown>
    updateMany(args: any): Promise<{ count: number }>
    update(args: any): Promise<unknown>
  }
}

// Запас на худший случай одной браузерной секции аккаунта: до ~12 комментов × пауза 40–90с
// ([A2]) + прогрев. Не меньше, иначе лизинг истечёт посреди секции и второй процесс влезет.
export const BROWSER_LOCK_LEASE_MS = 30 * 60 * 1000

const keyOf = (accountId: string) => `browser:${accountId}`

// true — эксклюзив получен (никто другой сейчас не работает с сессией этого аккаунта).
// false — занято (истёкший лок перехватывается атомарно; свободный/несуществующий — берётся).
export async function acquireBrowserLock(db: LockDb, accountId: string, leaseMs = BROWSER_LOCK_LEASE_MS): Promise<boolean> {
  const key = keyOf(accountId)
  await db.appLock.upsert({ where: { key }, create: { key, lockedUntil: new Date(0) }, update: {} }).catch(() => {})
  const now = new Date()
  const r = await db.appLock
    .updateMany({ where: { key, lockedUntil: { lt: now } }, data: { lockedUntil: new Date(now.getTime() + leaseMs) } })
    .catch(() => ({ count: 0 }))
  return (r as { count: number }).count === 1
}

// Освобождение — как у `poll:all`: выставляем lockedUntil в прошлое. Токена нет (нет колонки),
// поэтому лизинг выбран заведомо длиннее любой реальной операции — гонки «освободил чужой лок»
// на практике не возникает (держатель всегда успевает release раньше истечения).
export async function releaseBrowserLock(db: LockDb, accountId: string): Promise<void> {
  await db.appLock.update({ where: { key: keyOf(accountId) }, data: { lockedUntil: new Date(0) } }).catch(() => {})
}

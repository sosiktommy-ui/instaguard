import { mergeStatsMap, logMeta } from './lib/stats'
import { runFollowerActionsBrowser } from './lib/browser/actions'
import { acquireBrowserLock, releaseBrowserLock } from './lib/browserLock'
import { recordDelivery } from './lib/delivery'

// ── Авто-поллинг: Redis-НЕЗАВИСИМЫЙ heartbeat ────────────────────────────────
// Раньше авто-проверку крутил повторяющийся BullMQ-job (нужен Redis). Если Redis в
// проде не задан/недоступен — авто-проверка молча не работала (жалоба «17 ч назад»
// при интервале 1 ч). Теперь тик даёт простой setInterval в самом Node-процессе
// (`next start` — долгоживущий процесс). Пер-аккаунт интервал (§10) и глобальный лок
// (`poll:all`) в самом /api/poll защищают от лишней/двойной работы, так что частый
// тик безопасен. BullMQ остаётся только для очереди отложенных DM (когда Redis есть).
const POLL_TICK_MS = 30 * 60 * 1000
let heartbeatStarted = false
function startPollHeartbeat() {
  if (heartbeatStarted) return
  heartbeatStarted = true
  const tick = async () => {
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? (railwayDomain ? `https://${railwayDomain}` : null) ?? 'http://localhost:3000'
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20 * 60 * 1000)
    try {
      const res = await fetch(`${baseUrl}/api/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET ?? 'instaguard-internal-cron' },
        body: '{}', signal: ctrl.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (data?.busy) { console.log('[heartbeat] — пропуск: предыдущий цикл ещё идёт'); return }
      const total = (data?.summary ?? []).reduce((s: number, r: any) => s + (r.dmsQueued ?? 0), 0)
      console.log(`[heartbeat] ✓ авто-проверка выполнена, поставлено DM: ${total}`)
    } catch (e: any) {
      console.error('[heartbeat] ✗ авто-проверка не удалась:', e?.name === 'AbortError' ? 'таймаут 20 мин' : e?.message)
    } finally { clearTimeout(timer) }
  }
  setTimeout(tick, 60 * 1000)        // первый прогон через минуту после старта (сервер успел подняться)
  setInterval(tick, POLL_TICK_MS)    // далее — каждые 30 минут, независимо от Redis
  console.log('[heartbeat] авто-проверка запущена (setInterval, каждые 30 мин)')
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Мультитенант (план A): авто-сид «владельца» убран — пользователи создаются
  // через публичную регистрацию (/register). Раньше здесь первый юзер БД
  // насильно перезаписывался email/паролем из переменных Railway (костыль под
  // однопользовательский режим) — это ломало изоляцию по userId.
  if (!process.env.JWT_SECRET) {
    console.warn('[auth] JWT_SECRET is NOT set — using insecure fallback. Set JWT_SECRET in Railway!')
  }

  // Авто-проверка запускается ВСЕГДА (не зависит от Redis) — главный фикс «авто-проверка не работает».
  startPollHeartbeat()

  // ── BullMQ: воркер отправки отложенных DM (нужен Redis; авто-проверку он больше НЕ крутит) ──
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.warn('[bullmq] REDIS_URL not set — очередь отложенных DM отключена (авто-проверка работает через heartbeat)')
    return
  }

  try {
    const { Worker, Queue } = await import(/* webpackIgnore: true */ 'bullmq')
    const { PrismaClient } = await import(/* webpackIgnore: true */ '@prisma/client')
    const prisma = new PrismaClient()
    const connection = { url: redisUrl }
    // Очередь для БОГРАНИЧЕННОГО повтора директа при ТРАНЗИЕНТНОМ сбое сети/прокси (см. ниже).
    // Отдельно от лок-повтора (тот убран в 2026-07-11): здесь повтор с задержкой и лимитом попыток,
    // чтобы «прокси моргнул» не терял директ навсегда (подписчик уже помечен известным в снапшоте).
    const dmSendQueue = new Queue('dm-send', { connection })
    // Транзиентный сбой сети/прокси (блип резидентного прокси), а НЕ логический исход/бан.
    const TRANSIENT_DM = /network|моргн|timeout|таймаут|econnreset|econnrefused|tunnel|socket hang up|не ответил|net::/i
    const DM_MAX_RETRIES = 2

    // ── Воркер отправки DM (с задержкой из очереди) ──────────────────────────
    new Worker(
      'dm-send',
      async (job) => {
        // ── Браузерный движок (эмуль): действия по username через Chromium (plan §4.6). ──
        // Изолировано от legacy: включается только при engine==='browser' и наличии browserState.
        {
          const d = job.data as any
          if (d.engine === 'browser' && d.browserState) {
            // §4.8 — стараемся взять эксклюзив сессии (не пересекаться с poll по записи browserState),
            // но НЕ ценой отмены директа. Раньше джоб откладывался 8× и ОТМЕНЯЛСЯ («сессия долго
            // занята») → директы терялись. Теперь: несколько коротких попыток, и если лок занят —
            // шлём ВСЁ РАВНО (доставка важнее «чистоты» сессии; свежий browserState перечитываем
            // ниже, worst case — гонка keep-alive записи, а не потеря DM). Лизинг короткий (5 мин).
            let held = false
            for (let i = 0; i < 4 && !held; i++) {
              held = await acquireBrowserLock(prisma, d.accountId, 5 * 60 * 1000)
              if (!held && i < 3) await new Promise((r) => setTimeout(r, 4000 + Math.random() * 6000))
            }
            if (!held) console.log(`[dm-worker/browser] сессия занята — отправляю всё равно (best-effort) → @${d.followerUsername}`)
            try {
              // §4.8 — берём САМЫЙ свежий browserState из БД: d.browserState снят при постановке
              // в очередь и мог устареть за время ожидания (иначе действие пойдёт по старой сессии
              // и затрёт актуальную, накопленную прогревом/другими джобами).
              const fresh = await prisma.instagramAccount.findUnique({ where: { id: d.accountId }, select: { browserState: true, status: true } }).catch(() => null)
              // 🛡️ БАН-SAFETY (аудит #3): если аккаунт УЖЕ остановлен (предыдущий джоб этой же очереди
              // поймал challenge/action-block/бан и выставил status), НЕ выполняем остальные очередные
              // директы — иначе продолжаем долбить Instagram уже ограниченным аккаунтом и углубляем бан.
              // В inline-пути стоп-на-блоке уже есть (poll STOP-ON-BLOCK), а очередь его не имела.
              if (fresh?.status === 'CHALLENGE' || fresh?.status === 'PAUSED') {
                console.log(`[dm-worker/browser] аккаунт остановлен (${fresh.status}) — пропуск @${d.followerUsername} (не долбим IG)`)
                return
              }
              const r = await runFollowerActionsBrowser({
                browserState: (fresh?.browserState ?? d.browserState) as any, ownerUsername: d.ownerUsername, proxy: d.proxy,
                locale: d.locale, timezoneId: d.timezoneId,
                followerUsername: d.followerUsername, text: d.text || undefined, image: d.image || undefined,
                doFollow: d.doFollow, doLike: d.doLike, likeCount: d.likeCount, viewStories: d.viewStories,
                storyLike: d.storyLike, storyCount: d.storyCount,
                fallbackFollow: d.fallbackFollow, fallbackLike: d.fallbackLike,
              })
              if (r.browserState) await prisma.instagramAccount.update({ where: { id: d.accountId }, data: { browserState: r.browserState as any } }).catch(() => null)
              // §4.6 — исход доставки директа в дневной счётчик (под browserLock — гонки с poll нет).
              if (r.incFired.dm) await recordDelivery(prisma, d.accountId, r.incFired.dm, r.incDone.dm || 0, Date.now())
              const attempted = Object.keys(r.incFired).length > 0
              const success = Object.keys(r.incDone).length > 0
              const impossible = r.impossible ?? []
              const hardError = r.errors.length > 0
              // ПОВТОР ДИРЕКТА при ТРАНЗИЕНТНОМ сбое сети/прокси: директ был нужен (d.text), но не
              // доставлен (incDone.dm пуст), ошибка — сетевой блип (не бан/челлендж), и лимит попыток
              // не исчерпан. Иначе блип «прокси моргнул» терял директ навсегда (подписчик уже помечен
              // известным в снапшоте poll → не ретраится). Повтор — ТОЛЬКО директом (уже выполненные
              // follow/like/story отключаем, чтобы не повторять их).
              const dmIntended = Boolean(d.text)
              const dmDone = Boolean((r.incDone as any).dm)
              const willRetryDm = dmIntended && !dmDone && !r.brk
                && (d.retryCount || 0) < DM_MAX_RETRIES
                && TRANSIENT_DM.test(r.errors.join(' '))
              // §13.10 — «невозможно» (0 постов/0 сторис) НЕ ошибка; триггер сработал, если что-то
              // выполнено ИЛИ единственная помеха — невозможность действия (без реальных ошибок).
              // При willRetryDm НЕ инкрементим fireCount сейчас — досчитаем на итоговой попытке директа
              // (иначе двойной счёт: follow сейчас + директ на повторе).
              const fired = !willRetryDm && (success || (impossible.length > 0 && !hardError))
              if (attempted) {
                const cur = await prisma.triggerRule.findUnique({ where: { id: d.triggerId }, select: { stats: true } }).catch(() => null)
                const parts: string[] = []
                if (r.errors.length) parts.push(r.errors.join('; '))
                if (impossible.length) parts.push(`невозможно: ${impossible.join('; ')}`)
                const tail = parts.length ? ` (${parts.join('; ')})` : ''
                const retryTail = willRetryDm ? ` — директ не ушёл (сеть/прокси), повтор через ~1.5 мин (попытка ${(d.retryCount || 0) + 2}/${DM_MAX_RETRIES + 1})` : ''
                const level = willRetryDm ? 'WARN' : (success ? (hardError ? 'WARN' : 'SUCCESS') : (hardError ? 'ERROR' : 'WARN'))
                const meta = logMeta(d.triggerType, success ? Object.keys(r.incDone) : [])
                const message = success
                  ? `Сработал триггер «${d.triggerName}» → @${d.followerUsername}${meta}${tail}${retryTail}`
                  : (hardError
                    ? `Триггер «${d.triggerName}» → @${d.followerUsername}: ${willRetryDm ? 'директ будет повторён' : 'действия не выполнены'}${meta}${tail}${retryTail}`
                    : `Триггер «${d.triggerName}» → @${d.followerUsername}: действие невозможно${meta}${tail}`)
                await Promise.all([
                  prisma.log.create({ data: { accountId: d.accountId, level, message } }),
                  // fireCount — при выполненном действии ИЛИ при «невозможно» без ошибок (§13.10);
                  // реальный провал (директ не ушёл / таймаут) не считается.
                  prisma.triggerRule.update({ where: { id: d.triggerId }, data: { ...(fired ? { fireCount: { increment: 1 } } : {}), stats: mergeStatsMap(cur?.stats ?? {}, r.incFired, r.incDone) as any } }),
                ])
              }
              // Ставим повтор ТОЛЬКО директа (выполненные действия отключены) с задержкой — прокси успеет
              // восстановиться; бюджет попыток ограничен DM_MAX_RETRIES (не бесконечный цикл).
              if (willRetryDm) {
                await dmSendQueue.add('dm', {
                  ...d,
                  retryCount: (d.retryCount || 0) + 1,
                  doFollow: d.doFollow && !(r.incDone as any).follow,
                  doLike: d.doLike && !(r.incDone as any).like,
                  viewStories: d.viewStories && !(r.incDone as any).story,
                  fallbackFollow: false, fallbackLike: false,
                }, { delay: 90_000, removeOnComplete: true, removeOnFail: true }).catch(() => null)
              }
              if (r.brk) await prisma.instagramAccount.update({ where: { id: d.accountId }, data: { status: r.brk as any } }).catch(() => null)
              console.log(`[dm-worker/browser] ${success ? '✓ выполнено' : '⚠ без выполнения'} → @${d.followerUsername}`)
            } finally {
              if (held) await releaseBrowserLock(prisma, d.accountId)
            }
            return
          }
          // Нет browserState — браузером действовать нечем (legacy/Python удалён, Фаза V).
          // poll такие джобы не ставит; это страховка от «протёкшего» старого джоба.
          console.warn(`[dm-worker] пропуск @${d.followerUsername}: нет browserState (нужен повторный вход браузером)`)
          return
        }
      },
      {
        connection,
        concurrency: 1, // один DM за раз — безопаснее для аккаунта
      }
    ).on('failed', async (job, err) => {
      if (!job) return
      const { accountId, followerUsername } = job.data
      // Предохранитель: при challenge/бане/ограничении ставим аккаунт на паузу
      const m = (err.message || '').toLowerCase()
      const brk = /challenge|checkpoint|verify/.test(m) ? 'CHALLENGE'
        : /feedback_required|feedbackrequired|spam|blocked|action.?block|429|login_required|please wait|few minutes/.test(m) ? 'PAUSED'
        : null
      await Promise.all([
        prisma.log.create({
          data: { accountId, level: 'ERROR', message: `Ошибка DM @${followerUsername}: ${err.message}${brk ? ` → аккаунт остановлен (${brk})` : ''}` },
        }).catch(() => null),
        brk ? prisma.instagramAccount.update({ where: { id: accountId }, data: { status: brk as any } }).catch(() => null) : Promise.resolve(),
      ])
      console.error(`[dm-worker] ✗ DM to @${followerUsername} failed:`, err.message)
    })

    // Авто-поллинг теперь через Redis-независимый heartbeat (startPollHeartbeat выше) —
    // здесь остаётся только очередь отложенных DM.
    console.log('[bullmq] dm-send worker started (авто-проверка — через heartbeat)')
  } catch (e) {
    console.error('[bullmq] init failed:', e)
  }
}

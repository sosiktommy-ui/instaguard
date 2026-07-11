import { mergeStatsMap } from './lib/stats'
import { runFollowerActionsBrowser } from './lib/browser/actions'
import { acquireBrowserLock, releaseBrowserLock } from './lib/browserLock'
import { recordDelivery } from './lib/delivery'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Мультитенант (план A): авто-сид «владельца» убран — пользователи создаются
  // через публичную регистрацию (/register). Раньше здесь первый юзер БД
  // насильно перезаписывался email/паролем из переменных Railway (костыль под
  // однопользовательский режим) — это ломало изоляцию по userId.
  if (!process.env.JWT_SECRET) {
    console.warn('[auth] JWT_SECRET is NOT set — using insecure fallback. Set JWT_SECRET in Railway!')
  }

  // ── BullMQ: воркер отправки DM + авто-поллинг ─────────────────────────────
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.warn('[bullmq] REDIS_URL not set — auto-poll and delayed DMs disabled')
    return
  }

  try {
    const { Worker, Queue } = await import(/* webpackIgnore: true */ 'bullmq')
    const { PrismaClient } = await import(/* webpackIgnore: true */ '@prisma/client')
    const prisma = new PrismaClient()
    const connection = { url: redisUrl }

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
              const fresh = await prisma.instagramAccount.findUnique({ where: { id: d.accountId }, select: { browserState: true } }).catch(() => null)
              const r = await runFollowerActionsBrowser({
                browserState: (fresh?.browserState ?? d.browserState) as any, ownerUsername: d.ownerUsername, proxy: d.proxy,
                locale: d.locale, timezoneId: d.timezoneId,
                followerUsername: d.followerUsername, text: d.text || undefined, image: d.image || undefined,
                doFollow: d.doFollow, doLike: d.doLike, viewStories: d.viewStories, storyLike: d.storyLike,
                fallbackFollow: d.fallbackFollow, fallbackLike: d.fallbackLike,
              })
              if (r.browserState) await prisma.instagramAccount.update({ where: { id: d.accountId }, data: { browserState: r.browserState as any } }).catch(() => null)
              // §4.6 — исход доставки директа в дневной счётчик (под browserLock — гонки с poll нет).
              if (r.incFired.dm) await recordDelivery(prisma, d.accountId, r.incFired.dm, r.incDone.dm || 0, Date.now())
              const attempted = Object.keys(r.incFired).length > 0
              const success = Object.keys(r.incDone).length > 0
              if (attempted) {
                const cur = await prisma.triggerRule.findUnique({ where: { id: d.triggerId }, select: { stats: true } }).catch(() => null)
                const level = success ? (r.errors.length ? 'WARN' : 'SUCCESS') : 'ERROR'
                const message = success
                  ? `Сработал триггер «${d.triggerName}» → @${d.followerUsername}${r.errors.length ? ` (частично: ${r.errors.join('; ')})` : ''}`
                  : `Триггер «${d.triggerName}» → @${d.followerUsername}: действия не выполнены${r.errors.length ? ` (${r.errors.join('; ')})` : ''}`
                await Promise.all([
                  prisma.log.create({ data: { accountId: d.accountId, level, message } }),
                  // fireCount («срабатывание») — ТОЛЬКО при реально выполненном действии (success),
                  // не по факту попытки: иначе провал (директ не ушёл) ложно читался как «сработал».
                  prisma.triggerRule.update({ where: { id: d.triggerId }, data: { ...(success ? { fireCount: { increment: 1 } } : {}), stats: mergeStatsMap(cur?.stats ?? {}, r.incFired, r.incDone) as any } }),
                ])
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

    // ── Авто-поллинг каждые 30 минут ─────────────────────────────────────────
    const pollQueue = new Queue('auto-poll', { connection })

    // Добавляем повторяющийся job (дедуплицируется по jobId)
    await pollQueue.add(
      'poll-all',
      {},
      { repeat: { every: 30 * 60 * 1000 }, jobId: 'auto-poll-recurring' }
    )

    new Worker(
      'auto-poll',
      async () => {
        const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL
          ?? (railwayDomain ? `https://${railwayDomain}` : null)
          ?? 'http://localhost:3000'
        // Бэкстоп-таймаут на весь цикл поллинга (сам поллинг ограничен пер-аккаунт
        // таймаутами воркера, но подстрахуемся, чтобы job не висел вечно).
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 20 * 60 * 1000)
        try {
          const res = await fetch(`${baseUrl}/api/poll`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Секрет для прохождения middleware (внутренний вызов без куки)
              'x-internal-secret': process.env.INTERNAL_SECRET ?? 'instaguard-internal-cron',
            },
            body: '{}',
            signal: ctrl.signal,
          })
          const data = await res.json()
          if (data.busy) { console.log('[auto-poll] — пропуск: предыдущий цикл ещё идёт'); return }
          const total = (data.summary ?? []).reduce((s: number, r: any) => s + (r.dmsQueued ?? 0), 0)
          console.log(`[auto-poll] ✓ done, queued ${total} DMs`)
        } catch (e: any) {
          console.error('[auto-poll] ✗ failed:', e?.name === 'AbortError' ? 'таймаут 20 мин' : e.message)
        } finally {
          clearTimeout(timer)
        }
      },
      { connection }
    )

    console.log('[bullmq] dm-send worker + auto-poll (every 30 min) started')
  } catch (e) {
    console.error('[bullmq] init failed:', e)
  }
}

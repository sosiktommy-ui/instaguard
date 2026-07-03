import { mergeStatsMap } from './lib/stats'

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
        const {
          sessionData, accountId, triggerId, triggerName,
          followerPk, followerUsername, text, image, doFollow, doLike,
          viewStories, storyLike, proxy,
          fallbackFollow, fallbackLike,
        } = job.data
        // Все действия (DM/фото/подписка/лайк/сторис) выполняет основной аккаунт — сессия sessionData

        const workerUrl = process.env.PYTHON_WORKER_URL ?? 'http://localhost:8001'
        const workerSecret = process.env.PYTHON_WORKER_SECRET ?? ''

        const call = async (path: string, body: object) => {
          const res = await fetch(`${workerUrl}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': workerSecret },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.detail ?? `HTTP ${res.status}`)
          }
          return res.json()
        }

        // Каждое действие независимо: ошибка лайка/подписки не блокирует DM.
        // Между действиями — случайная пауза (2-8 с) для естественности.
        const rd = (a: number, b: number) => new Promise<void>((r) => setTimeout(r, Math.round((a + Math.random() * (b - a)) * 1000)))
        const errors: string[] = []
        const incFired: Record<string, number> = {}   // «сработало» (попытки)
        const incDone: Record<string, number> = {}    // «выполнено» (успехи)
        let dmFired = false, dmSucceeded = false
        if (text) {
          dmFired = true
          try { await call('/send-dm', { sessionData, toUserId: followerPk, text, proxy }); dmSucceeded = true }
          catch (e: any) {
            const m = (e.message || '').toLowerCase()
            // бан/челлендж/лимит → пробрасываем (обработчик failed остановит основной)
            if (/challenge|checkpoint|verify|feedback_required|spam|blocked|action.?block|429|login_required|please wait|few minutes/.test(m)) throw e
            // личка закрыта / не доставлено → мягкий контакт основным (follow+лайк, если бюджет выделен)
            errors.push(`директ закрыт: ${e.message}`)
            if (fallbackFollow) { incFired.follow = (incFired.follow || 0) + 1; try { await call('/follow-user', { sessionData, userId: followerPk, proxy }); incDone.follow = (incDone.follow || 0) + 1 } catch {} }
            if (fallbackLike)   { incFired.like = (incFired.like || 0) + 1; try { await rd(2, 5); await call('/like-latest-media', { sessionData, userId: followerPk, proxy }); incDone.like = (incDone.like || 0) + 1 } catch {} }
          }
        }
        if (image) { dmFired = true; await rd(2, 5); try { await call('/send-dm-photo', { sessionData, toUserId: followerPk, image, proxy }); dmSucceeded = true } catch (e: any) { errors.push(`фото: ${e.message}`) } }
        if (dmFired) { incFired.dm = (incFired.dm || 0) + 1; if (dmSucceeded) incDone.dm = (incDone.dm || 0) + 1 }
        if (doFollow) { incFired.follow = (incFired.follow || 0) + 1; await rd(3, 8); try { await call('/follow-user', { sessionData, userId: followerPk, proxy }); incDone.follow = (incDone.follow || 0) + 1 } catch (e: any) { errors.push(`подписка: ${e.message}`) } }
        if (doLike)   { incFired.like = (incFired.like || 0) + 1; await rd(4, 10); try { await call('/like-latest-media', { sessionData, userId: followerPk, proxy }); incDone.like = (incDone.like || 0) + 1 } catch (e: any) { errors.push(`лайк: ${e.message}`) } }
        if (viewStories) { incFired.story = (incFired.story || 0) + 1; await rd(5, 12); try { await call('/user-stories', { sessionData, userId: followerPk, like: storyLike, proxy }); incDone.story = (incDone.story || 0) + 1 } catch (e: any) { errors.push(`сторис: ${e.message}`) } }

        const attempted = Object.keys(incFired).length > 0
        const success = Object.keys(incDone).length > 0
        if (attempted) {
          const cur = await prisma.triggerRule.findUnique({ where: { id: triggerId }, select: { stats: true } }).catch(() => null)
          const level = success ? (errors.length ? 'WARN' : 'SUCCESS') : 'ERROR'
          const message = success
            ? `Сработал триггер «${triggerName}» → @${followerUsername}${errors.length ? ` (частично: ${errors.join('; ')})` : ''}`
            : `Триггер «${triggerName}» → @${followerUsername}: действия не выполнены${errors.length ? ` (${errors.join('; ')})` : ''}`
          await Promise.all([
            prisma.log.create({ data: { accountId, level, message } }),
            prisma.triggerRule.update({ where: { id: triggerId }, data: { fireCount: { increment: 1 }, stats: mergeStatsMap(cur?.stats ?? {}, incFired, incDone) as any } }),
          ])
          console.log(`[dm-worker] ${success ? '✓ выполнено' : '⚠ сработало без выполнения'} → @${followerUsername}`)
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
        try {
          const res = await fetch(`${baseUrl}/api/poll`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Секрет для прохождения middleware (внутренний вызов без куки)
              'x-internal-secret': process.env.INTERNAL_SECRET ?? 'instaguard-internal-cron',
            },
            body: '{}',
          })
          const data = await res.json()
          const total = (data.summary ?? []).reduce((s: number, r: any) => s + (r.dmsQueued ?? 0), 0)
          console.log(`[auto-poll] ✓ done, queued ${total} DMs`)
        } catch (e: any) {
          console.error('[auto-poll] ✗ failed:', e.message)
        }
      },
      { connection }
    )

    console.log('[bullmq] dm-send worker + auto-poll (every 30 min) started')
  } catch (e) {
    console.error('[bullmq] init failed:', e)
  }
}

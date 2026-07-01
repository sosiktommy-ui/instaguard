export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // ── Авто-сид пользователя ──────────────────────────────────────────────────
  try {
    const { PrismaClient } = await import(/* webpackIgnore: true */ '@prisma/client')
    const { hashSync } = await import(/* webpackIgnore: true */ 'bcryptjs')
    const prisma = new PrismaClient()
    const existing = await prisma.user.findFirst()
    if (!existing) {
      // Единый дефолтный пользователь — совпадает со страницей входа
      const email = process.env.DEFAULT_USER_EMAIL ?? 'demo@instaguard.com'
      const password = process.env.DEFAULT_USER_PASSWORD ?? 'demo1234'
      await prisma.user.create({
        data: { email, name: 'Demo', password: hashSync(password, 10) },
      })
      console.log(`[seed] Created default user: ${email}`)
    }
    if (!process.env.JWT_SECRET) {
      console.warn('[auth] JWT_SECRET is NOT set — using insecure fallback. Set JWT_SECRET in Railway!')
    }
    await prisma.$disconnect()
  } catch (e) {
    console.error('[seed] Auto-seed failed:', e)
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
        } = job.data

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
        let success = false
        const errors: string[] = []
        if (text)     { try { await call('/send-dm', { sessionData, toUserId: followerPk, text, proxy }); success = true } catch (e: any) { errors.push(`DM: ${e.message}`) } }
        if (image)    { await rd(2, 5); try { await call('/send-dm-photo', { sessionData, toUserId: followerPk, image, proxy }); success = true } catch (e: any) { errors.push(`фото: ${e.message}`) } }
        if (doFollow) { await rd(3, 8); try { await call('/follow-user', { sessionData, userId: followerPk, proxy }); success = true } catch (e: any) { errors.push(`подписка: ${e.message}`) } }
        if (doLike)   { await rd(4, 10); try { await call('/like-latest-media', { sessionData, userId: followerPk, proxy }); success = true } catch (e: any) { errors.push(`лайк: ${e.message}`) } }
        if (viewStories) { await rd(5, 12); try { await call('/user-stories', { sessionData, userId: followerPk, like: storyLike, proxy }); success = true } catch (e: any) { errors.push(`сторис: ${e.message}`) } }

        if (success) {
          await Promise.all([
            prisma.log.create({
              data: { accountId, level: errors.length ? 'WARN' : 'SUCCESS', message: `Сработал триггер «${triggerName}» → @${followerUsername}${errors.length ? ` (частично: ${errors.join('; ')})` : ''}` },
            }),
            prisma.triggerRule.update({ where: { id: triggerId }, data: { fireCount: { increment: 1 } } }),
          ])
          console.log(`[dm-worker] ✓ trigger fired for @${followerUsername}`)
        } else {
          // Ни одно действие не выполнено — бросаем, чтобы BullMQ повторил попытку
          throw new Error(errors.join('; ') || 'Ни одно действие не выполнено')
        }
      },
      {
        connection,
        concurrency: 1, // один DM за раз — безопаснее для аккаунта
      }
    ).on('failed', async (job, err) => {
      if (!job) return
      const { accountId, followerUsername } = job.data
      await prisma.log.create({
        data: { accountId, level: 'ERROR', message: `Ошибка DM @${followerUsername}: ${err.message}` },
      }).catch(() => null)
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
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
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

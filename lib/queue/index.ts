import { Queue, Worker, Job } from 'bullmq'
import Redis from 'ioredis'
import { prisma } from '@/lib/prisma'

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

export const eventQueue = new Queue('instagram-events', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 1000,
  },
})

export const snapshotQueue = new Queue('instagram-snapshots', {
  connection: redis,
})

export const eventWorker = new Worker(
  'instagram-events',
  async (job: Job) => {
    const { eventId, ruleId } = job.data

    try {
      const [event, rule] = await Promise.all([
        prisma.event.findUnique({ where: { id: eventId } }),
        prisma.triggerRule.findUnique({ where: { id: ruleId } }),
      ])

      if (!event || !rule) return

      console.log(`[Queue] Выполняем правило "${rule.name}" для события ${event.type}`)

      await processAction(rule, event)

      await prisma.log.create({
        data: {
          accountId: event.accountId,
          eventId,
          level: 'SUCCESS',
          message: `Правило "${rule.name}" выполнено`,
        },
      })
    } catch (error) {
      console.error('[Queue Error]', error)

      await prisma.log.create({
        data: {
          accountId: job.data.accountId ?? 'unknown',
          eventId,
          level: 'ERROR',
          message: `Ошибка выполнения правила: ${(error as Error).message}`,
        },
      }).catch(() => {})
    }
  },
  { connection: redis }
)

async function processAction(rule: any, event: any) {
  const actions: any[] = rule.actions ?? []

  for (const action of actions) {
    if (action.type === 'SEND_MESSAGE') {
      const WORKER_URL = process.env.PYTHON_WORKER_URL ?? 'http://localhost:8001'
      const account = await prisma.instagramAccount.findUnique({
        where: { id: rule.responderId },
      })
      if (!account?.sessionData) continue

      await fetch(`${WORKER_URL}/send-dm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Secret': process.env.PYTHON_WORKER_SECRET ?? '',
        },
        body: JSON.stringify({
          sessionData: account.sessionData,
          toUserId: event.payload?.userId,
          text: action.templates?.[0] ?? '',
          proxy: account.proxy,
        }),
      })
    }

    if (action.type === 'DELAY') {
      const ms = (action.delayMin ?? 30) * 1000 +
        Math.random() * ((action.delayMax ?? 120) - (action.delayMin ?? 30)) * 1000
      await new Promise((r) => setTimeout(r, ms))
    }
  }
}

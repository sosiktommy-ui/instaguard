import { Queue } from 'bullmq'
import IORedis from 'ioredis'

// Используем lazy-инициализацию — не создаём соединение во время next build
let _redis: IORedis | null = null
function getRedis() {
  if (!_redis) {
    _redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    })
  }
  return _redis
}

let _eventQueue: Queue | null = null
export function getEventQueue() {
  if (!_eventQueue) {
    _eventQueue = new Queue('instagram-events', {
      connection: getRedis(),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 1000 },
    })
  }
  return _eventQueue
}

let _snapshotQueue: Queue | null = null
export function getSnapshotQueue() {
  if (!_snapshotQueue) {
    _snapshotQueue = new Queue('instagram-snapshots', { connection: getRedis() })
  }
  return _snapshotQueue
}

// Worker запускается только в отдельном процессе (workers/node/worker.ts), не в Next.js
export { getRedis }

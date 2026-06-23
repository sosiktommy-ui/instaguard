import { Queue } from 'bullmq'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

let _eventQueue: Queue | null = null
export function getEventQueue() {
  if (!_eventQueue) {
    _eventQueue = new Queue('instagram-events', {
      connection: { url: REDIS_URL, maxRetriesPerRequest: null },
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 1000 },
    })
  }
  return _eventQueue
}

let _snapshotQueue: Queue | null = null
export function getSnapshotQueue() {
  if (!_snapshotQueue) {
    _snapshotQueue = new Queue('instagram-snapshots', {
      connection: { url: REDIS_URL, maxRetriesPerRequest: null },
    })
  }
  return _snapshotQueue
}

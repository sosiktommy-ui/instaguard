import { browserConfigured } from '@/lib/browser/client'

export type Engine = 'browser' | 'legacy'

/**
 * Какой движок входа/действий использовать. По требованию пользователя выбор движка
 * (Настройки → «Движок входа и действий») УБРАН — всегда браузер (эмуль), legacy
 * (instagrapi) больше не выбирается вручную: именно приватный API стал причиной
 * банов/отказов входа, из-за которых весь переход и затевался (см. plan.md §1).
 * `UserSettings.actionEngine` оставлено в схеме как no-op (как другие LEGACY-поля),
 * но больше не читается.
 * Единственный случай возврата 'legacy' — браузерный воркер физически НЕ задеплоен
 * (нет BROWSER_WORKER_URL): это инфраструктурная страховка на время первого разворачивания
 * воркера, а не пользовательский выбор.
 */
export async function resolveEngine(_userId: string): Promise<Engine> {
  return browserConfigured() ? 'browser' : 'legacy'
}

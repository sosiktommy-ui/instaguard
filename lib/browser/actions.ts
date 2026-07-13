// Исполнитель браузерных действий для потока «подписчики/лайкнувшие/сторис-цели».
// ЧИСТЫЙ (без БД): возвращает счётчики + финальный browserState + признак остановки (brk),
// чтобы обе точки вызова (poll-route и dm-воркер instrumentation) сохраняли сессию своим prisma.
// Зеркалит legacy runFollowerActionsInline, но по username и через браузерный воркер (plan §4.6).
import { browserDM, browserFollow, browserLike, browserStories, browserRunVisit, type VisitTask } from './client'

export interface BrowserFollowerJob {
  browserState: object
  ownerUsername?: string        // username ОСНОВНОГО — для стабильного отпечатка контекста
  proxy?: string
  locale?: string                // гео отпечатка (plan.md §349) — тот же, что при входе аккаунта
  timezoneId?: string
  followerUsername: string      // цель действия (браузер ходит на /{username}/)
  text?: string
  image?: string                 // data-URL фото в директ (best-effort, §4.3 [A3])
  doFollow?: boolean
  doLike?: boolean
  likeCount?: number             // §13.10 — сколько последних постов лайкнуть (1..10, дефолт 1)
  viewStories?: boolean
  storyLike?: boolean
  storyCount?: number            // §13.10 — сколько кадров сторис посмотреть (дефолт 4)
  fallbackFollow?: boolean       // при закрытой личке — мягкий контакт (бюджет уже зарезервирован)
  fallbackLike?: boolean
}

export interface BrowserActionsResult {
  incFired: Record<string, number>   // «сработало» (попытки)
  incDone: Record<string, number>    // «выполнено» (успехи)
  impossible: string[]               // §13.10 — действие НЕвыполнимо не по вине бота (0 постов/0 сторис)
  errors: string[]
  browserState: object               // финальный storageState — сохранить в аккаунт
  brk?: 'CHALLENGE' | 'PAUSED'        // сессия мертва / бан → остановить аккаунт
}

const rd = (a: number, b: number) => new Promise<void>((r) => setTimeout(r, Math.round((a + Math.random() * (b - a)) * 1000)))
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] || 0) + 1 }
// Сессия мертва (нужен повторный вход) — единственная браузерная ошибка, останавливающая аккаунт.
const isSessionDead = (m: string) => /login_required|сессия недействительна|checkpoint|challenge/i.test(m)

export async function runFollowerActionsBrowser(job: BrowserFollowerJob): Promise<BrowserActionsResult> {
  // §1.1: сначала пробуем ОДИН визит (все задачи цели в одном контексте воркера). Если воркер
  // ещё не задеплоен с /session/run (404) — откатываемся на пооперационные вызовы (ниже), чтобы
  // поведение не ломалось до редеплоя. Логические ошибки визита НЕ вызывают фолбэк.
  try {
    return await runViaVisit(job)
  } catch (e: any) {
    if (e?.status !== 404) throw e
    // /session/run отсутствует — старый воркер; идём пооперационно.
  }
  return runViaIndividualCalls(job)
}

// Один визит: собрать задачи, отдать воркеру /session/run, разложить результат в счётчики.
async function runViaVisit(job: BrowserFollowerJob): Promise<BrowserActionsResult> {
  const ctx = { storageState: job.browserState, proxy: job.proxy, username: job.ownerUsername, locale: job.locale, timezoneId: job.timezoneId }
  // Порядок в воркере фиксированный (§13.9 orderTasks); здесь просто перечисляем задачи цели.
  const tasks: VisitTask[] = []
  if (job.text || job.image) tasks.push({ type: 'dm', target: job.followerUsername, text: job.text, image: job.image, fallbackFollow: job.fallbackFollow, fallbackLike: job.fallbackLike })
  if (job.doFollow) tasks.push({ type: 'follow', target: job.followerUsername })
  if (job.doLike) tasks.push({ type: 'like', target: job.followerUsername, count: job.likeCount || 1 })
  if (job.viewStories) tasks.push({ type: 'story', target: job.followerUsername, storyLike: Boolean(job.storyLike), count: job.storyCount || 4 })

  const incFired: Record<string, number> = {}
  const incDone: Record<string, number> = {}
  if (!tasks.length) return { incFired, incDone, impossible: [], errors: [], browserState: job.browserState }

  const r = await browserRunVisit(ctx, tasks)
  const done = r.done ?? {}
  const impossible = r.impossible ?? []
  // «Сработало» (attempts) считаем по тому, что ЗАКАЗАЛИ (бюджет уже зарезервирован в poll);
  // «выполнено» — по фактическим успехам визита. Fallback follow/like учитываем при закрытой личке.
  if (job.text || job.image) { bump(incFired, 'dm'); if (done.dm) bump(incDone, 'dm') }
  if (job.doFollow) { bump(incFired, 'follow'); if (done.follow) bump(incDone, 'follow') }
  if (job.doLike) { bump(incFired, 'like'); if (done.like) bump(incDone, 'like') }
  if (job.viewStories) { bump(incFired, 'story'); if (done.story) bump(incDone, 'story') }
  if (r.closed && job.fallbackFollow) { bump(incFired, 'follow'); if (done.follow) bump(incDone, 'follow') }
  if (r.closed && job.fallbackLike) { bump(incFired, 'like'); if (done.like) bump(incDone, 'like') }

  return { incFired, incDone, impossible, errors: r.errors ?? [], browserState: r.browserState ?? job.browserState, brk: r.brk }
}

// Фолбэк: пооперационные вызовы (старый путь) — на случай воркера без /session/run.
async function runViaIndividualCalls(job: BrowserFollowerJob): Promise<BrowserActionsResult> {
  let state: object = job.browserState
  const ctx = () => ({ storageState: state, proxy: job.proxy, username: job.ownerUsername, locale: job.locale, timezoneId: job.timezoneId })
  const incFired: Record<string, number> = {}
  const incDone: Record<string, number> = {}
  const impossible: string[] = []
  const errors: string[] = []
  let brk: 'CHALLENGE' | 'PAUSED' | undefined

  // §13.9 — ФИКСИРОВАННЫЙ порядок: подписка → лайк → сторис → ДИРЕКТ (директ последним, после
  // «прогрева» цели). follow первым — на случай закрытого аккаунта / SMS-подтверждения только при
  // взаимной подписке. Директ идёт НЕЗАВИСИМО от исхода прошлых действий (гейт взаимной подписки
  // отсекается в poll до сюда). Fallback follow+like — только когда личка закрыта И явные follow/like
  // не заказаны (гейтится в poll полями fallback*), поэтому двойных нет.
  const steps: (() => Promise<void>)[] = []

  if (job.doFollow) steps.push(async () => {
    bump(incFired, 'follow'); await rd(3, 7)
    try { const r = await browserFollow(ctx(), job.followerUsername); if (r.browserState) state = r.browserState; if (r.ok) bump(incDone, 'follow'); else errors.push(`подписка: ${r.error ?? 'нет'}`) }
    catch (e: any) { const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`подписка: ${m}`) }
  })

  if (job.doLike) steps.push(async () => {
    bump(incFired, 'like'); await rd(3, 8)
    try {
      const r = await browserLike(ctx(), job.followerUsername, job.likeCount || 1)
      if (r.browserState) state = r.browserState
      if (r.ok) bump(incDone, 'like')
      else if ((r as any).impossible) impossible.push('лайк: у аккаунта нет постов')  // §13.10 не ошибка
      else errors.push(`лайк: ${r.error ?? 'нет'}`)
    } catch (e: any) { const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`лайк: ${m}`) }
  })

  if (job.viewStories) steps.push(async () => {
    bump(incFired, 'story'); await rd(4, 10)
    try {
      const r = await browserStories(ctx(), job.followerUsername, Boolean(job.storyLike), job.storyCount || 4)
      if (r.browserState) state = r.browserState
      if (r.ok) bump(incDone, 'story')
      else if ((r as any).impossible) impossible.push('сторис: нет активных сторис')  // §13.10 не ошибка
      else errors.push(`сторис: ${r.error ?? 'нет'}`)
    } catch (e: any) { const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`сторис: ${m}`) }
  })

  if (job.text || job.image) steps.push(async () => {
    bump(incFired, 'dm'); await rd(2, 6)
    try {
      const r = await browserDM(ctx(), job.followerUsername, job.text ?? '', job.image)
      if (r.browserState) state = r.browserState
      if (r.ok) bump(incDone, 'dm')
      else if (r.closed) {
        errors.push(`директ закрыт: ${r.error ?? 'closed'}`)
        if (job.fallbackFollow) { bump(incFired, 'follow'); try { const fr = await browserFollow(ctx(), job.followerUsername); if (fr.browserState) state = fr.browserState; if (fr.ok) bump(incDone, 'follow') } catch {} }
        if (job.fallbackLike)   { bump(incFired, 'like');   try { await rd(2, 5); const lr = await browserLike(ctx(), job.followerUsername, 1); if (lr.browserState) state = lr.browserState; if (lr.ok) bump(incDone, 'like') } catch {} }
      } else errors.push(`директ: ${r.error ?? 'не отправлен'}`)
    } catch (e: any) {
      const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`директ: ${m}`)
    }
  })

  for (const step of steps) {   // §13.9 — исполняем в фиксированном порядке (без перемешивания)
    if (brk) break                 // сессия умерла на предыдущем шаге → не долбим дальше
    await step()
  }

  return { incFired, incDone, impossible, errors, browserState: state, brk }
}

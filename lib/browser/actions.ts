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
  doFollow?: boolean
  doLike?: boolean
  viewStories?: boolean
  storyLike?: boolean
  fallbackFollow?: boolean       // при закрытой личке — мягкий контакт (бюджет уже зарезервирован)
  fallbackLike?: boolean
}

export interface BrowserActionsResult {
  incFired: Record<string, number>   // «сработало» (попытки)
  incDone: Record<string, number>    // «выполнено» (успехи)
  errors: string[]
  browserState: object               // финальный storageState — сохранить в аккаунт
  brk?: 'CHALLENGE' | 'PAUSED'        // сессия мертва / бан → остановить аккаунт
}

const rd = (a: number, b: number) => new Promise<void>((r) => setTimeout(r, Math.round((a + Math.random() * (b - a)) * 1000)))
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] || 0) + 1 }
// Сессия мертва (нужен повторный вход) — единственная браузерная ошибка, останавливающая аккаунт.
const isSessionDead = (m: string) => /login_required|сессия недействительна|checkpoint|challenge/i.test(m)
// Фишер–Йейтс: перемешать порядок шагов (plan.md §1.5 — не фиксировать DM→follow→like→story).
function shuffle<T>(a: T[]): T[] { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

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
  const tasks: VisitTask[] = []
  if (job.text) tasks.push({ type: 'dm', target: job.followerUsername, text: job.text, fallbackFollow: job.fallbackFollow, fallbackLike: job.fallbackLike })
  if (job.doFollow) tasks.push({ type: 'follow', target: job.followerUsername })
  if (job.doLike) tasks.push({ type: 'like', target: job.followerUsername, count: 1 })
  if (job.viewStories) tasks.push({ type: 'story', target: job.followerUsername, storyLike: Boolean(job.storyLike) })

  const incFired: Record<string, number> = {}
  const incDone: Record<string, number> = {}
  if (!tasks.length) return { incFired, incDone, errors: [], browserState: job.browserState }

  const r = await browserRunVisit(ctx, tasks)
  const done = r.done ?? {}
  // «Сработало» (attempts) считаем по тому, что ЗАКАЗАЛИ (бюджет уже зарезервирован в poll);
  // «выполнено» — по фактическим успехам визита. Fallback follow/like учитываем при закрытой личке.
  if (job.text) { bump(incFired, 'dm'); if (done.dm) bump(incDone, 'dm') }
  if (job.doFollow) { bump(incFired, 'follow'); if (done.follow) bump(incDone, 'follow') }
  if (job.doLike) { bump(incFired, 'like'); if (done.like) bump(incDone, 'like') }
  if (job.viewStories) { bump(incFired, 'story'); if (done.story) bump(incDone, 'story') }
  if (r.closed && job.fallbackFollow) { bump(incFired, 'follow'); if (done.follow) bump(incDone, 'follow') }
  if (r.closed && job.fallbackLike) { bump(incFired, 'like'); if (done.like) bump(incDone, 'like') }

  return { incFired, incDone, errors: r.errors ?? [], browserState: r.browserState ?? job.browserState, brk: r.brk }
}

// Фолбэк: пооперационные вызовы (старый путь) — на случай воркера без /session/run.
async function runViaIndividualCalls(job: BrowserFollowerJob): Promise<BrowserActionsResult> {
  let state: object = job.browserState
  const ctx = () => ({ storageState: state, proxy: job.proxy, username: job.ownerUsername, locale: job.locale, timezoneId: job.timezoneId })
  const incFired: Record<string, number> = {}
  const incDone: Record<string, number> = {}
  const errors: string[] = []
  let brk: 'CHALLENGE' | 'PAUSED' | undefined

  // Каждое действие — отдельный шаг. Порядок ПЕРЕМЕШИВАЕТСЯ (§1.5): человек не делает
  // всегда одну и ту же последовательность. Логика и бюджет не зависят от порядка —
  // fallback follow+like включается только когда доставка директа НЕ удалась И явные
  // follow/like не заказаны (поле fallback* уже так гейтится в poll), поэтому двойных нет.
  const steps: (() => Promise<void>)[] = []

  if (job.text) steps.push(async () => {
    bump(incFired, 'dm'); await rd(2, 6)
    try {
      const r = await browserDM(ctx(), job.followerUsername, job.text!)
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

  if (job.doFollow) steps.push(async () => {
    bump(incFired, 'follow'); await rd(3, 7)
    try { const r = await browserFollow(ctx(), job.followerUsername); if (r.browserState) state = r.browserState; if (r.ok) bump(incDone, 'follow'); else errors.push(`подписка: ${r.error ?? 'нет'}`) }
    catch (e: any) { const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`подписка: ${m}`) }
  })

  if (job.doLike) steps.push(async () => {
    bump(incFired, 'like'); await rd(3, 8)
    try { const r = await browserLike(ctx(), job.followerUsername, 1); if (r.browserState) state = r.browserState; if (r.ok) bump(incDone, 'like'); else errors.push(`лайк: ${r.error ?? 'нет'}`) }
    catch (e: any) { const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`лайк: ${m}`) }
  })

  if (job.viewStories) steps.push(async () => {
    bump(incFired, 'story'); await rd(4, 10)
    try { const r = await browserStories(ctx(), job.followerUsername, Boolean(job.storyLike)); if (r.browserState) state = r.browserState; if (r.ok) bump(incDone, 'story'); else errors.push(`сторис: ${r.error ?? 'нет'}`) }
    catch (e: any) { const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`сторис: ${m}`) }
  })

  for (const step of shuffle(steps)) {
    if (brk) break                 // сессия умерла на предыдущем шаге → не долбим дальше
    await step()
  }

  return { incFired, incDone, errors, browserState: state, brk }
}

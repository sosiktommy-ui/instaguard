// Исполнитель браузерных действий для потока «подписчики/лайкнувшие/сторис-цели».
// ЧИСТЫЙ (без БД): возвращает счётчики + финальный browserState + признак остановки (brk),
// чтобы обе точки вызова (poll-route и dm-воркер instrumentation) сохраняли сессию своим prisma.
// Зеркалит legacy runFollowerActionsInline, но по username и через браузерный воркер (plan §4.6).
import { browserDM, browserFollow, browserLike, browserStories } from './client'

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

export async function runFollowerActionsBrowser(job: BrowserFollowerJob): Promise<BrowserActionsResult> {
  let state: object = job.browserState
  const ctx = () => ({ storageState: state, proxy: job.proxy, username: job.ownerUsername, locale: job.locale, timezoneId: job.timezoneId })
  const incFired: Record<string, number> = {}
  const incDone: Record<string, number> = {}
  const errors: string[] = []
  let brk: 'CHALLENGE' | 'PAUSED' | undefined

  let dmFired = false, dmOk = false
  if (job.text) {
    dmFired = true
    try {
      const r = await browserDM(ctx(), job.followerUsername, job.text)
      if (r.browserState) state = r.browserState
      if (r.ok) dmOk = true
      else if (r.closed) {
        // Личка закрыта → мягкий контакт основным (follow + лайк), если бюджет был выделен.
        errors.push(`директ закрыт: ${r.error ?? 'closed'}`)
        if (job.fallbackFollow) { bump(incFired, 'follow'); try { const fr = await browserFollow(ctx(), job.followerUsername); if (fr.browserState) state = fr.browserState; if (fr.ok) bump(incDone, 'follow') } catch {} }
        if (job.fallbackLike)   { bump(incFired, 'like');   try { await rd(2, 5); const lr = await browserLike(ctx(), job.followerUsername, 1); if (lr.browserState) state = lr.browserState; if (lr.ok) bump(incDone, 'like') } catch {} }
      } else {
        errors.push(`директ: ${r.error ?? 'не отправлен'}`)
      }
    } catch (e: any) {
      const m = String(e?.message ?? '')
      if (isSessionDead(m)) brk = 'CHALLENGE'
      errors.push(`директ: ${m}`)
    }
  }
  if (dmFired) { bump(incFired, 'dm'); if (dmOk) bump(incDone, 'dm') }

  if (!brk && job.doFollow) {
    bump(incFired, 'follow'); await rd(3, 7)
    try { const r = await browserFollow(ctx(), job.followerUsername); if (r.browserState) state = r.browserState; if (r.ok) bump(incDone, 'follow'); else errors.push(`подписка: ${r.error ?? 'нет'}`) }
    catch (e: any) { const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`подписка: ${m}`) }
  }
  if (!brk && job.doLike) {
    bump(incFired, 'like'); await rd(3, 8)
    try { const r = await browserLike(ctx(), job.followerUsername, 1); if (r.browserState) state = r.browserState; if (r.ok) bump(incDone, 'like'); else errors.push(`лайк: ${r.error ?? 'нет'}`) }
    catch (e: any) { const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`лайк: ${m}`) }
  }
  if (!brk && job.viewStories) {
    bump(incFired, 'story'); await rd(4, 10)
    try { const r = await browserStories(ctx(), job.followerUsername, Boolean(job.storyLike)); if (r.browserState) state = r.browserState; if (r.ok) bump(incDone, 'story'); else errors.push(`сторис: ${r.error ?? 'нет'}`) }
    catch (e: any) { const m = String(e?.message ?? ''); if (isSessionDead(m)) brk = 'CHALLENGE'; errors.push(`сторис: ${m}`) }
  }

  return { incFired, incDone, errors, browserState: state, brk }
}

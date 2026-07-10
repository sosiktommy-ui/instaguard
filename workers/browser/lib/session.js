// Сессия-визит (plan.md §1.1): все задачи на ОДНУ цель выполняются в ОДНОМ браузерном
// контексте за один «визит» (прогрев ленты → задачи в случайном порядке с микро-браузингом
// между ними → выход), а не «контекст на каждое микро-действие». Переиспользует уже рабочие
// функции действий (actions.js) — меняется только оркестрация, не сама механика кликов.
//
// Бюджет/лимиты решает Next.js (там счётчики) и присылает готовый список задач; воркер лишь
// исполняет. Fallback при закрытой личке (follow+like) исполняется В ТОМ ЖЕ визите, если
// Next.js разрешил флагами задачи (бюджет он уже зарезервировал).
import { sendDM, followUser, likeUser, viewStories } from './actions.js'
import { warmupFeed, jitter } from './human.js'

const DEAD = /login_required|сессия недейств|checkpoint|challenge/i
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] } return a }

// Закрыть все страницы контекста между задачами — куки/сессия живут в контексте, не в табах,
// поэтому визит не «копит» вкладки. Следующая задача откроет свежую страницу.
async function closePages(context) {
  for (const p of context.pages()) { try { await p.close() } catch {} }
}

/**
 * Выполнить визит на переданном контексте.
 * @param {object[]} tasks  [{type:'dm', target, text, fallbackFollow, fallbackLike} | {type:'follow'|'like'|'story', target, count?, storyLike?}]
 * @returns {{ done:Record<string,number>, closed:boolean, errors:string[], brk?:string, storageState:object }}
 */
export async function runVisit(context, { tasks = [], warmup = true } = {}) {
  const done = {}
  const errors = []
  let closed = false
  let brk
  const mark = (k) => { done[k] = (done[k] || 0) + 1 }

  // Прогрев ленты — ОДИН раз на визит (не перед каждым микро-действием).
  if (warmup) {
    try { const p = await context.newPage(); await warmupFeed(p); } catch {}
    await closePages(context)
  }

  for (const task of shuffle([...tasks])) {
    if (brk) { errors.push(`${task.type}: пропущен (сессия остановлена)`); continue }
    try {
      if (task.type === 'dm') {
        const r = await sendDM(context, { toUsername: task.target, text: task.text })
        if (r.ok) mark('dm')
        else if (r.closed) {
          closed = true
          errors.push(`директ закрыт: ${r.error ?? 'closed'}`)
          if (task.fallbackFollow) { try { const fr = await followUser(context, { targetUsername: task.target }); if (fr.ok) mark('follow') } catch {} }
          if (task.fallbackLike) { try { await jitter(2000, 5000); const lr = await likeUser(context, { targetUsername: task.target, count: 1 }); if (lr.ok || (lr.liked || 0) > 0) mark('like') } catch {} }
        } else errors.push(`директ: ${r.error ?? 'не отправлен'}`)
      } else if (task.type === 'follow') {
        const r = await followUser(context, { targetUsername: task.target }); if (r.ok) mark('follow'); else errors.push(`подписка: ${r.error ?? 'нет'}`)
      } else if (task.type === 'like') {
        const r = await likeUser(context, { targetUsername: task.target, count: task.count || 1 }); if (r.ok || (r.liked || 0) > 0) mark('like'); else errors.push(`лайк: ${r.error ?? 'нет'}`)
      } else if (task.type === 'story') {
        const r = await viewStories(context, { targetUsername: task.target, like: Boolean(task.storyLike) }); if (r.ok) mark('story'); else errors.push(`сторис: ${r.error ?? 'нет'}`)
      }
    } catch (e) {
      const m = String(e?.message ?? '')
      if (DEAD.test(m)) brk = 'CHALLENGE'
      errors.push(`${task.type}: ${m}`)
    }
    await closePages(context)
    if (!brk) await jitter(1500, 5000) // человеческая пауза между задачами визита
  }

  return { done, closed, errors, brk, storageState: await context.storageState() }
}

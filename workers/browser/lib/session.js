// Сессия-визит (plan.md §1.1): все задачи на ОДНУ цель выполняются в ОДНОМ браузерном
// контексте за один «визит» (прогрев ленты → задачи в случайном порядке с микро-браузингом
// между ними → выход), а не «контекст на каждое микро-действие». Переиспользует уже рабочие
// функции действий (actions.js) — меняется только оркестрация, не сама механика кликов.
//
// Бюджет/лимиты решает Next.js (там счётчики) и присылает готовый список задач; воркер лишь
// исполняет. Fallback при закрытой личке (follow+like) исполняется В ТОМ ЖЕ визите, если
// Next.js разрешил флагами задачи (бюджет он уже зарезервировал).
import { sendDM, followUser, likeUser, viewStories, replyComment } from './actions.js'
import { safeStorageState } from './browser.js'
import { warmupFeed, jitter } from './human.js'

const DEAD = /login_required|сессия недейств|checkpoint|challenge/i

// §13.9 — ФИКСИРОВАННЫЙ порядок действий на одну цель (НЕ случайный):
// подписка → лайк → коммент → сторис → ДИРЕКТ (директ всегда последним, после «прогрева» цели).
// Порядок детерминирован по запросу пользователя (важнее анти-детект-рандома): follow первым
// (на случай закрытого аккаунта / SMS только при взаимной подписке), dm последним.
const ORDER = { follow: 0, like: 1, comment: 2, story: 3, dm: 4 }
function orderTasks(a) { return [...a].sort((x, y) => (ORDER[x.type] ?? 9) - (ORDER[y.type] ?? 9)) }

// Закрыть все страницы контекста между задачами — куки/сессия живут в контексте, не в табах,
// поэтому визит не «копит» вкладки. Следующая задача откроет свежую страницу.
async function closePages(context) {
  for (const p of context.pages()) { try { await p.close() } catch {} }
}

/**
 * Выполнить визит на переданном контексте.
 * @param {object[]} tasks  [{type:'dm', target, text, fallbackFollow, fallbackLike} | {type:'follow'|'like'|'story'|'comment', target, count?, storyLike?, postUrl?, text?}]
 * @returns {{ done:Record<string,number>, impossible:string[], closed:boolean, errors:string[], brk?:string, storageState:object }}
 *   done — реально ВЫПОЛНЕННЫЕ действия (лайк ≥1 поста / просмотр ≥1 сторис = 1 «done», независимо от N).
 *   impossible — действие НЕВОЗМОЖНО по независящей от бота причине (0 постов для лайка / 0 активных
 *   сторис). Это НЕ ошибка: poll логирует их меткой «невозможно», а не ERROR (§13.10).
 */
export async function runVisit(context, { tasks = [], warmup = true } = {}) {
  const done = {}
  const impossible = []
  const errors = []
  let closed = false
  let brk
  const mark = (k) => { done[k] = (done[k] || 0) + 1 }
  const markImpossible = (k, why) => { impossible.push(`${k}: ${why}`) }

  // Прогрев ленты — ОДИН раз на визит (не перед каждым микро-действием).
  if (warmup) {
    try { const p = await context.newPage(); await warmupFeed(p); } catch {}
    await closePages(context)
  }

  // §13.9 — задачи исполняются в ФИКСИРОВАННОМ порядке (follow→like→comment→story→dm), не случайно.
  for (const task of orderTasks(tasks)) {
    if (brk) { errors.push(`${task.type}: пропущен (сессия остановлена)`); continue }
    try {
      if (task.type === 'dm') {
        // Директ последним. Идёт НЕЗАВИСИМО от исхода прошлых действий (если не отсечён гейтом
        // взаимной подписки на стороне poll). Закрытая личка → fallback follow+like (мягкий контакт).
        // Директ — самое рискованное действие: перед ним ДОПОЛНИТЕЛЬНАЯ человеческая пауза
        // (человек не пишет в директ через 2 секунды после подписки/лайка) — анти-бан.
        await jitter(8000, 22000)
        const r = await sendDM(context, { toUsername: task.target, text: task.text, image: task.image })
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
        // §13.10 — лайкаем до N последних постов; ≥1 успешный лайк = 1 «done» (не N). 0 постов у
        // цели = НЕВОЗМОЖНО (не ошибка): у человека нечего лайкать.
        const r = await likeUser(context, { targetUsername: task.target, count: task.count || 1 })
        if (r.ok || (r.liked || 0) > 0) mark('like')
        else if (r.impossible) markImpossible('лайк', 'у аккаунта нет постов')
        else errors.push(`лайк: ${r.error ?? 'нет'}`)
      } else if (task.type === 'comment') {
        // Ответ в комментариях под МОИМ постом (триггер «Комментарий»). Нужен postUrl.
        const r = await replyComment(context, { postUrl: task.postUrl, text: task.text })
        if (r.ok) mark('comment'); else errors.push(`коммент: ${r.error ?? 'нет'}`)
      } else if (task.type === 'story') {
        // §13.10 — смотрим до N кадров сторис; ≥1 просмотр = 1 «done». 0 активных сторис = НЕВОЗМОЖНО.
        const r = await viewStories(context, { targetUsername: task.target, like: Boolean(task.storyLike), count: task.count || 4 })
        if (r.ok || (r.viewed || 0) > 0) mark('story')
        else if (r.impossible) markImpossible('сторис', 'нет активных сторис')
        else errors.push(`сторис: ${r.error ?? 'нет'}`)
      }
    } catch (e) {
      const m = String(e?.message ?? '')
      if (DEAD.test(m)) brk = 'CHALLENGE'
      errors.push(`${task.type}: ${m}`)
    }
    await closePages(context)
    // Человеческая пауза между действиями на ОДНОЙ цели. 1.5–5с было слишком быстро (живой
    // человек не жмёт follow→like→comment за пару секунд) → всплеск/action-block. Теперь 8–25с
    // (+ перед каждым действием ещё идёт органический прогрев ленты в openProfile → суммарно
    // ритм похож на человека). На всплеск не влияет — число целей за цикл ограничено «дрипом».
    if (!brk) await jitter(8000, 25000)
  }

  return { done, impossible, closed, errors, brk, storageState: await safeStorageState(context) }
}

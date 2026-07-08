import { loadCounters, DAILY_CAPS, scaleCaps, warmupFactor, warmupPct, type ActionKind } from '@/lib/limits'

/**
 * «Индекс безопасности» аккаунта (0–100) — насколько он защищён от бана прямо сейчас.
 * Считается как 100 минус сумма штрафов по каждому фактору риска (см. FACTORS ниже).
 * Каждый фактор возвращается отдельной строкой — и «зелёной» (всё в порядке), и «красной» —
 * чтобы в подсказке было видно ПОЛНУЮ картину, а не только то, что сломано.
 */

export interface SafetyFactor {
  ok: boolean       // true = фактор в порядке (не режет счёт)
  label: string      // что показать пользователю
  delta: number       // сколько очков снято (0, если ok)
}
export interface Safety { score: number; label: string; color: string; factors: SafetyFactor[] }

const CAP_ORDER: ActionKind[] = ['dm', 'follow', 'like', 'comment', 'story']
const ACTION_LABEL: Record<ActionKind, string> = {
  dm: 'Директ', follow: 'Подписки', like: 'Лайки', comment: 'Комментарии', story: 'Сторис',
}

export function securityIndex(acc: {
  status?: string | null
  errorCount?: number | null
  limits?: unknown
  proxy?: string | null
  hasSession?: boolean | null
  lastChecked?: string | Date | null
  createdAt?: string | Date | null
  role?: string | null
}, ctx?: {
  draftCount?: number      // сколько живых черновых (HELPER) у владельца — глобально
  allowNoDrafts?: boolean   // включено ли «работать без черновых» (основной парсит сам)
  totalFires?: number       // сколько раз кампании этого аккаунта сработали за всё время
}): Safety {
  const factors: SafetyFactor[] = []
  const push = (ok: boolean, label: string, delta: number) => factors.push({ ok, label, delta: ok ? 0 : delta })

  // 1. Статус аккаунта — самый весомый фактор
  const status = acc.status ?? 'ACTIVE'
  if (status === 'BLOCKED') push(false, 'Аккаунт заблокирован Instagram', 90)
  else if (status === 'CHALLENGE') push(false, 'Требуется подтверждение входа (challenge)', 85)
  else if (status === 'PAUSED') push(false, 'Аккаунт на паузе', 40)
  else push(true, 'Аккаунт активен', 0)

  // 2. Есть ли живая сессия Instagram (не восстановится сам без повторного входа)
  if (acc.hasSession === false) push(false, 'Нет активной сессии — нужна повторная авторизация', 60)
  else if (acc.hasSession === true) push(true, 'Сессия Instagram активна', 0)
  // hasSession === undefined (старые клиенты API) — фактор не показываем вовсе

  // 3. Ошибки подряд — каждая на несколько шагов приближает к паузе/бану
  const errs = acc.errorCount ?? 0
  if (errs > 0) push(false, `Ошибок подряд: ${errs}`, Math.min(45, errs * 10))
  else push(true, 'Ошибок подряд нет', 0)

  // 4. Дневная загрузка лимитов — чем ближе к суточному потолку, тем выше риск ограничений.
  // Потолки берём УЖАТЫЕ под прогрев (для молодого аккаунта лимиты ниже) — процент честный.
  const c = loadCounters(acc.limits) as any
  const caps = scaleCaps(warmupFactor(acc.createdAt))
  let worstKey: ActionKind | null = null
  let worstPct = 0
  for (const k of CAP_ORDER) {
    const cap = caps[k]
    const used = Number(c[k]) || 0
    const pct = cap ? Math.min(100, (used / cap) * 100) : 0
    if (pct > worstPct) { worstPct = pct; worstKey = k }
  }
  if (worstKey && worstPct >= 50) {
    push(false, `Дневной лимит «${ACTION_LABEL[worstKey]}» использован на ${Math.round(worstPct)}%`, Math.round(worstPct * 0.3))
  } else {
    push(true, 'Дневные лимиты далеки от потолка', 0)
  }

  // 5. Прокси — без него все действия идут с «домашнего» IP бота, риск бана заметно выше.
  // Это один из самых прямых сигналов для Instagram — штраф весомый.
  if (!acc.proxy) push(false, 'Нет прокси', 35)
  else push(true, 'Прокси подключён', 0)

  // 5b. Парсинг подписчиков/комментов/лайков вынесен в скрейпер-API (черновые аккаунты больше
  // не используются). Основной аккаунт САМ не парсит → защищён от «палевного» чтения.
  // ctx.draftCount/allowNoDrafts оставлены в сигнатуре для обратной совместимости, но не влияют.
  if (acc.role !== 'HELPER') {
    push(true, 'Парсинг через API — основной не парсит (защищён)', 0)
  }

  // 6. Давно не проверялся — если бот давно не заходил, счётчики/статус могут быть устаревшими
  if (!acc.lastChecked) {
    push(false, 'Ещё ни разу не проверялся ботом', 15)
  } else {
    const hours = (Date.now() - new Date(acc.lastChecked).getTime()) / 3_600_000
    if (hours > 48) push(false, `Давно не проверялся (${Math.floor(hours / 24)} дн. назад)`, 20)
    else if (hours > 24) push(false, 'Давно не проверялся (больше суток)', 10)
    else push(true, 'Проверялся недавно', 0)
  }

  // 7. Частота срабатываний — очень активная автоматизация (много кампаний, короткие задержки)
  // выглядит для Instagram как спам-паттерн, даже если формально в рамках дневных лимитов.
  if (ctx?.totalFires !== undefined) {
    const created = acc.createdAt ? new Date(acc.createdAt) : null
    const ageDays = created && Number.isFinite(created.getTime())
      ? Math.max(1, (Date.now() - created.getTime()) / 86_400_000)
      : 1
    const perDay = ctx.totalFires / ageDays
    if (ctx.totalFires === 0) push(true, 'Пока не срабатывал', 0)
    else if (perDay >= 40) push(false, `Очень частые срабатывания (${perDay.toFixed(1)}/день) — похоже на спам-паттерн для Instagram`, 30)
    else if (perDay >= 15) push(false, `Много срабатываний в день (${perDay.toFixed(1)})`, 15)
    else push(true, `Частота срабатываний в норме (${perDay.toFixed(1)}/день)`, 0)
  }

  // 8. Прогрев — молодой аккаунт работает на сниженных лимитах (это защита, не штраф).
  const wpct = warmupPct(acc.createdAt)
  if (wpct < 100) push(true, `Прогрев: лимиты ${wpct}% (аккаунт разгоняется)`, 0)
  else push(true, 'Прогрет — лимиты на 100%', 0)

  const score = Math.max(0, Math.min(100, 100 - factors.reduce((s, f) => s + f.delta, 0)))
  const label = score >= 80 ? 'Защищён' : score >= 60 ? 'Норма' : score >= 35 ? 'Риск' : 'Опасно'
  const color = score >= 60 ? '#34c759' : score >= 35 ? '#ff9500' : '#ff3b30'
  return { score, label, color, factors }
}

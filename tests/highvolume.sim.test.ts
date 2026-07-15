import { describe, it, expect } from 'vitest'
import { selectTargets } from '@/lib/targets'
import { consume, remaining, DAILY_CAPS, OFF_CAP, type Caps, type Counters } from '@/lib/limits'

// Нагрузочная симуляция «высоких оборотов» (PLAN-BEHAVIOR §5/§8.6): к аккаунту подписалось МНОГО
// человек (напр. 120 за час). Проверяем на РЕАЛЬНЫХ функциях (selectTargets — дрип, consume/remaining
// — дневные лимиты) ключевые свойства §4.3:
//   1) НИКТО не теряется — все цели в итоге обрабатываются (за несколько дней);
//   2) дневной лимит НЕ превышается (ban-safety потолок соблюдён каждый день);
//   3) capped-цель (нет бюджета сегодня) НЕ помечается «известной» → добёрётся, когда бюджет обновится;
//   4) никого не обрабатываем дважды.
// Модель одного дня = 8 циклов авто-проверки (интервал 3ч). Действие для примера — «подписка в ответ»
// (follow — самый жёсткий cap 15/сут, он и есть узкое место). Логика цикла ТОЧНО как в poll:
//   selectTargets(drip) → на каждую цель consume('follow'); успех → остаётся known (обработана),
//   нет бюджета → known.delete (capped, вернётся завтра).

function freshDay(): Counters { return { date: 'sim', dm: 0, follow: 0, like: 0, comment: 0, story: 0 } }

function simulate(total: number, dripCap: number, caps: Caps, cyclesPerDay = 8, maxDays = 90) {
  const targets = Array.from({ length: total }, (_, i) => ({ pk: `u${i}` }))
  const known = new Set<string>()   // база уже зафиксирована (пустой снапшот после «Сбросить») → hadBaseline=true
  const done = new Set<string>()
  const perDay: number[] = []
  let doubles = 0
  let days = 0
  while (done.size < total && days < maxDays) {
    const c = freshDay()               // новый день — счётчики сброшены (как loadCounters по дате)
    let processedToday = 0
    for (let cyc = 0; cyc < cyclesPerDay; cyc++) {
      const { process } = selectTargets(targets, known, true, (x) => x.pk, dripCap)
      for (const t of process) {
        if (consume(c, 'follow', 1, caps)) {
          if (done.has(t.pk)) doubles++   // защита: не должны обрабатывать дважды
          done.add(t.pk)                  // успех → остаётся «известной» (selectTargets уже добавил)
          processedToday++
        } else {
          known.delete(t.pk)              // §4.3 — нет бюджета → снять «известность» → ретрай (завтра)
        }
      }
    }
    perDay.push(processedToday)
    days++
  }
  return { doneSize: done.size, days, perDay, maxPerDay: Math.max(0, ...perDay), doubles }
}

describe('высокие обороты: 120 подписок — никто не теряется, лимит не превышен', () => {
  it('авто-дрип (2–4/цикл): все 120 обработаны за ~8 дней, ≤15/сутки, без потерь и дублей', () => {
    const r = simulate(120, 3, DAILY_CAPS)          // follow cap = 15/сут
    expect(r.doubles).toBe(0)                        // никого дважды
    expect(r.doneSize).toBe(120)                     // НИКТО не потерян — все обработаны
    expect(r.maxPerDay).toBeLessThanOrEqual(DAILY_CAPS.follow)  // дневной лимит соблюдён
    expect(r.days).toBe(Math.ceil(120 / DAILY_CAPS.follow))     // ~8 дней (120/15)
  })

  it('ручной дрип (12/цикл): узкое место — дневной лимит (15), а не дрип; всё равно ≤15/сут, без потерь', () => {
    const r = simulate(120, 12, DAILY_CAPS)
    expect(r.doneSize).toBe(120)
    expect(r.maxPerDay).toBeLessThanOrEqual(DAILY_CAPS.follow)
    expect(r.doubles).toBe(0)
  })

  it('лимиты ОТКЛЮЧЕНЫ (off): дрип 12 = потолок безопасности → ≤96/сут (не залп 120), все обработаны', () => {
    const off: Caps = { dm: OFF_CAP, follow: OFF_CAP, like: OFF_CAP, comment: OFF_CAP, story: OFF_CAP }
    const r = simulate(120, 12, off)                 // selectTargets всё равно клампит 12/цикл
    expect(r.doneSize).toBe(120)
    expect(r.doubles).toBe(0)
    expect(r.maxPerDay).toBeLessThanOrEqual(12 * 8)  // даже без лимитов — не весь всплеск за раз (дрип-бэкстоп)
  })

  it('маленький поток (10 новых) полностью приветствуется за 1 день в пределах лимита', () => {
    const r = simulate(10, 4, DAILY_CAPS)
    expect(r.doneSize).toBe(10)
    expect(r.days).toBe(1)
    expect(r.maxPerDay).toBeLessThanOrEqual(DAILY_CAPS.follow)
  })
})

describe('§4.3 инвариант: capped-цель НЕ теряется (возвращается, когда бюджет обновился)', () => {
  it('за 1-й день бюджета хватает не всем, остаток НЕ пропадает и добирается на 2-й день', () => {
    // 20 целей, cap follow=15 → день1: 15 обработано, 5 capped (не потеряны); день2: +5 → 20.
    const caps: Caps = { ...DAILY_CAPS, follow: 15 }
    const r = simulate(20, 12, caps)
    expect(r.doneSize).toBe(20)
    expect(r.perDay[0]).toBe(15)   // день 1 — ровно потолок
    expect(r.perDay[1]).toBe(5)    // день 2 — оставшиеся 5 (не потеряны в §4.3)
    expect(r.days).toBe(2)
  })

  it('remaining/consume: бюджет не уходит в минус и корректно исчерпывается', () => {
    const c = freshDay()
    let ok = 0
    for (let i = 0; i < 100; i++) if (consume(c, 'follow', 1, DAILY_CAPS)) ok++
    expect(ok).toBe(DAILY_CAPS.follow)                 // ровно cap успешных
    expect(remaining(c, 'follow', DAILY_CAPS)).toBe(0) // дальше 0, не отрицательное
  })
})

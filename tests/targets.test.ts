import { describe, it, expect } from 'vitest'
import { selectTargets } from '@/lib/targets'
import { MAX_NEW_PER_POLL } from '@/lib/limits'

const pkOf = (x: { pk: string }) => x.pk
const items = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ pk: String(i + offset) }))

describe('selectTargets', () => {
  it('первый проход (нет базлайна): ничего не обрабатываем, вся база → known', () => {
    const known = new Set<string>()
    const r = selectTargets(items(5), known, false, pkOf)
    expect(r.fresh).toEqual([])
    expect(r.process).toEqual([])
    expect(known.size).toBe(5) // вся база помечена «видели», без действий
  })

  it('при базлайне: новые = отсутствующие в known', () => {
    const known = new Set(['0', '1'])
    const r = selectTargets(items(4), known, true, pkOf)
    expect(r.fresh.map(pkOf)).toEqual(['2', '3'])
    expect(r.process.map(pkOf)).toEqual(['2', '3'])
    expect(known.has('2')).toBe(true) // обработанные помечены
    expect(known.has('3')).toBe(true)
  })

  it('обрабатываем не больше MAX_NEW_PER_POLL за проход, остальные остаются «новыми»', () => {
    const known = new Set<string>(['x']) // база была → hadBaseline
    const all = items(MAX_NEW_PER_POLL + 5)
    const r = selectTargets(all, known, true, pkOf)
    expect(r.fresh.length).toBe(MAX_NEW_PER_POLL + 5)   // все новые видны
    expect(r.process.length).toBe(MAX_NEW_PER_POLL)      // но обработали только лимит
    // необработанные НЕ помечены known → добьются в следующем цикле
    const processedPks = new Set(r.process.map(pkOf))
    const leftover = r.fresh.filter((x) => !processedPks.has(pkOf(x)))
    expect(leftover.every((x) => !known.has(pkOf(x)))).toBe(true)
  })

  it('«дрип»: limit ограничивает обработку за цикл, остальные новые ждут (не помечены known)', () => {
    const known = new Set<string>(['x'])
    const all = items(10)
    const r = selectTargets(all, known, true, pkOf, 3) // дрип 3 за цикл
    expect(r.fresh.length).toBe(10)      // все 10 видны как новые
    expect(r.process.length).toBe(3)     // обработали только 3
    // 7 необработанных НЕ помечены → добьются в следующих циклах (никто не потерян)
    const processed = new Set(r.process.map(pkOf))
    expect(r.fresh.filter((x) => !processed.has(pkOf(x))).every((x) => !known.has(pkOf(x)))).toBe(true)
  })

  it('limit клампится: 0 → минимум 1; больше MAX_NEW_PER_POLL → MAX', () => {
    const known1 = new Set<string>(['x'])
    expect(selectTargets(items(5), known1, true, pkOf, 0).process.length).toBe(1)   // не меньше 1
    const known2 = new Set<string>(['x'])
    expect(selectTargets(items(MAX_NEW_PER_POLL + 5), known2, true, pkOf, 999).process.length).toBe(MAX_NEW_PER_POLL) // не больше MAX
  })

  it('пустой pk (pkOf → "") исключается из новых', () => {
    const known = new Set<string>(['seed'])
    const all = [{ pk: '' }, { pk: '10' }, { pk: '' }]
    const r = selectTargets(all, known, true, pkOf)
    expect(r.fresh.map(pkOf)).toEqual(['10'])
  })

  it('уже известные не попадают в новые', () => {
    const known = new Set(['5', '6', '7'])
    const r = selectTargets(items(3, 5), known, true, pkOf) // pk 5,6,7
    expect(r.fresh).toEqual([])
    expect(r.process).toEqual([])
  })
})

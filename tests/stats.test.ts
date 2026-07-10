import { describe, it, expect } from 'vitest'
import { readStat, mergeStatsMap } from '@/lib/stats'

describe('readStat', () => {
  it('отсутствующий ключ → {0,0}', () => {
    expect(readStat({}, 'dm')).toEqual({ fired: 0, done: 0 })
    expect(readStat(null, 'dm')).toEqual({ fired: 0, done: 0 })
  })
  it('легаси-число (только успехи) → fired=done', () => {
    expect(readStat({ dm: 12 }, 'dm')).toEqual({ fired: 12, done: 12 })
  })
  it('объект {fired,done} читается как есть', () => {
    expect(readStat({ dm: { fired: 5, done: 3 } }, 'dm')).toEqual({ fired: 5, done: 3 })
  })
})

describe('mergeStatsMap', () => {
  it('складывает прибавки fired/done к текущему', () => {
    const out = mergeStatsMap({ dm: { fired: 2, done: 1 } }, { dm: 3 }, { dm: 2 })
    expect(out.dm).toEqual({ fired: 5, done: 3 })
  })
  it('апгрейдит легаси-число при слиянии', () => {
    const out = mergeStatsMap({ like: 4 }, { like: 1 }, { like: 1 })
    expect(out.like).toEqual({ fired: 5, done: 5 })
  })
  it('объединяет ключи из cur, incFired, incDone', () => {
    const out = mergeStatsMap({ dm: { fired: 1, done: 1 } }, { follow: 2 }, { story: 1 })
    expect(out.dm).toEqual({ fired: 1, done: 1 })
    expect(out.follow).toEqual({ fired: 2, done: 0 })
    expect(out.story).toEqual({ fired: 0, done: 1 })
  })
  it('пустые входы не падают', () => {
    expect(mergeStatsMap(null, {}, {})).toEqual({})
  })
})

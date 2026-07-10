import { describe, it, expect } from 'vitest'
import { norm, levenshtein, similarity, matchPhrase } from '@/lib/match'

describe('norm', () => {
  it('нижний регистр, пунктуация→пробел, схлопывание пробелов', () => {
    expect(norm('  Guest   List!! ')).toBe('guest list')
    expect(norm('Hey, is this THE list?')).toBe('hey is this the list')
  })
  it('пустое/nullish → пустая строка', () => {
    expect(norm('')).toBe('')
    expect(norm(undefined as any)).toBe('')
  })
})

describe('levenshtein / similarity', () => {
  it('одинаковые строки → расстояние 0, близость 1', () => {
    expect(levenshtein('list', 'list')).toBe(0)
    expect(similarity('list', 'list')).toBe(1)
  })
  it('одна правка → расстояние 1', () => {
    expect(levenshtein('gest list', 'guest list')).toBe(1)
  })
  it('обе пустые → близость 1', () => {
    expect(similarity('', '')).toBe(1)
  })
})

describe('matchPhrase', () => {
  it('mode=all или отсутствие match → всегда true', () => {
    expect(matchPhrase('что угодно', { mode: 'all' })).toBe(true)
    expect(matchPhrase('что угодно', null)).toBe(true)
  })
  it('specific без фраз → true (реагируем всегда)', () => {
    expect(matchPhrase('текст', { mode: 'specific', phrases: [] })).toBe(true)
  })
  it('exact: совпадение нормализованной фразы (регистр/пунктуация игнорируются)', () => {
    const m = { mode: 'specific', phrases: ['guest list'], exact: true }
    expect(matchPhrase('Guest List!', m)).toBe(true)
    expect(matchPhrase('guest lists', m)).toBe(false)
  })
  it('нестрого: подстрока', () => {
    const m = { mode: 'specific', phrases: ['guest list'], exact: false }
    expect(matchPhrase('Hey, is this the guest list?', m)).toBe(true)
  })
  it('нестрого: опечатка (близость)', () => {
    const m = { mode: 'specific', phrases: ['guest list'], exact: false }
    expect(matchPhrase('gest list', m)).toBe(true)
  })
  it('нестрого: нет совпадения → false', () => {
    const m = { mode: 'specific', phrases: ['guest list'], exact: false }
    expect(matchPhrase('random comment here', m)).toBe(false)
  })
  it('пустой текст при заданных фразах → false', () => {
    expect(matchPhrase('', { mode: 'specific', phrases: ['guest list'], exact: false })).toBe(false)
  })
})

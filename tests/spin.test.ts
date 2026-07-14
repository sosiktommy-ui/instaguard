import { describe, it, expect } from 'vitest'
import { spin, renderMessage } from '@/lib/spin'

describe('spin (spintax)', () => {
  it('выбирает один из вариантов {a|b|c}', () => {
    for (let i = 0; i < 50; i++) {
      const r = spin('{a|b|c}')
      expect(['a', 'b', 'c']).toContain(r)
    }
  })
  it('текст без спинтакса не меняется', () => {
    expect(spin('привет, друг!')).toBe('привет, друг!')
  })
  it('разворачивает вложенный спинтакс', () => {
    for (let i = 0; i < 30; i++) {
      const r = spin('{Привет|{Хай|Хеллоу}}')
      expect(['Привет', 'Хай', 'Хеллоу']).toContain(r)
    }
  })
  it('несколько групп в одной строке', () => {
    for (let i = 0; i < 30; i++) {
      const r = spin('{Привет|Хай}, {друг|подписчик}!')
      expect(r).toMatch(/^(Привет|Хай), (друг|подписчик)!$/)
    }
  })
})

describe('renderMessage', () => {
  it('подставляет {{username}} ДО спинтакса (значение не съедается)', () => {
    const r = renderMessage('{Привет|Хай}, {{username}}!', 'john')
    expect(r).toMatch(/^(Привет|Хай), john!$/)
  })
  it('выбирает случайный шаблон из массива и разворачивает spintax', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 80; i++) seen.add(renderMessage(['A', 'B', 'C'], 'x'))
    // при 80 прогонах почти наверняка встретятся хотя бы 2 разных шаблона
    expect(seen.size).toBeGreaterThan(1)
  })
  it('пустой набор → пустая строка', () => {
    expect(renderMessage([], 'x')).toBe('')
    expect(renderMessage(['', '  '], 'x')).toBe('')
  })
  it('фильтрует пустые шаблоны', () => {
    expect(renderMessage(['', 'привет'], 'x')).toBe('привет')
  })
})

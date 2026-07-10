import { describe, it, expect } from 'vitest'
import { localeForCountry } from '@/lib/browser/geo'

describe('localeForCountry', () => {
  it('известная страна → локаль + таймзона', () => {
    expect(localeForCountry('United States')).toEqual({ locale: 'en-US', timezoneId: 'America/New_York' })
    expect(localeForCountry('poland')).toEqual({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw' })
  })
  it('регистронезависимо и с обрезкой пробелов', () => {
    expect(localeForCountry('  BRAZIL  ')).toEqual({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  })
  it('аккаунты проекта id_ID/pt_BR/en_PH', () => {
    expect(localeForCountry('Indonesia')?.locale).toBe('id-ID')
    expect(localeForCountry('Philippines')?.locale).toBe('en-PH')
  })
  it('синонимы страны дают одну локаль', () => {
    expect(localeForCountry('czechia')).toEqual(localeForCountry('Czech Republic'))
  })
  it('пустое/nullish → null', () => {
    expect(localeForCountry(null)).toBeNull()
    expect(localeForCountry(undefined)).toBeNull()
    expect(localeForCountry('')).toBeNull()
  })
  it('нераспознанная страна → null (падение на дефолт fingerprint)', () => {
    expect(localeForCountry('Narnia')).toBeNull()
  })
})

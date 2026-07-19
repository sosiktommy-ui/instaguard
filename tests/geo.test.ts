import { describe, it, expect } from 'vitest'
import { localeForCountry, localeFromProxyString } from '@/lib/browser/geo'

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

describe('localeFromProxyString (гео-хинт из строки прокси)', () => {
  it('реальный кейс rp.proxxxymiron.cc: country-PL → Польша', () => {
    expect(localeFromProxyString('KGLvZQv6GFOqyFepEA5m_country-PL_city-warsaw'))
      .toEqual({ locale: 'pl-PL', timezoneId: 'Europe/Warsaw' })
  })
  it('полная строка прокси (scheme://user:pass@host:port) с country-PL', () => {
    const full = 'http://u36387_h35p:KGLvZQv6GFOqyFepEA5m_country-PL_city-warsaw@rp.proxxxymiron.cc:1000'
    expect(localeFromProxyString(full)?.locale).toBe('pl-PL')
  })
  it('разные хинты и разделители: cc-us / region-id / geo-br / country=de', () => {
    expect(localeFromProxyString('user-cc-us-sess-1:pass')?.locale).toBe('en-US')
    expect(localeFromProxyString('zone-resi-region-id-x')?.locale).toBe('id-ID')
    expect(localeFromProxyString('acc_geo-br_rotate')?.locale).toBe('pt-BR')
    expect(localeFromProxyString('u1_country=DE_x')?.locale).toBe('de-DE')
  })
  it('индонезия для аккаунтов проекта: country-ID → id-ID/Asia/Jakarta', () => {
    expect(localeFromProxyString('proxy_country-ID_mobile'))
      .toEqual({ locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
  })
  it('НЕТ ложных совпадений: домен .cc и случайные подстроки → null', () => {
    expect(localeFromProxyString('http://user:pass@rp.proxxxymiron.cc:1000')).toBeNull()
    expect(localeFromProxyString('host.example.com:8080:login:password')).toBeNull()
    expect(localeFromProxyString('KGLvZQv6GFOqyFepEA5m')).toBeNull()
  })
  it('неизвестный ISO-код в хинте → null (не выдумываем локаль)', () => {
    expect(localeFromProxyString('proxy_country-XX_zone')).toBeNull()
  })
  it('пустое/nullish → null', () => {
    expect(localeFromProxyString(null)).toBeNull()
    expect(localeFromProxyString(undefined)).toBeNull()
    expect(localeFromProxyString('')).toBeNull()
  })
})

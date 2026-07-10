import { describe, it, expect } from 'vitest'
import { normalizeCookies } from '@/lib/cookies'

describe('normalizeCookies — форматы куки Instagram', () => {
  it('пусто → ошибка', () => {
    const r = normalizeCookies('   ')
    expect(r.kind).toBe('unknown')
    expect(r.error).toBeTruthy()
  })

  it('сырой sessionid-токен', () => {
    const r = normalizeCookies('12345678%3AabcDEFghij%3A9')
    expect(r.kind).toBe('instagram')
    expect(r.cookies.sessionid).toBe('12345678%3AabcDEFghij%3A9')
    expect(r.error).toBeUndefined()
  })

  it('заголовок k=v; k=v', () => {
    const r = normalizeCookies('sessionid=abc123; ds_user_id=555; csrftoken=tok')
    expect(r.kind).toBe('instagram')
    expect(r.cookies.sessionid).toBe('abc123')
    expect(r.cookies.ds_user_id).toBe('555')
    expect(r.cookies.csrftoken).toBe('tok')
  })

  it('JSON-массив Cookie-Editor [{name,value}]', () => {
    const arr = JSON.stringify([
      { name: 'sessionid', value: 'sess1' },
      { name: 'ds_user_id', value: 777 },
      { name: 'csrftoken', value: 'csrf1' },
    ])
    const r = normalizeCookies(arr)
    expect(r.kind).toBe('instagram')
    expect(r.cookies.sessionid).toBe('sess1')
    expect(r.cookies.ds_user_id).toBe('777') // число приводится к строке
  })

  it('JSON-объект-словарь', () => {
    const r = normalizeCookies(JSON.stringify({ sessionid: 'objsess', csrftoken: 'c' }))
    expect(r.kind).toBe('instagram')
    expect(r.cookies.sessionid).toBe('objsess')
  })

  it('Netscape cookies.txt с #HttpOnly_ (sessionid не теряется)', () => {
    const txt = [
      '# Netscape HTTP Cookie File',
      '.instagram.com\tTRUE\t/\tTRUE\t1799999999\tds_user_id\t42',
      '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1799999999\tsessionid\t42%3Asecret%3A1',
      '.instagram.com\tTRUE\t/\tTRUE\t1799999999\tcsrftoken\tcsrfval',
    ].join('\n')
    const r = normalizeCookies(txt)
    expect(r.kind).toBe('instagram')
    expect(r.cookies.sessionid).toBe('42%3Asecret%3A1')
    expect(r.cookies.ds_user_id).toBe('42')
    expect(r.cookies.csrftoken).toBe('csrfval')
  })

  it('мобильная Android-сессия (Bearer) уходит воркеру как есть', () => {
    const raw = 'user:pass:2fa|Instagram 428.0.0.47.67 Android|device-ids|Authorization=Bearer IGT:2:token|'
    const r = normalizeCookies(raw)
    expect(r.kind).toBe('mobile')
    expect(r.cookies.sessionid).toBe(raw)
  })

  it('куки Facebook (c_user/xs без sessionid) → понятная ошибка', () => {
    const r = normalizeCookies('c_user=100; xs=abc; fr=xyz')
    expect(r.kind).toBe('facebook')
    expect(r.error).toMatch(/Instagram/)
    expect(r.cookies.sessionid).toBeUndefined()
  })

  it('мусор без sessionid → ошибка unknown', () => {
    const r = normalizeCookies('foo=bar; baz=qux')
    expect(r.kind).toBe('unknown')
    expect(r.error).toBeTruthy()
  })
})

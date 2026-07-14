import { describe, it, expect } from 'vitest'
import { humanizeLog, isDiagnostic } from '@/lib/logText'

describe('humanizeLog — жаргон → человеческий язык (§1.5)', () => {
  it('«Body has already been read» → человеческий текст, без токенов', () => {
    const out = humanizeLog('Уведомления (self-events) сбой: Body is unusable: Body has already been read')
    expect(out).not.toMatch(/Body|self-events|unusable/i)
    expect(out).toMatch(/повторим автоматически/)
  })

  it('login_required → «сессия истекла — войдите заново»', () => {
    const out = humanizeLog('Уведомления (self-events) не прочитаны: login_required: сессия недействительна — нужен повторный вход')
    expect(out).not.toMatch(/login_required|self-events/i)
    expect(out).toMatch(/войдите заново/)
  })

  it('таймаут /session/run → человеческий текст без пути эндпоинта', () => {
    const out = humanizeLog('Ошибка проверки: Таймаут 180с: браузерный воркер не ответил (/session/run)')
    expect(out).not.toMatch(/session\/run|180|воркер/i)
    expect(out).toMatch(/слишком долго/)
  })

  it('«выполняю действия по N» → «обрабатываю N»', () => {
    expect(humanizeLog('Новых подписок: 2, выполняю действия по 2.')).toBe('Новых подписок: 2, обрабатываю 2.')
  })

  it('идемпотентна и не трогает уже человеческий текст', () => {
    const human = 'Сработал триггер «Приветствие» → @user'
    expect(humanizeLog(human)).toBe(human)
    expect(humanizeLog(humanizeLog(human))).toBe(human)
  })

  it('не оставляет пустых скобок и двойных пробелов', () => {
    const out = humanizeLog('Уведомления (self-events) прочитаны')
    expect(out).not.toMatch(/\(\s*\)|\s{2,}/)
  })
})

describe('isDiagnostic — шум пустых циклов скрыт по умолчанию', () => {
  it('диагностические строки распознаются', () => {
    expect(isDiagnostic('Уведомления прочитаны: всего 15 (подписки 9 · лайки 2 · комменты 4)')).toBe(true)
    expect(isDiagnostic('Новых подписок нет (в уведомлениях 0, все уже обработаны).')).toBe(true)
    expect(isDiagnostic('Заявок в подписчики нет (ожидающих: 0)')).toBe(true)
  })
  it('реальные события НЕ диагностические', () => {
    expect(isDiagnostic('Сработал триггер «Приветствие» → @user')).toBe(false)
    expect(isDiagnostic('Приняты заявки в подписчики: @x (из 1 ожидавших)')).toBe(false)
    expect(isDiagnostic('Новых подписок: 2, выполняю действия по 2.')).toBe(false)
  })
})

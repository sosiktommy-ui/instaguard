import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitProxy } from '../lib/proxy.js'

// Юнит-тесты разбора строки прокси (§10.1 PLAN-IDEAL). Без сети — чистая функция.
// Раннер: `node --test` из workers/browser (Node 18+, встроенный, без зависимостей).

test('пусто/не-строка → null', () => {
  assert.equal(splitProxy(null), null)
  assert.equal(splitProxy(''), null)
  assert.equal(splitProxy('   '), null)
  assert.equal(splitProxy(123), null)
})

test('host:port:user:pass (формат продавца без схемы)', () => {
  assert.deepEqual(splitProxy('1.2.3.4:8080:bob:secret'), {
    scheme: null, hostPort: '1.2.3.4:8080', username: 'bob', password: 'secret',
  })
})

test('user:pass@host:port', () => {
  assert.deepEqual(splitProxy('bob:secret@1.2.3.4:8080'), {
    scheme: null, hostPort: '1.2.3.4:8080', username: 'bob', password: 'secret',
  })
})

test('схема socks5:// сохраняется', () => {
  assert.deepEqual(splitProxy('socks5://1.2.3.4:1080'), {
    scheme: 'socks5', hostPort: '1.2.3.4:1080', username: undefined, password: undefined,
  })
})

test('схема + креды @-формы', () => {
  assert.deepEqual(splitProxy('http://bob:secret@1.2.3.4:8080'), {
    scheme: 'http', hostPort: '1.2.3.4:8080', username: 'bob', password: 'secret',
  })
})

test('пароль с двоеточием (@-форма) — делится по первому :', () => {
  const p = splitProxy('bob:pa:ss:word@1.2.3.4:8080')
  assert.equal(p.username, 'bob')
  assert.equal(p.password, 'pa:ss:word')
  assert.equal(p.hostPort, '1.2.3.4:8080')
})

test('host:port без кредов', () => {
  assert.deepEqual(splitProxy('1.2.3.4:8080'), {
    scheme: null, hostPort: '1.2.3.4:8080', username: undefined, password: undefined,
  })
})

test('нет двоеточия в hostPort → null', () => {
  assert.equal(splitProxy('justhost'), null)
})

// ── Регресс живого кейса 2026-07-16 ────────────────────────────────────────────
// Пользователь вставил ТОЛЬКО логин:пароль резидентного прокси (шлюз host:port провайдер даёт
// отдельно). Раньше это молча трактовалось как host:port → Chromium получал несуществующий хост
// и «порт»-строку → ERR_PROXY_CONNECTION_FAILED («прокси моргнул»), хотя прокси живой.
test('логин:пароль БЕЗ host:port → null (порт не число)', () => {
  assert.equal(splitProxy('u36387_h35p:KGLvZQv6GFOqyFepEA5m_session-2LOtwC9Q_lifetime-1440'), null)
})

test('порт не число → null (не принимаем за host:port)', () => {
  assert.equal(splitProxy('host:notaport'), null)
  assert.equal(splitProxy('user:pass'), null)
  assert.equal(splitProxy('1.2.3.4:99999'), null)   // порт вне 1..65535
})

// Резидентные провайдеры зашивают session/lifetime В ПАРОЛЬ; пароль может содержать ':'.
test('host:port:user:pass — пароль с двоеточием склеивается', () => {
  assert.deepEqual(splitProxy('gate.provider.com:7000:u36387_h35p:pa:ss_session-XX'), {
    scheme: null, hostPort: 'gate.provider.com:7000', username: 'u36387_h35p', password: 'pa:ss_session-XX',
  })
})

test('реальный формат резидентного прокси с session/lifetime в пароле', () => {
  assert.deepEqual(splitProxy('gate.provider.com:7000:u36387_h35p:KGLvZQv6GFOqyFepEA5m_session-2LOtwC9Q_lifetime-1440'), {
    scheme: null,
    hostPort: 'gate.provider.com:7000',
    username: 'u36387_h35p',
    password: 'KGLvZQv6GFOqyFepEA5m_session-2LOtwC9Q_lifetime-1440',
  })
})

// ── Формат «user:pass:host:port» (порт ПОСЛЕДНИЙ, без '@') ────────────────────
// Реальная строка провайдера rp.proxxxymiron.cc (живой кейс 2026-07-16): раньше логин
// принимался за хост → ERR_PROXY_CONNECTION_FAILED на РАБОЧЕМ прокси.
test('socks5://user:pass:host:port — реальный формат провайдера', () => {
  assert.deepEqual(
    splitProxy('socks5://u36387_h35p:KGLvZQv6GFOqyFepEA5m_session-2LOtwC9Q_lifetime-1440:rp.proxxxymiron.cc:1002'),
    {
      scheme: 'socks5',
      hostPort: 'rp.proxxxymiron.cc:1002',
      username: 'u36387_h35p',
      password: 'KGLvZQv6GFOqyFepEA5m_session-2LOtwC9Q_lifetime-1440',
    },
  )
})

test('user:pass:host:port без схемы', () => {
  assert.deepEqual(splitProxy('bob:secret:1.2.3.4:8080'), {
    scheme: null, hostPort: '1.2.3.4:8080', username: 'bob', password: 'secret',
  })
})

test('user:pass:host:port — пароль с двоеточием (середина склеивается)', () => {
  assert.deepEqual(splitProxy('bob:pa:ss_session-X:1.2.3.4:8080'), {
    scheme: null, hostPort: '1.2.3.4:8080', username: 'bob', password: 'pa:ss_session-X',
  })
})

// Порт ВТОРОЙ выигрывает у порта последнего — классика «host:port:user:pass» не ломается.
test('host:port:user:pass приоритетнее, если порт стоит вторым', () => {
  assert.deepEqual(splitProxy('1.2.3.4:8080:bob:9999'), {
    scheme: null, hostPort: '1.2.3.4:8080', username: 'bob', password: '9999',
  })
})

// ── ВСЕ 4 формата, которые предлагает бот провайдера (rp.proxxxymiron.cc) ──────
// Пользователь может переключить формат в кабинете — бот обязан понять любой.
test('все 4 формата провайдера разбираются одинаково', () => {
  const want = { hostPort: 'rp.proxxxymiron.cc:1000', username: 'u36387_h35p', password: 'PaSs_session-XX_lifetime-1440' }
  const variants = [
    'u36387_h35p:PaSs_session-XX_lifetime-1440@rp.proxxxymiron.cc:1000',   // login:password@host:port
    'u36387_h35p:PaSs_session-XX_lifetime-1440:rp.proxxxymiron.cc:1000',   // login:password:host:port
    'rp.proxxxymiron.cc:1000@u36387_h35p:PaSs_session-XX_lifetime-1440',   // host:port@login:password
    'rp.proxxxymiron.cc:1000:u36387_h35p:PaSs_session-XX_lifetime-1440',   // host:port:login:password
  ]
  for (const v of variants) {
    const p = splitProxy(v)
    assert.ok(p, `не разобрался: ${v}`)
    assert.equal(p.hostPort, want.hostPort, `hostPort у: ${v}`)
    assert.equal(p.username, want.username, `username у: ${v}`)
    assert.equal(p.password, want.password, `password у: ${v}`)
  }
})

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

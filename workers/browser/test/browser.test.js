import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTransientNavError } from '../lib/browser.js'

// §0.1 PLAN.md: gotoResilient должен ретраить ТОЛЬКО транспортные сбои прокси-коннекта,
// а не тратить ретраи на исходы, которые повтор не починит. Без сети — чистая функция.

test('транспортные ошибки Chromium (net::ERR_*) → транзиентно', () => {
  assert.equal(isTransientNavError(new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://x')), true)
  assert.equal(isTransientNavError(new Error('net::ERR_CONNECTION_RESET')), true)
  assert.equal(isTransientNavError(new Error('net::ERR_SOCKS_CONNECTION_FAILED')), true)
  assert.equal(isTransientNavError(new Error('net::ERR_NAME_NOT_RESOLVED')), true)
})

test('таймаут Playwright → транзиентно', () => {
  assert.equal(isTransientNavError(new Error('page.goto: Timeout 35000ms exceeded.')), true)
})

test('5xx от прокси-эджа → транзиентно', () => {
  assert.equal(isTransientNavError(new Error('upstream error 502 bad gateway')), true)
  assert.equal(isTransientNavError(new Error('proxy responded 503')), true)
})

test('закрытый контекст/оторванный фрейм → НЕ транзиентно (повтор не поможет)', () => {
  assert.equal(isTransientNavError(new Error('Target page, context or browser has been closed')), false)
  assert.equal(isTransientNavError(new Error('Execution context was destroyed, most likely because of a navigation')), false)
  assert.equal(isTransientNavError(new Error('Node is detached from document')), false)
})

test('логические исходы (не сетевые) → НЕ транзиентно', () => {
  assert.equal(isTransientNavError(new Error('wrong_profile: открылся не профиль @bob')), false)
  assert.equal(isTransientNavError(new Error('login_required: сессия недействительна')), false)
})

test('пусто/не-Error → НЕ транзиентно (безопасный дефолт — не ретраим неизвестное молча)', () => {
  assert.equal(isTransientNavError(undefined), false)
  assert.equal(isTransientNavError(new Error('')), false)
})

// Локальный генератор сессий Instagram (storageState) для «упрямых» аккаунтов.
// См. plan.md §2.1 / §Фаза 1. Запускается на ПК пользователя в ВИДИМОМ окне: вход идёт
// как обычный браузер (не headless — Instagram его не палит), checkpoint/капчу/2FA-подтверждение
// пользователь решает ГЛАЗАМИ. На выходе — storageState (cookies+localStorage), который
// вставляется в приложение через «Импорт списком» (режим «Куки»/«Сессия») или «+ Аккаунт → Куки».
//
// Тот же артефакт, что и облачный вход (InstagramAccount.browserState) — полностью взаимозаменяемо.
//
// Запуск:
//   cd tools/cookie-gen && npm install && npm start
// Формат accounts.txt (одна строка = один аккаунт), поля через пробел или `:` :
//   логин пароль
//   логин пароль 2fa-ключ(base32)
//   логин пароль 2fa-ключ proxy(host:port:user:pass или http://user:pass@host:port)
// Пустые строки и начинающиеся с # игнорируются.

import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ACCOUNTS_FILE = path.join(DIR, 'accounts.txt')
const OUT_DIR = path.join(DIR, 'output')
const SESSIONS_FILE = path.join(DIR, 'sessions.txt') // по строке на аккаунт — удобно копировать

// ── TOTP (2FA-ключ base32 → код), без внешних зависимостей ──
function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    const i = alphabet.indexOf(c)
    if (i >= 0) bits += i.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
function totpCode(secret) {
  const key = base32Decode(secret)
  const epoch = Math.floor(Date.now() / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(epoch / 2 ** 32), 0)
  buf.writeUInt32BE(epoch >>> 0, 4)
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const off = hmac[hmac.length - 1] & 0xf
  const code = ((hmac[off] & 0x7f) << 24) | ((hmac[off + 1] & 0xff) << 16) | ((hmac[off + 2] & 0xff) << 8) | (hmac[off + 3] & 0xff)
  return (code % 1000000).toString().padStart(6, '0')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Разбор прокси в объект Playwright ({server, username?, password?}).
function parseProxy(raw) {
  if (!raw) return undefined
  let s = raw.trim()
  let scheme = 'http'
  const m = s.match(/^(\w+):\/\//)
  if (m) { scheme = m[1]; s = s.slice(m[0].length) }
  let username, password, hostPort
  if (s.includes('@')) {
    const at = s.lastIndexOf('@')
    const creds = s.slice(0, at); hostPort = s.slice(at + 1)
    const ci = creds.indexOf(':')
    if (ci >= 0) { username = creds.slice(0, ci); password = creds.slice(ci + 1) } else username = creds
  } else {
    const parts = s.split(':')
    if (parts.length === 4) { hostPort = `${parts[0]}:${parts[1]}`; username = parts[2]; password = parts[3] }
    else hostPort = s
  }
  if (!hostPort) return undefined
  const out = { server: `${scheme}://${hostPort}` }
  if (username) out.username = username
  if (password !== undefined) out.password = password
  return out
}

function parseLine(line) {
  // поля через пробел ИЛИ `:` (но не внутри URL прокси). Простой разбор по пробелам, затем по `:`.
  const parts = line.trim().split(/\s+/).filter(Boolean)
  let tokens = parts
  if (parts.length === 1 && parts[0].includes(':')) tokens = parts[0].split(':')
  const [login, password, twofa, proxy] = tokens
  return { login, password, twofa, proxy }
}

async function hasSession(context) {
  try {
    const cookies = await context.cookies('https://www.instagram.com')
    return cookies.some((c) => c.name === 'sessionid' && c.value)
  } catch { return false }
}

async function doAccount(acc, index, total) {
  console.log(`\n[${index + 1}/${total}] ${acc.login} — открываю окно…`)
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--lang=en-US'],
  })
  const context = await browser.newContext({
    proxy: parseProxy(acc.proxy),
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
  })
  await context.addInitScript(() => { try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) } catch {} })

  try {
    const page = await context.newPage()
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(2000)
    // Куки-баннер
    for (const t of ['Allow all cookies', 'Accept All', 'Accept']) {
      const b = page.getByRole('button', { name: t, exact: true }).first()
      if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break }
    }
    // Логин/пароль
    const user = page.locator('input[name="username"]').first()
    const pass = page.locator('input[name="password"]').first()
    if (await user.isVisible().catch(() => false)) {
      await user.fill(acc.login)
      await pass.fill(acc.password)
      await page.locator('button[type="submit"]').first().click().catch(() => {})
      await sleep(3000)
      // Если попросят 2FA-код и ключ задан — подставим
      if (acc.twofa) {
        const code = page.locator('input[name="verificationCode"], input[autocomplete="one-time-code"]').first()
        if (await code.isVisible().catch(() => false)) {
          await code.fill(totpCode(acc.twofa))
          await page.locator('button[type="submit"]').first().click().catch(() => {})
        }
      }
    }

    // Ждём сессию до 4 минут — пользователь может РУКАМИ решить checkpoint/капчу в окне.
    console.log('   Если Instagram просит код/капчу/подтверждение — решите ПРЯМО В ОКНЕ. Жду вход (до 4 мин)…')
    const deadline = Date.now() + 4 * 60 * 1000
    let ok = false
    while (Date.now() < deadline) {
      if (await hasSession(context)) { ok = true; break }
      await sleep(2000)
    }
    if (!ok) { console.log('   ⏭️  Вход не завершён за 4 мин — пропускаю. Можно перезапустить для этой строки.'); return null }

    const state = await context.storageState()
    fs.mkdirSync(OUT_DIR, { recursive: true })
    fs.writeFileSync(path.join(OUT_DIR, `${acc.login}.json`), JSON.stringify(state, null, 2))
    fs.appendFileSync(SESSIONS_FILE, JSON.stringify(state) + '\n')
    console.log(`   ✅ Готово. Сессия сохранена: output/${acc.login}.json (и строкой в sessions.txt).`)
    return state
  } catch (e) {
    console.log(`   ❌ Ошибка: ${String(e?.message || e).slice(0, 160)}`)
    return null
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function main() {
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    console.error(`Нет файла accounts.txt рядом со скриптом (${ACCOUNTS_FILE}).`)
    console.error('Скопируйте accounts.example.txt → accounts.txt и впишите аккаунты.')
    process.exit(1)
  }
  const lines = fs.readFileSync(ACCOUNTS_FILE, 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  const accounts = lines.map(parseLine).filter((a) => a.login && a.password)
  if (!accounts.length) { console.error('В accounts.txt нет валидных строк «логин пароль …».'); process.exit(1) }

  console.log(`Аккаунтов к обработке: ${accounts.length}. Окна открываются по одному.`)
  fs.writeFileSync(SESSIONS_FILE, '') // очистить прошлый прогон
  let done = 0
  for (let i = 0; i < accounts.length; i++) {
    const r = await doAccount(accounts[i], i, accounts.length)
    if (r) done++
  }
  console.log(`\nИтог: ${done}/${accounts.length} сессий получено.`)
  console.log('Вставьте содержимое sessions.txt в приложение: «Аккаунты → Импорт списком» (режим «Куки»),')
  console.log('одна строка = один аккаунт. Или по одному: «+ Аккаунт → 🍪 Куки» — вставить JSON из output/<логин>.json.')

  // Ждём Enter, чтобы окно консоли не закрылось мгновенно на Windows.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await new Promise((res) => rl.question('\nНажмите Enter для выхода…', () => { rl.close(); res() }))
}

main().catch((e) => { console.error(e); process.exit(1) })

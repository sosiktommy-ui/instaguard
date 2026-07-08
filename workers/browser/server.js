// Браузерный воркер InstaGuard — вход и действия Instagram через реальный Chromium.
// См. plan.md §4. Контракт ответов согласован с lib/browser/client.ts в Next.js.
import express from 'express'
import { getBrowser, newAccountContext, closeContextSafe } from './lib/browser.js'
import { attemptLogin, resumeCode, resendCode, loginByState, testSession } from './lib/login.js'
import { sendDM, followUser, likeUser, viewStories, commentPost, replyComment } from './lib/actions.js'
import { toStorageState } from './lib/state.js'

const BUILD = '2026-07-09-browser-1'
const SECRET = process.env.BROWSER_WORKER_SECRET || ''
const PORT = Number(process.env.PORT) || 8090
const MAX = Number(process.env.BROWSER_CONCURRENCY) || 2

const app = express()
app.use(express.json({ limit: '8mb' }))

// ── Авторизация ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/health') return next()
  if (SECRET && req.get('X-Worker-Secret') !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
})

// ── Ограничение конкуренции (Chromium прожорлив по RAM) ──────────────────────
let active = 0
const queue = []
function next() { if (queue.length && active < MAX) queue.shift()() }
function runLimited(fn) {
  return new Promise((resolve, reject) => {
    const task = () => {
      active++
      Promise.resolve().then(fn).then(
        (v) => { active--; next(); resolve(v) },
        (e) => { active--; next(); reject(e) },
      )
    }
    if (active < MAX) task()
    else queue.push(task)
  })
}

// ── Хранилище незавершённых входов (challenge/2FA) между /login и /login/checkpoint ──
// Контекст с живой страницей мид-флоу держим в памяти по username. TTL 6 мин.
const pending = new Map() // username → { context, createdAt }
const PENDING_TTL = 6 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of pending) {
    if (now - v.createdAt > PENDING_TTL) { closeContextSafe(v.context); pending.delete(k) }
  }
}, 60 * 1000).unref?.()

async function clearPending(username) {
  const p = pending.get(username)
  if (p) { await closeContextSafe(p.context); pending.delete(username) }
}

function errStatus(message) {
  const kind = String(message).split(':')[0]
  return { kind, message: String(message) }
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  let chromium = 'not-launched'
  try { const b = await getBrowser(); chromium = b.version() } catch (e) { chromium = 'error: ' + e.message }
  res.json({ ok: true, build: BUILD, playwright: true, chromium, concurrency: MAX, active, pending: pending.size })
})

// Вход по логину/паролю.
app.post('/login', async (req, res) => {
  const { username, password, proxy, totpSecret, locale, timezoneId } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'bad_request', message: 'username и password обязательны' })
  const uname = String(username).replace(/^@/, '').trim().toLowerCase()
  try {
    const result = await runLimited(async () => {
      await clearPending(uname)
      const context = await newAccountContext({ username: uname, proxy, locale, timezoneId })
      try {
        const r = await attemptLogin(context, { username: uname, password, totpSecret })
        if (r.ok) { await closeContextSafe(context); return { ok: true, browserState: r.storageState, username: r.username } }
        // challenge/2FA — контекст держим для ввода кода
        pending.set(uname, { context, createdAt: Date.now() })
        return r.needs2fa
          ? { needs2fa: true, username: uname }
          : { needsCheckpoint: true, channel: r.channel ?? null, username: uname }
      } catch (e) {
        await closeContextSafe(context)
        throw e
      }
    })
    res.json(result)
  } catch (e) {
    const { kind, message } = errStatus(e.message)
    res.status(400).json({ error: kind, message })
  }
})

// Ввод кода (challenge ИЛИ 2FA) — довод входа на сохранённом контексте.
app.post('/login/checkpoint', async (req, res) => {
  const { username, code } = req.body || {}
  const uname = String(username || '').replace(/^@/, '').trim().toLowerCase()
  const p = pending.get(uname)
  if (!p) return res.status(400).json({ error: 'expired', message: 'Сессия ввода кода истекла — начните вход заново' })
  try {
    const result = await runLimited(() => resumeCode(p.context, { code }))
    await clearPending(uname)
    res.json({ ok: true, browserState: result.storageState, username: result.username === 'unknown' ? uname : result.username })
  } catch (e) {
    const { kind, message } = errStatus(e.message)
    if (kind === 'expired') await clearPending(uname) // истёк — чистим; bad_code оставляем для повтора
    res.status(400).json({ error: kind, message })
  }
})

// Повторно отправить код.
app.post('/login/resend', async (req, res) => {
  const uname = String(req.body?.username || '').replace(/^@/, '').trim().toLowerCase()
  const p = pending.get(uname)
  if (!p) return res.status(400).json({ error: 'expired', message: 'Сессия ввода кода истекла' })
  try { const r = await resendCode(p.context); res.json({ ok: r.ok }) }
  catch (e) { res.status(400).json({ error: 'resend_failed', message: e.message }) }
})

// Вход по готовой сессии/кукам (storageState).
app.post('/login/cookies', async (req, res) => {
  const { cookies, storageState, proxy, locale, timezoneId } = req.body || {}
  const state = toStorageState(storageState ?? cookies)
  if (!state.cookies.length) return res.status(400).json({ error: 'bad_cookies', message: 'Не удалось разобрать куки/сессию' })
  try {
    const result = await runLimited(async () => {
      const context = await newAccountContext({ username: 'import', proxy, storageState: state, locale, timezoneId })
      try { return await loginByState(context) }
      finally { await closeContextSafe(context) }
    })
    res.json({ ok: true, browserState: result.storageState, username: result.username })
  } catch (e) {
    const { kind, message } = errStatus(e.message)
    res.status(400).json({ error: kind, message })
  }
})

// Проверка живости сессии.
app.post('/session/test', async (req, res) => {
  const { storageState, proxy, username } = req.body || {}
  try {
    const alive = await runLimited(async () => {
      const context = await newAccountContext({ username: username || 'test', proxy, storageState })
      try { return await testSession(context) }
      finally { await closeContextSafe(context) }
    })
    res.json({ alive })
  } catch { res.json({ alive: false }) }
})

// ── Действия (Фаза 2) ─────────────────────────────────────────────────────────
// Универсальная обёртка: контекст владельца (storageState+username+proxy) → действие → результат.
function actionRoute(fn) {
  return async (req, res) => {
    const { username, storageState, proxy, locale, timezoneId } = req.body || {}
    if (!storageState) return res.status(400).json({ error: 'bad_request', message: 'storageState обязателен' })
    try {
      const result = await runLimited(async () => {
        const context = await newAccountContext({ username: username || 'owner', proxy, storageState, locale, timezoneId })
        try { return await fn(context, req.body) }
        finally { await closeContextSafe(context) }
      })
      res.json(result)
    } catch (e) {
      const { kind, message } = errStatus(e.message)
      res.status(400).json({ error: kind, message })
    }
  }
}

app.post('/dm', actionRoute((ctx, b) => sendDM(ctx, { toUsername: b.toUsername, text: b.text })))
app.post('/follow', actionRoute((ctx, b) => followUser(ctx, { targetUsername: b.targetUsername })))
app.post('/like', actionRoute((ctx, b) => likeUser(ctx, { targetUsername: b.targetUsername, count: b.count })))
app.post('/stories', actionRoute((ctx, b) => viewStories(ctx, { targetUsername: b.targetUsername, like: b.like })))
app.post('/comment', actionRoute((ctx, b) => commentPost(ctx, { postUrl: b.postUrl, text: b.text })))
app.post('/reply-comment', actionRoute((ctx, b) => replyComment(ctx, { postUrl: b.postUrl, text: b.text })))

app.listen(PORT, () => console.log(`🌐 browser-worker ${BUILD} на :${PORT} (concurrency=${MAX})`))

// Браузерный воркер InstaGuard — вход и действия Instagram через реальный Chromium.
// См. plan.md §4. Контракт ответов согласован с lib/browser/client.ts в Next.js.
import express from 'express'
import { getBrowser, newAccountContext, closeContextSafe, getOrCreateContext, touchContext, evictContext, isCtxWarmed, markCtxWarmed } from './lib/browser.js'
import { attemptLogin, resumeCode, resumeWithTotp, resendCode, loginByState, testSession, warmupSession, rereadUsername, extractUsername, fillImageCaptcha, domSummary, captureDiag } from './lib/login.js'
import { safeStorageState } from './lib/browser.js'
import { sendDM, followUser, likeUser, viewStories, commentPost, replyComment, commentLatestPost, readStoryEvents, acceptFollowRequests, diagnoseActions } from './lib/actions.js'
import { parseFollowers, parseFollowing, parseComments, parseLikers } from './lib/parse.js'
import { runVisit } from './lib/session.js'
import { readSelfEvents } from './lib/selfevents.js'
import { checkProxyBrowser } from './lib/proxy.js'
import { toStorageState } from './lib/state.js'
import { fingerprint } from './lib/fingerprint.js'
import { fingerprintSelfTest } from './lib/selftest.js'
import { captchaConfigured } from './lib/captcha.js'
import { warmupFeed } from './lib/human.js'

const BUILD = '2026-07-20-browser-116-session-self-heal'
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

// ── Хранилище незавершённых image-капч (см. /session/username → needsCaptcha → /session/captcha) ──
// Тот же паттерн, что pending выше, но отдельная карта — независимый TTL/жизненный цикл.
const pendingCaptcha = new Map() // username → { context, createdAt }
const CAPTCHA_TTL = 10 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of pendingCaptcha) {
    if (now - v.createdAt > CAPTCHA_TTL) { closeContextSafe(v.context); pendingCaptcha.delete(k) }
  }
}, 60 * 1000).unref?.()

async function clearPendingCaptcha(username) {
  const p = pendingCaptcha.get(username)
  if (p) { await closeContextSafe(p.context); pendingCaptcha.delete(username) }
}

function errStatus(message) {
  const kind = String(message).split(':')[0]
  return { kind, message: String(message) }
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.all('/health', async (_req, res) => {
  let chromium = 'not-launched'
  try { const b = await getBrowser(); chromium = b.version() } catch (e) { chromium = 'error: ' + e.message }
  // headful=true когда браузер видимый (под Xvfb в проде). display — есть ли виртуальный дисплей.
  const headful = process.env.BROWSER_HEADLESS !== '1'
  res.json({ ok: true, build: BUILD, playwright: true, chromium, headful, display: process.env.DISPLAY || null, concurrency: MAX, active, pending: pending.size, pendingCaptcha: pendingCaptcha.size, captcha: captchaConfigured() })
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
        const r = await attemptLogin(context, { username: uname, password, totpSecret, proxy })
        if (r.ok) { await closeContextSafe(context); return { ok: true, browserState: r.storageState, username: r.username } }
        // challenge/2FA — контекст держим для ввода кода. totpSecret сохраняем ТОЛЬКО для
        // needs2fa (email/SMS-challenge не имеет TOTP-ключа) — attemptLogin уже исчерпал свои
        // ~3 встроенные попытки, но /login/checkpoint может решить его сам ещё раз, без
        // ручного кода от пользователя (см. resumeWithTotp).
        pending.set(uname, { context, createdAt: Date.now(), totpSecret: r.needs2fa ? totpSecret : undefined })
        return r.needs2fa
          ? { needs2fa: true, username: uname, diag: r.diag ?? undefined }
          : { needsCheckpoint: true, channel: r.channel ?? null, username: uname, diag: r.diag ?? undefined }
      } catch (e) {
        await closeContextSafe(context)
        throw e
      }
    })
    res.json(result)
  } catch (e) {
    const { kind, message } = errStatus(e.message)
    // e.diag (скрин + url) приложен при провалах входа (см. login.js fail()) — отдаём в UI.
    res.status(400).json({ error: kind, message, diag: e.diag ?? undefined })
  }
})

// Ввод кода (challenge ИЛИ 2FA) — довод входа на сохранённом контексте.
app.post('/login/checkpoint', async (req, res) => {
  const { username, code, manual } = req.body || {}
  const uname = String(username || '').replace(/^@/, '').trim().toLowerCase()
  const p = pending.get(uname)
  if (!p) return res.status(400).json({ error: 'expired', message: 'Сессия ввода кода истекла — начните вход заново' })
  try {
    // Если это 2FA (не email/SMS-challenge) и известен TOTP-ключ — решаем сами, а не тем
    // кодом, что ввёл человек (авто надёжнее: пересчитывает код на каждое новое 30-секундное
    // окно, не ограничен одной попыткой). manual:true — явный запрос пользователя ОБОЙТИ авто
    // и использовать РОВНО присланный code (фолбэк, когда сама автоматика не смогла отправить
    // форму — напр. кнопка подтверждения не найдена — а не когда ключ неверный).
    const result = await runLimited(() => (
      p.totpSecret && !manual ? resumeWithTotp(p.context, p.totpSecret) : resumeCode(p.context, { code })
    ))
    await clearPending(uname)
    res.json({ ok: true, browserState: result.storageState, username: result.username === 'unknown' ? uname : result.username })
  } catch (e) {
    const { kind, message } = errStatus(e.message)
    if (kind === 'expired') await clearPending(uname) // истёк — чистим; bad_code/code_field_not_found оставляем для повтора
    // diag (скрин + DOM экрана подтверждения) при code_field_not_found — покажем в модалке.
    res.status(400).json({ error: kind, message, diag: e.diag ?? undefined })
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
    res.status(400).json({ error: kind, message, diag: e.diag ?? undefined })
  }
})

// Проверка живости сессии.
app.post('/session/test', async (req, res) => {
  const { storageState, proxy, username, locale, timezoneId } = req.body || {}
  try {
    const alive = await runLimited(async () => {
      const context = await newAccountContext({ username: username || 'test', proxy, storageState, locale, timezoneId })
      try { return await testSession(context) }
      finally { await closeContextSafe(context) }
    })
    res.json({ alive })
  } catch { res.json({ alive: false }) }
})

// Прогрев + keep-alive: периодический человекоподобный заход, чтобы сессия не «остывала»
// (Instagram видит живую активность с того же IP) и аккаунт грелся. Возвращает свежий
// browserState (сессия дозревает — токены обновляются).
app.post('/session/warmup', async (req, res) => {
  const { storageState, proxy, username, locale, timezoneId } = req.body || {}
  if (!storageState) return res.status(400).json({ alive: false, error: 'storageState обязателен' })
  try {
    // Keep-alive в ТОЙ ЖЕ сессии цикла (реюз контекста, если он ещё жив после действий; иначе
    // свежий). autoWarm:false — warmupSession сам делает полноценный человеческий визит.
    const r = await runLimited(() => withCycleContext(req.body, (context) => warmupSession(context), { autoWarm: false }))
    res.json({ alive: r.alive, browserState: r.storageState ?? undefined })
  } catch (e) {
    res.json({ alive: false, error: String(e?.message || 'ошибка').slice(0, 160) })
  }
})

// ВРЕМЕННО (удалить вместе с rereadUsername в login.js и кнопкой в UI, когда починка
// накопившихся username=unknown закончится): перечитать username уже залогиненной сессии.
app.post('/session/username', async (req, res) => {
  const { storageState, proxy, username, locale, timezoneId } = req.body || {}
  if (!storageState) return res.status(400).json({ error: 'bad_request', message: 'storageState обязателен' })
  const uname = String(username || 'owner').replace(/^@/, '').trim().toLowerCase()
  try {
    const result = await runLimited(async () => {
      const context = await newAccountContext({ username: uname, proxy, storageState, locale, timezoneId })
      const r = await rereadUsername(context)
      if (r.needsCaptcha) {
        // Ник не прочитан из-за НЕРЕШЁННОЙ image-капчи — контекст/страницу держим живыми
        // (НЕ закрываем) до ответа человека через POST /session/captcha (см. ниже).
        await clearPendingCaptcha(uname)
        pendingCaptcha.set(uname, { context, createdAt: Date.now() })
        return r
      }
      await closeContextSafe(context)
      return r
    })
    res.json({
      ok: true, username: result.username, browserState: result.storageState, error: result.error,
      sessionAlive: result.sessionAlive, url: result.url, diag: result.diag, dom: result.dom,
      needsCaptcha: result.needsCaptcha, captchaImage: result.captchaImage,
    })
  } catch (e) {
    const { kind, message } = errStatus(e.message)
    res.status(400).json({ error: kind, message })
  }
})

// ВРЕМЕННО (тот же жизненный цикл, что /session/username выше): ЧЕЛОВЕК ввёл текст/цифры
// с картинки капчи (2captcha не настроен/не справился) — довершаем застрявшую /session/username
// на том же живом контексте (pendingCaptcha), заново читаем ник и отдаём тот же формат успеха.
app.post('/session/captcha', async (req, res) => {
  const { username, code } = req.body || {}
  const uname = String(username || '').replace(/^@/, '').trim().toLowerCase()
  const p = pendingCaptcha.get(uname)
  if (!p) return res.status(400).json({ error: 'expired', message: 'Сессия ввода капчи истекла — нажмите «Перечитать ник» ещё раз' })
  try {
    const result = await runLimited(async () => {
      const pages = p.context.pages()
      const page = pages[pages.length - 1] || (await p.context.newPage())
      const ok = await fillImageCaptcha(page, code)
      if (!ok) {
        // Диагностика: реальные name/type/aria ВСЕХ инпутов по всем фреймам — картинка капчи
        // нашлась (мы её показали), а поле ввода — нет; без этого дальнейшая подгонка
        // CAPTCHA_INPUT_SELECTORS (login.js) — гадание вслепую, как уже было с формой входа.
        const dom = await domSummary(page).catch(() => null)
        const domTxt = dom ? ` · фреймов: ${dom.frameCount}, DOM по фреймам: ${JSON.stringify(dom.frames.map((f) => ({ url: f.url.slice(0, 60), forms: f.forms, inputs: f.inputs, editables: f.editables })))}` : ''
        const err = new Error(`captcha_input_not_found: поле ввода капчи не найдено на экране (пробовали и координатный клик под картинкой).${domTxt}`)
        try { err.diag = await captureDiag(page) } catch {}
        throw err
      }
      await page.waitForTimeout(1500)
      const uname2 = await extractUsername(page)
      if (!uname2) {
        const dom = await domSummary(page).catch(() => null)
        const domTxt = dom ? ` · фреймов: ${dom.frameCount}, url: ${page.url()}` : ''
        const err = new Error(`captcha_not_accepted: ник не прочитан после ввода — код неверный либо экран изменился, попробуйте снова.${domTxt}`)
        try { err.diag = await captureDiag(page) } catch {}
        throw err
      }
      return { username: uname2, storageState: await safeStorageState(p.context) }
    })
    await clearPendingCaptcha(uname)
    res.json({ ok: true, username: result.username, browserState: result.storageState })
  } catch (e) {
    const { kind, message } = errStatus(e.message)
    // Контекст НЕ закрываем при ошибке (кроме expired) — остаётся в pendingCaptcha для повтора
    // (сессия ввода капчи может истечь, если код правда неверный и IG перегенерировал картинку).
    res.status(400).json({ error: kind, message, diag: e.diag ?? undefined })
  }
})

// ── §10.2 Fingerprint self-test (антидетект «0 сигналов бота») ──────────────────
// Поднимает РЕАЛЬНЫЙ контекст через прокси и проверяет ключевые сигналы бота.
// Тело: { proxy, username?, locale?, timezoneId? }. Не трогает Instagram (example.com).
app.post('/selftest/fingerprint', async (req, res) => {
  const { proxy, username, locale, timezoneId } = req.body || {}
  if (!proxy) return res.json({ ok: false, error: 'нужен proxy' })
  const uname = username || 'selftest'
  try {
    // Тот же chromeMajor, что newAccountContext реально впишет в браузер (ниже) — иначе fp здесь
    // (эталон для сравнения) разъедется с реальным navigator.userAgent при апдейте Playwright,
    // и self-test ложно закричит «UA не совпадает» (PLAN-MASTER D.3).
    let chromeMajor
    try { const b = await getBrowser(); chromeMajor = String(b.version()).split('.')[0] || undefined } catch {}
    const fp = fingerprint(uname, { locale, timezoneId, chromeMajor })
    // Исходящий IP/страна прокси — чтобы отличить утечку WebRTC от самого прокси + гео-проверка.
    let exit = null
    try {
      const chk = await runLimited(() => checkProxyBrowser(getBrowser, proxy))
      if (chk?.ok) exit = { ip: chk.ip ?? null, country: chk.country ?? null }
    } catch {}

    const result = await runLimited(async () => {
      const context = await newAccountContext({ username: uname, proxy, locale, timezoneId })
      try { return await fingerprintSelfTest(context, fp, exit?.ip ?? null) }
      finally { await closeContextSafe(context) }
    })

    // Гео-консистентность (tz=locale=IP): совпадает ли страна exit-IP с локалью отпечатка.
    const warnings = [...result.warnings]
    if (exit?.country && fp.locale) {
      const localeRegion = (fp.locale.split('-')[1] || '').toLowerCase()
      if (!localeRegion) warnings.push('locale без региона — гео-сверку с IP пропускаем')
    }

    res.json({
      ok: true, build: BUILD, redCount: result.redCount,
      red: result.red, warnings,
      exit, webrtcLeaks: result.webrtcLeaks,
      expected: { platform: fp.platform, uaPlatform: fp.uaPlatform, timezoneId: fp.timezoneId, locale: fp.locale, glRenderer: fp.glRenderer },
      signals: result.signals,
    })
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || 'ошибка selftest').slice(0, 300) })
  }
})

// ── Прокси (заменяет мёртвый Python-воркер /check-proxy и /pick-proxy) ──────────
// Проверка одного прокси: исходящий IP/страна/провайдер + флаги. Всегда 200 (ok:true|false).
app.post('/check-proxy', async (req, res) => {
  const { proxy } = req.body || {}
  if (!proxy) return res.json({ ok: false, error: 'нет прокси' })
  try {
    const result = await runLimited(() => checkProxyBrowser(getBrowser, proxy))
    res.json(result)
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || 'ошибка').slice(0, 200) })
  }
})

// Подбор рабочего из списка: проверяет кандидатов, возвращает первый ЧИСТЫЙ (не датацентр/vpn),
// иначе первый рабочий (flagged). Форма совместима со старым Python /pick-proxy (chosen/flagged/checked).
app.post('/pick-proxy', async (req, res) => {
  const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates.slice(0, 30) : []
  const checked = []
  let chosenClean = null   // рабочий и НЕ датацентр/vpn — приоритет
  let chosenDirty = null   // рабочий, но датацентр/vpn — запасной
  try {
    for (const url of candidates) {
      const r = await runLimited(() => checkProxyBrowser(getBrowser, url))
      checked.push({ url, ok: r.ok, ip: r.ip, country: r.country, timezone: r.timezone, datacenter: r.datacenter, vpn: r.vpn })
      if (r.ok) {
        if (!(r.datacenter || r.vpn)) { chosenClean = url; break }   // чистый — сразу выходим
        if (!chosenDirty) chosenDirty = url                          // грязный — запомним, ищем чистый дальше
      }
    }
  } catch { /* вернём, что успели проверить */ }
  const chosen = chosenClean || chosenDirty
  res.json({ chosen, flagged: !chosenClean && Boolean(chosenDirty), checked })
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

// ── ЕДИНАЯ СЕССИЯ НА ЦИКЛ ────────────────────────────────────────────────────
// Весь цикл одного аккаунта (чтение уведомлений → авто-приём → действия по всем потокам →
// прогрев) выполняется в ОДНОМ переиспользуемом контексте (getOrCreateContext по ключу
// username|proxy). Прогрев ленты — РОВНО ОДИН раз (кто первым коснулся контекста), дальше
// микро-браузинг между действиями. Контекст закрывается по простою ПОСЛЕ последнего действия
// цикла = «человек зашёл, всё сделал, ушёл». Мёртвый/ограниченный контекст выселяется.
const CTX_DEAD_RX = /closed|crash|Target page|context or browser|Session closed|login_required|сессия недейств/i
async function withCycleContext(body, fn, { autoWarm = true } = {}) {
  const { username, storageState, proxy, locale, timezoneId } = body || {}
  const { context, key } = await getOrCreateContext({ username: username || 'owner', proxy, storageState, locale, timezoneId })
  try {
    // Прогрев ленты — один раз на цикл (первое реальное касание контекста). autoWarm=false у тех,
    // кто сам делает полноценный визит (session/warmup), чтобы не греть дважды.
    if (autoWarm && !isCtxWarmed(key)) {
      try { const p = await context.newPage(); await warmupFeed(p); await p.close().catch(() => {}) } catch {}
      markCtxWarmed(key)
    }
    const r = await fn(context)
    if (r && r.brk) await evictContext(key)   // бан/челлендж → закрыть, не переиспользовать
    else touchContext(key)                    // иначе продлить жизнь для следующего действия цикла
    return r
  } catch (e) {
    if (CTX_DEAD_RX.test(String(e?.message ?? ''))) await evictContext(key)   // мёртвая сессия/краш → свежий контекст в след. раз
    throw e
  }
}

// Как actionRoute, но контекст — ПЕРЕИСПОЛЬЗУЕМЫЙ (единая сессия на цикл). Для эндпоинтов,
// участвующих в цикле аккаунта: чтение уведомлений, авто-приём, действия, стори-инбокс.
function cycleRoute(fn) {
  return async (req, res) => {
    if (!req.body?.storageState) return res.status(400).json({ error: 'bad_request', message: 'storageState обязателен' })
    try {
      const result = await runLimited(() => withCycleContext(req.body, (ctx) => fn(ctx, req.body)))
      res.json(result)
    } catch (e) {
      const { kind, message } = errStatus(e.message)
      res.status(400).json({ error: kind, message })
    }
  }
}

// Действия и чтения ЦИКЛА — через переиспользуемый контекст (cycleRoute): весь цикл = одна сессия.
app.post('/dm', cycleRoute((ctx, b) => sendDM(ctx, { toUsername: b.toUsername, text: b.text, image: b.image, dryRun: b.dryRun })))
app.post('/follow', cycleRoute((ctx, b) => followUser(ctx, { targetUsername: b.targetUsername, dryRun: b.dryRun })))
app.post('/like', cycleRoute((ctx, b) => likeUser(ctx, { targetUsername: b.targetUsername, count: b.count, dryRun: b.dryRun })))
app.post('/stories', cycleRoute((ctx, b) => viewStories(ctx, { targetUsername: b.targetUsername, like: b.like, count: b.count, dryRun: b.dryRun })))
app.post('/comment', cycleRoute((ctx, b) => commentPost(ctx, { postUrl: b.postUrl, text: b.text, dryRun: b.dryRun })))
app.post('/reply-comment', cycleRoute((ctx, b) => replyComment(ctx, { postUrl: b.postUrl, text: b.text, dryRun: b.dryRun })))
// Канареечный тест — ОДНОРАЗОВЫЙ (другой, канареечный аккаунт): свой свежий контекст, не цикл.
app.post('/comment-latest', actionRoute((ctx, b) => commentLatestPost(ctx, { targetUsername: b.targetUsername, text: b.text, dryRun: b.dryRun })))
// Стори-события основного (ответы на сторис + упоминания) — чтение директа. Часть цикла → один контекст.
app.post('/story-inbox', cycleRoute((ctx, b) => readStoryEvents(ctx, { amount: b.amount })))
// plan4: СВОИ уведомления (лента активности) — детект follow/like/comment основным аккаунтом.
// Первый шаг цикла: создаёт+греет контекст, дальше все действия идут в ЭТОМ же контексте.
app.post('/self-events', cycleRoute((ctx, b) => readSelfEvents(ctx, { amount: b.amount, raw: b.raw })))
// §13.11 — авто-приём заявок в подписчики (приватный аккаунт): подтвердить ожидающие follow-requests.
app.post('/follow-requests/accept', cycleRoute((ctx, b) => acceptFollowRequests(ctx, { limit: b.limit })))
// Диагностика действий: проба follow/like/story/dm по реальным подписчикам аккаунта (dryRun, без спама).
app.post('/diagnose-actions', cycleRoute((ctx, b) => diagnoseActions(ctx, { ownUsername: b.username, usernames: b.usernames, limit: b.limit })))

// ── Парсинг черновыми (Фаза 3, plan.md §4.4/§5) — DOM, без сохранения browserState (чтение) ──
app.post('/parse/followers', actionRoute((ctx, b) => parseFollowers(ctx, { targetUsername: b.targetUsername, limit: b.limit })))
app.post('/parse/following', actionRoute((ctx, b) => parseFollowing(ctx, { targetUsername: b.targetUsername, limit: b.limit })))
app.post('/parse/comments', actionRoute((ctx, b) => parseComments(ctx, { targetUsername: b.targetUsername, mediaCount: b.mediaCount, perMedia: b.perMedia })))
app.post('/parse/likers', actionRoute((ctx, b) => parseLikers(ctx, { targetUsername: b.targetUsername, mediaCount: b.mediaCount, perMedia: b.perMedia })))

// ── Сессия-визит (Фаза II §1.1): все задачи на цель в ОДНОМ контексте (прогрев → задачи
// в случайном порядке с микро-браузингом → выход). Тело: {storageState, proxy, username,
// locale, timezoneId, tasks:[...]}. Ответ: {done, closed, errors, brk, storageState}. ──
app.post('/session/run', async (req, res) => {
  const { tasks } = req.body || {}
  if (!req.body?.storageState) return res.status(400).json({ error: 'bad_request', message: 'storageState обязателен' })
  if (!Array.isArray(tasks) || !tasks.length) return res.status(400).json({ error: 'bad_request', message: 'tasks пуст' })
  try {
    // Единая сессия на цикл: тот же переиспользуемый контекст, что у чтения уведомлений/действий.
    // Прогрев — один раз в withCycleContext, поэтому runVisit БЕЗ собственного прогрева (warmup:false).
    const result = await runLimited(() => withCycleContext(req.body, (context) => runVisit(context, { tasks, warmup: false })))
    res.json(result)
  } catch (e) {
    const { kind, message } = errStatus(e.message)
    res.status(400).json({ error: kind, message })
  }
})

// §4.9: одиночная асинхронная ошибка/reject НЕ должна ронять весь воркер (иначе падают ВСЕ
// аккаунты). Логируем и продолжаем — конкретная операция уже обёрнута в try/catch выше.
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason))
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err))

app.listen(PORT, () => console.log(`🌐 browser-worker ${BUILD} на :${PORT} (concurrency=${MAX})`))

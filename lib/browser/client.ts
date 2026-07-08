// Обёртка над браузерным воркером (эмуль). Зеркалит формы ответов lib/instagram/client.ts,
// но сессия аккаунта = Playwright storageState (browserState), а не instagrapi-настройки.
// См. plan.md §4.4/§6.
// Канонично — BROWSER_WORKER_URL; принимаем и BROWSER_URL как частый вариант написания,
// чтобы опечатка в имени переменной не оставляла движок молча на legacy.
const BROWSER_WORKER_URL = process.env.BROWSER_WORKER_URL ?? process.env.BROWSER_URL ?? ''
const BROWSER_WORKER_SECRET = process.env.BROWSER_WORKER_SECRET ?? ''
// Браузер медленнее приватного API (вход 30–60с) — таймаут выше, чем у Python-воркера.
const TIMEOUT_MS = Number(process.env.BROWSER_WORKER_TIMEOUT_MS) || 120_000

/** Задеплоен ли браузерный воркер (задан URL). Если нет — движок остаётся legacy. */
export function browserConfigured(): boolean {
  return Boolean(BROWSER_WORKER_URL)
}

async function browserFetch<T = any>(path: string, body: object): Promise<T> {
  if (!BROWSER_WORKER_URL) throw new Error('Браузерный воркер не настроен (нет BROWSER_WORKER_URL)')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${BROWSER_WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': BROWSER_WORKER_SECRET },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`Таймаут ${Math.round(TIMEOUT_MS / 1000)}с: браузерный воркер не ответил (${path})`)
    throw e
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    let msg: string
    try { const d = await res.json(); msg = d.message ?? d.error ?? JSON.stringify(d) }
    catch { msg = await res.text() }
    throw new Error(msg)
  }
  return res.json()
}

// ── Вход ───────────────────────────────────────────────────────────────────
export interface BrowserLoginResult {
  ok?: boolean
  browserState?: object
  username?: string
  needsCheckpoint?: boolean
  needs2fa?: boolean
  channel?: 'email' | 'sms' | null
}

export function browserLogin(username: string, password: string, proxy?: string, totpSecret?: string) {
  return browserFetch<BrowserLoginResult>('/login', { username, password, proxy, totpSecret })
}

export function submitBrowserCheckpoint(username: string, code: string, proxy?: string) {
  return browserFetch<{ ok: boolean; browserState: object; username: string }>('/login/checkpoint', { username, code, proxy })
}

/** Повтор кода. Браузерный воркер сам определяет канал по странице — method принимается для сигнатурной совместимости. */
export function resendBrowserCode(username: string, _method: 'email' | 'sms' = 'email') {
  return browserFetch<{ ok: boolean }>('/login/resend', { username })
}

export function browserLoginByCookies(input: object | string, proxy?: string) {
  const payload = typeof input === 'string' ? { cookies: input } : { storageState: input }
  return browserFetch<{ ok: boolean; browserState: object; username: string }>('/login/cookies', { ...payload, proxy })
}

export async function browserTestSession(storageState: object, proxy?: string, username?: string): Promise<boolean> {
  try {
    const d = await browserFetch<{ alive: boolean }>('/session/test', { storageState, proxy, username })
    return d.alive
  } catch {
    return false
  }
}

export function browserHealth() {
  return browserFetch<{ ok: boolean; build: string; chromium: string; concurrency: number; active: number; pending: number }>('/health', {})
    .catch((e) => ({ ok: false, build: '', chromium: 'error: ' + (e?.message ?? ''), concurrency: 0, active: 0, pending: 0 }))
}

// ── Действия (Фаза 2). Каждое возвращает обновлённый browserState. ──────────────
export interface ActionResult { ok: boolean; browserState?: object; closed?: boolean; error?: string; [k: string]: any }

type Ctx = { storageState: object; proxy?: string; username?: string }

export function browserDM(ctx: Ctx, toUsername: string, text: string) {
  return browserFetch<ActionResult>('/dm', { ...ctx, toUsername, text })
}
export function browserFollow(ctx: Ctx, targetUsername: string) {
  return browserFetch<ActionResult>('/follow', { ...ctx, targetUsername })
}
export function browserLike(ctx: Ctx, targetUsername: string, count = 1) {
  return browserFetch<ActionResult>('/like', { ...ctx, targetUsername, count })
}
export function browserStories(ctx: Ctx, targetUsername: string, like = false) {
  return browserFetch<ActionResult>('/stories', { ...ctx, targetUsername, like })
}
export function browserComment(ctx: Ctx, postUrl: string, text: string) {
  return browserFetch<ActionResult>('/comment', { ...ctx, postUrl, text })
}
export function browserReply(ctx: Ctx, postUrl: string, text: string) {
  return browserFetch<ActionResult>('/reply-comment', { ...ctx, postUrl, text })
}

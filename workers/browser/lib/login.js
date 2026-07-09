// Флоу входа Instagram через реальный браузер. См. plan.md §4.5.
// Разделение ответственности: этот модуль работает с ПЕРЕДАННЫМ контекстом; управление
// жизнью контекста (хранение между /login и /login/checkpoint) — на server.js.
import crypto from 'crypto'
import { SEL, URLS } from './selectors.js'
import { firstVisible, firstVisibleAnyFrame, clickByText, pageHasText, hasSessionCookie, gotoResilient } from './browser.js'
import { humanType, jitter, idleMouse } from './human.js'

const LOGIN_URL = 'https://www.instagram.com/accounts/login/'

// ── TOTP (2FA-ключ base32 → 6-значный код), без внешних зависимостей ──
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

const urlHas = (url, list) => list.some((x) => url.includes(x))

// Снимок того, что реально увидел браузер (для диагностики неудачного входа — plan.md Фаза 4).
// Возвращает { url, title, screenshot(data-URL jpeg) }. Скрин ужат (viewport, q55) — компактно.
export async function captureDiag(page) {
  const out = { url: '', title: '', screenshot: null }
  try { out.url = page.url() } catch {}
  try { out.title = await page.title() } catch {}
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: false })
    out.screenshot = 'data:image/jpeg;base64,' + buf.toString('base64')
  } catch {}
  return out
}

// Бросить ошибку, приложив к ней скрин страницы (server.js вернёт diag в ответ, UI покажет).
async function fail(page, message) {
  const err = new Error(message)
  try { err.diag = await captureDiag(page) } catch {}
  throw err
}

// Диагностика «поля не найдены, хотя на скрине форма видна»: реальные name/type/aria-label
// первых инпутов страницы + число фреймов/форм — без этого скриншот не отличает «Instagram
// переименовал атрибуты» от «форма во фрейме» от «поля правда нет». Считаем ПО ВСЕМ фреймам,
// не только главному — если форма во фрейме, это сразу видно (frame > 0 c инпутами).
async function domSummary(page) {
  try {
    const perFrame = []
    for (const frame of page.frames()) {
      const d = await frame.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')].slice(0, 10).map((el) => ({
          name: el.name || null, type: el.type || null,
          aria: el.getAttribute('aria-label') || null,
          visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        }))
        return { url: location.href, forms: document.querySelectorAll('form').length, inputs, ready: document.readyState }
      }).catch(() => null)
      if (d) perFrame.push(d)
    }
    return { frameCount: page.frames().length, frames: perFrame }
  } catch { return null }
}

async function dismissCookieBanner(page) {
  await clickByText(page, ['Allow all cookies', 'Accept All', 'Accept', 'Разрешить все файлы cookie', 'Принять все'], { timeout: 3500 })
}

// Отправить форму кода (challenge/2FA) НАДЁЖНО: сначала CSS-кнопка submit (firstVisible=CSS),
// затем текстовая кнопка (clickByText), затем Enter по полю. Раньше жали только clickByText
// по списку, куда затесался CSS-селектор — он как текст не матчился, и код не отправлялся.
async function submitCodeForm(page, codeInput) {
  const cssBtn = await firstVisible(page, SEL.codeSubmitCss, 2500)
  if (cssBtn) { await cssBtn.click({ delay: 60 }).catch(() => {}); return }
  if (await clickByText(page, SEL.codeSubmit, { timeout: 3000 })) return
  await codeInput.press('Enter').catch(() => {})
}

// Найти форму входа устойчиво: дождаться, пока React-форма догрузится (networkidle),
// перебрать варианты селекторов; если формы нет — попробовать открыть её кликом «Log in»
// (logged-out домашняя иногда показывает промежуточный экран), затем повторный заход.
// Стабильные поля формы входа Instagram — по ним ждём появления (name= держится годами,
// в отличие от aria-label/placeholder, которые IG крутит по регионам).
const LOGIN_FORM_CORE = 'input[name="username"], input[name="email"], input[name="password"], input[name="pass"], input[type="password"], input[autocomplete="username"]'

// Дождаться, пока React отрисует форму (возвращается СРАЗУ, как поле стало видимым).
// Ключевой фикс: раньше форму искали жёстко 9с обычным поллингом — под headful + медленным
// резидентным прокси она появляется позже, поля «не находились», хотя реально были на экране.
async function waitForm(page, timeout) {
  try { await page.waitForSelector(LOGIN_FORM_CORE, { state: 'visible', timeout }); return true }
  catch { return false }
}

async function findLoginForm(page) {
  // 1) Терпеливо ждём саму форму (до 25с; вернётся мгновенно, если она уже есть).
  await waitForm(page, 25000)
  let userInput = await firstVisible(page, SEL.loginUsername, 4000)
  let passInput = userInput ? await firstVisible(page, SEL.loginPassword, 4000) : null
  if (userInput && passInput) return { userInput, passInput }

  // 2) Возможно, это logged-out ЛЕНДИНГ (не /login). Открываем форму по ССЫЛКЕ «Log in»,
  //    а НЕ через clickByText (тот матчил и кнопку submit пустой формы — вредный фолбэк).
  try {
    const link = page.getByRole('link', { name: /^log ?in$|^войти$/i }).first()
    if (await link.isVisible().catch(() => false)) {
      await link.click({ delay: 60 }).catch(() => {})
      await waitForm(page, 12000)
    }
  } catch {}
  userInput = await firstVisible(page, SEL.loginUsername, 3000)
  passInput = userInput ? await firstVisible(page, SEL.loginPassword, 3000) : null
  if (userInput && passInput) return { userInput, passInput }

  // 3) Последняя попытка — принудительный повторный заход на страницу входа + ожидание формы.
  await gotoResilient(page, LOGIN_URL, { timeout: 20000, retries: 1, backoffMs: [2500] }).catch(() => {})
  await dismissCookieBanner(page)
  await waitForm(page, 20000)
  userInput = await firstVisible(page, SEL.loginUsername, 4000)
  passInput = userInput ? await firstVisible(page, SEL.loginPassword, 4000) : null
  if (userInput && passInput) return { userInput, passInput }

  // 4) Форма визуально на месте (видна на скрине), но обычный page.locator() её не находит —
  //    похоже на consent/anti-bot ПРОСЛОЙКУ во ФРЕЙМЕ. Ищем по ВСЕМ фреймам страницы.
  userInput = await firstVisibleAnyFrame(page, SEL.loginUsername, 5000)
  passInput = userInput ? await firstVisibleAnyFrame(page, SEL.loginPassword, 5000) : null
  return { userInput, passInput }
}

// Закрыть пост-логин диалоги «Save login info?», «Turn on notifications».
export async function dismissInterstitials(page) {
  for (let i = 0; i < 3; i++) {
    const clicked = await clickByText(page, SEL.notNowButtons, { timeout: 2500 })
    if (!clicked) break
    await jitter(600, 1200)
  }
}

// Извлечь username залогиненного аккаунта (для сохранения записи).
export async function extractUsername(page) {
  // 1) страница редактирования профиля стабильно содержит поле username
  try {
    await page.goto('https://www.instagram.com/accounts/edit/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await jitter(800, 1600)
    const inp = page.locator('input[name="username"], input#pepUsername, input[maxlength="30"]').first()
    if (await inp.isVisible().catch(() => false)) {
      const v = (await inp.inputValue().catch(() => '')).trim()
      if (v) return v.replace(/^@/, '').toLowerCase()
    }
  } catch {}
  // 2) фолбэк: ссылка на свой профиль в навигации
  try {
    const u = await page.evaluate(() => {
      const skip = ['/explore/', '/reels/', '/direct/', '/accounts/', '/p/']
      const links = [...document.querySelectorAll('a[role="link"], nav a')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && /^\/[^/]+\/$/.test(h) && !skip.some((s) => h.startsWith(s)))
      return links[0] ? links[0].replace(/\//g, '') : null
    })
    if (u) return u.replace(/^@/, '').toLowerCase()
  } catch {}
  return null
}

/**
 * Одна попытка входа по логину/паролю на переданном контексте.
 * @returns один из:
 *  { ok:true, username, storageState }
 *  { needsCheckpoint:true, channel:'email'|'sms'|null }
 *  { needs2fa:true }
 * @throws Error('bad_password'|'suspended'|'network'|'unknown: ...') на жёстких исходах
 */
export async function attemptLogin(context, { username, password, totpSecret }) {
  const page = await context.newPage()
  // Таймауты урезаны относительно дефолта gotoResilient — вход и так многофазный
  // (набор текста + ожидание исхода до 28с), нужен запас в общем бюджете Next.js-клиента (120с).
  // Больше ретраев/пауза: резидентный прокси может моргнуть на первой навигации
  // (ERR_HTTP_RESPONSE_CODE_FAILURE / таймаут) и восстановиться через пару секунд.
  await gotoResilient(page, LOGIN_URL, { timeout: 30000, retries: 3, backoffMs: [3000, 6000, 12000] })
  await dismissCookieBanner(page)
  await idleMouse(page)

  const { userInput, passInput } = await findLoginForm(page)
  if (!userInput || !passInput) {
    // Страница открылась (гото не упал), но формы входа нет — не прокси, а вёрстка/блок.
    // Если это экран ошибки/лимита/бот-защиты — говорим об этом прямо; иначе общий текст.
    // В обоих случаях прикладываем СКРИН (diag) — видно, что реально показал Instagram.
    if (await pageHasText(page, SEL.errorPage)) {
      await fail(page, 'blocked: Instagram показал экран ошибки/«подождите» (вероятно, бот-защита headless-браузера или лимит IP). Скрин ниже — попробуйте другой прокси/позже.')
    }
    // Скрин один раз уже сбивал с толку («форма видна, а код её не находит») — вместо
    // гадания прикладываем РЕАЛЬНЫЙ дамп DOM (name/type/aria первых инпутов по ВСЕМ фреймам).
    // Отличает: Instagram переименовал атрибуты / форма во фрейме / поля правда исчезли.
    const dom = await domSummary(page)
    console.error('[login] форма не найдена, DOM-дамп:', JSON.stringify(dom))
    const domTxt = dom
      ? ` · фреймов: ${dom.frameCount}, инпуты по фреймам: ${JSON.stringify(dom.frames.map((f) => ({ url: f.url.slice(0, 60), forms: f.forms, inputs: f.inputs })))}`
      : ' · DOM-дамп не снят'
    await fail(page, `unknown: страница входа открылась, но поля логина/пароля не найдены (промежуточный экран или бот-защита). Скрин ниже показывает, что увидел браузер.${domTxt}`)
  }
  await humanType(userInput, username)
  await jitter(400, 900)
  await humanType(passInput, password)
  await jitter(500, 1100)

  const submit = await firstVisible(page, SEL.loginSubmit, 5000)
  if (submit) await submit.click({ delay: 80 })
  else await passInput.press('Enter')

  // Ждём исход до ~28с.
  const deadline = Date.now() + 28000
  while (Date.now() < deadline) {
    await page.waitForTimeout(700)

    if (await hasSessionCookie(context)) {
      await dismissInterstitials(page)
      const uname = (await extractUsername(page)) || username
      const storageState = await context.storageState()
      return { ok: true, username: uname, storageState }
    }

    const url = page.url()

    if (urlHas(url, URLS.suspended) || (await pageHasText(page, ['suspended your account', 'приостановили ваш аккаунт', 'We suspended']))) {
      await fail(page, 'suspended: аккаунт приостановлен Instagram — войти нельзя')
    }

    // 2FA определяем СТРОГО — по URL или специфичным для приложения-аутентификатора фразам.
    // Общие «Enter the code we sent…»/«security code» убраны: они есть и на email/SMS-checkpoint,
    // из-за чего обычный challenge ошибочно уходил в 2FA-ветку (аудит-баг #3). Дефолт для
    // «просто поле кода» — challenge (ветка ниже), это почти всегда почта/SMS.
    if (urlHas(url, URLS.twoFactor) || (await pageHasText(page, ['two-factor', 'two factor', 'двухфактор', 'authentication app', 'приложении для аутентификации', 'authenticator app']))) {
      if (totpSecret) {
        const codeInput = await firstVisible(page, SEL.codeInput, 6000)
        if (codeInput) {
          await humanType(codeInput, totpCode(totpSecret))
          await submitCodeForm(page, codeInput)
          await page.waitForTimeout(2500)
          if (await hasSessionCookie(context)) {
            await dismissInterstitials(page)
            const uname = (await extractUsername(page)) || username
            return { ok: true, username: uname, storageState: await context.storageState() }
          }
        }
      }
      return { needs2fa: true }
    }

    if (urlHas(url, URLS.challenge) || (await firstVisible(page, SEL.codeInput, 500))) {
      let channel = null
      if (await pageHasText(page, ['email', 'e-mail', 'почт'])) channel = 'email'
      else if (await pageHasText(page, ['phone', 'SMS', 'телефон'])) channel = 'sms'
      return { needsCheckpoint: true, channel }
    }

    const err = await firstVisible(page, SEL.loginError, 500)
    if (err) {
      const txt = (await err.textContent().catch(() => '')) || ''
      if (/incorrect|неверн|wasn't right|couldn't find/i.test(txt)) await fail(page, 'bad_password: ' + txt.trim())
      // иная ошибка формы — вернём текст со скрином
      await fail(page, 'unknown: ' + txt.trim())
    }
  }

  // Ничего явного за отведённое время.
  if (await firstVisible(page, SEL.codeInput, 500)) return { needsCheckpoint: true, channel: null }
  await fail(page, 'network: Instagram не ответил понятным исходом за отведённое время')
}

/**
 * Довод входа кодом (challenge ИЛИ 2FA) на СОХРАНЁННОМ контексте (страница мид-флоу).
 * @returns { ok:true, username, storageState }  @throws Error('bad_code'|...) иначе
 */
export async function resumeCode(context, { code }) {
  const pages = context.pages()
  const page = pages[pages.length - 1] || (await context.newPage())

  const codeInput = await firstVisible(page, SEL.codeInput, 8000)
  if (!codeInput) {
    // Возможно, страница уже уехала — проверим, вдруг уже вошли.
    if (await hasSessionCookie(context)) {
      const uname = (await extractUsername(page)) || 'unknown'
      return { ok: true, username: uname, storageState: await context.storageState() }
    }
    throw new Error('expired: поле кода не найдено — сессия ввода истекла, начните вход заново')
  }
  await codeInput.fill('')
  await humanType(codeInput, String(code).replace(/\D/g, ''))
  await submitCodeForm(page, codeInput)

  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    await page.waitForTimeout(700)
    if (await hasSessionCookie(context)) {
      await dismissInterstitials(page)
      const uname = (await extractUsername(page)) || 'unknown'
      return { ok: true, username: uname, storageState: await context.storageState() }
    }
    const err = await firstVisible(page, SEL.loginError, 400)
    if (err) {
      const txt = (await err.textContent().catch(() => '')) || ''
      if (/incorrect|неверн|wrong|didn't match|check the code/i.test(txt)) throw new Error('bad_code: ' + txt.trim())
    }
  }
  throw new Error('bad_code: код не принят (возможно, истёк) — запросите новый и попробуйте снова')
}

// Попытаться повторно отправить код (клик по «Resend»).
export async function resendCode(context) {
  const pages = context.pages()
  const page = pages[pages.length - 1]
  if (!page) return { ok: false }
  const clicked = await clickByText(page, SEL.resendLink, { timeout: 5000 })
  return { ok: clicked }
}

/**
 * Вход по готовой сессии (storageState): проверить, что жива, и вернуть username.
 * @returns { ok:true, username, storageState }  @throws иначе
 */
export async function loginByState(context) {
  const page = await context.newPage()
  await gotoResilient(page, 'https://www.instagram.com/', { timeout: 25000, retries: 1, backoffMs: [2000] })
  await page.waitForTimeout(2000)
  if (!(await hasSessionCookie(context))) {
    throw new Error('login_required: сессия недействительна (нет sessionid) — куки устарели или другой аккаунт')
  }
  await dismissInterstitials(page)
  const uname = (await extractUsername(page)) || 'unknown'
  return { ok: true, username: uname, storageState: await context.storageState() }
}

export async function testSession(context) {
  try {
    const page = await context.newPage()
    await gotoResilient(page, 'https://www.instagram.com/', { timeout: 20000, retries: 1, backoffMs: [1500] })
    await page.waitForTimeout(1500)
    return await hasSessionCookie(context)
  } catch {
    return false
  }
}

// Флоу входа Instagram через реальный браузер. См. plan.md §4.5.
// Разделение ответственности: этот модуль работает с ПЕРЕДАННЫМ контекстом; управление
// жизнью контекста (хранение между /login и /login/checkpoint) — на server.js.
import crypto from 'crypto'
import { SEL, URLS } from './selectors.js'
import { firstVisible, firstVisibleAnyFrame, clickByText, pageHasText, hasSessionCookie, gotoResilient, safeStorageState } from './browser.js'
import { humanType, jitter, idleMouse, warmupFeed, humanClick } from './human.js'
import { trySolveCaptcha, captchaConfigured } from './captcha.js'

// Капча встретилась → решаем через 2captcha, вписываем токен, жмём «Продолжить»/submit,
// какой найдётся на экране. captchaTried гасит повторные попытки на ТОМ ЖЕ экране —
// 2captcha не бесплатна и решение занимает 10–40с, повторять его в каждой итерации poll-а нельзя.
async function handleCaptchaIfPresent(page) {
  if (!captchaConfigured()) return false
  const solved = await trySolveCaptcha(page).catch(() => false)
  if (!solved) return false
  await page.waitForTimeout(1200)
  const btn = await firstVisible(page, ['button[type="submit"]:not([disabled])', ...SEL.codeSubmitCss], 3000).catch(() => null)
  if (btn) await btn.click({ delay: 60 }).catch(() => {})
  else await clickByText(page, [...SEL.codeSubmit, 'Verify', 'Проверить'], { timeout: 3000 }).catch(() => {})
  return true
}

const LOGIN_URL = 'https://www.instagram.com/accounts/login/'

// Instagram на экране «incorrect login» НЕ различает «реально неверный пароль» и «верный пароль,
// но вход временно ограничен после частых попыток с разных IP/устройств» (анти-брутфорс маскируется
// под тот же текст). Поэтому сообщение называет ОБЕ причины и что делать — не врём «пароль неверный».
const BAD_CREDS_MSG =
  'bad_password: Instagram показал «неверный логин/пароль». Это либо реально неверные данные, ' +
  'ЛИБО (если пароль точно верный) временное ограничение входа после частых попыток с разных IP/устройств — ' +
  'IG маскирует анти-брутфорс тем же текстом. Что делать: не входить повторно (каждая попытка усугубляет), ' +
  'подождать несколько часов, использовать ОДИН стабильный резидентный/мобильный прокси, а лучше — войти вручную ' +
  'с доверенного телефона, подтвердить, и подключить аккаунт по КУКАМ (готовая сессия не триггерит новый вход).'

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
// offset — сдвиг 30с-окна (0=текущее, -1=предыдущее, +1=следующее). Нужен для толерантности к
// рассинхрону часов воркера: при фиксированном сдвиге часов код текущего окна всегда «не тот»,
// и ожидание не помогает — помогает попытка соседнего окна.
function totpCode(secret, offset = 0) {
  const key = base32Decode(secret)
  const epoch = Math.floor(Date.now() / 1000 / 30) + offset
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

// Кнопка подтверждения кода — ПО ВСЕМ ФРЕЙМАМ (не только главный). Реальный живой кейс:
// поле кода нашлось через firstVisibleAnyFrame (экран 2FA во фрейме), код был вписан, но
// firstVisible/clickByText смотрят ТОЛЬКО в page (главный фрейм) — кнопку в ТОМ ЖЕ фрейме,
// что и поле, они не видят. Итог — код вписан, форма не отправлена (кнопка не нажата, Enter
// на этом React-инпуте сабмит не триггерит). humanClick(page, locator) кликает КОРРЕКТНО и
// для локаторов из под-фрейма — boundingBox() даёт координаты относительно вьюпорта, клик
// мышью идёт через page.mouse на них же, независимо от того, из какого фрейма локатор.
async function findButtonAnyFrame(page, cssSelectors, textOptions, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const sel of cssSelectors) {
        try {
          const loc = frame.locator(sel).first()
          if (await loc.isVisible().catch(() => false)) return loc
        } catch {}
      }
      for (const t of textOptions) {
        // Точное совпадение — приоритет (меньше риск попасть не туда), но если реальная
        // надпись отличается на пробел/иконку/вложенный span (exact:true молчаливо мажет мимо),
        // добавлен НЕточный (substring, регистронезависимый) фолбэк — тем же текстам.
        try {
          const loc = frame.getByRole('button', { name: t, exact: true }).first()
          if (await loc.isVisible().catch(() => false)) return loc
        } catch {}
        try {
          const loc2 = frame.getByText(t, { exact: true }).first()
          if (await loc2.isVisible().catch(() => false)) return loc2
        } catch {}
        try {
          const loc3 = frame.getByRole('button', { name: t, exact: false }).first()
          if (await loc3.isVisible().catch(() => false)) return loc3
        } catch {}
      }
    }
    await page.waitForTimeout(300)
  }
  return null
}

// Диагностика провала submitCodeForm: список ВСЕХ кандидатов в кнопки (button/[role=button]/
// input[type=submit]) по всем фреймам — текст/aria/disabled/visible. В отличие от скриншота,
// это структурированный текст: сразу видно РЕАЛЬНУЮ надпись кнопки (пробелы/иконки/регистр),
// без чего дальнейшая подгонка селекторов — гадание вслепую.
async function buttonsSummary(page) {
  try {
    const perFrame = []
    for (const frame of page.frames()) {
      const d = await frame.evaluate(() => {
        const els = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')].slice(0, 15)
        return els.map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 40),
          aria: el.getAttribute('aria-label') || null,
          disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
          visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        }))
      }).catch(() => null)
      if (d) perFrame.push({ url: frame.url().slice(0, 60), buttons: d })
    }
    return perFrame
  } catch { return null }
}

// Отправить форму кода (challenge/2FA) НАДЁЖНО: кнопка (CSS ИЛИ текст) — по ВСЕМ фреймам,
// затем Enter по полю как последний фолбэк.
async function submitCodeForm(page, codeInput) {
  const btn = await findButtonAnyFrame(page, SEL.codeSubmitCss, SEL.codeSubmit, 4000)
  if (btn) {
    const clicked = await humanClick(page, btn)
    if (clicked) return
    await btn.click({ delay: 60 }).catch(() => {})
    return
  }
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

  // 3) Последняя попытка — ОДИН заход на deep-URL входа (именно его часть IP отбивает
  //    мгновенным ERR_HTTP_RESPONSE_CODE_FAILURE, поэтому НЕ долбим: retries:0 = одна попытка).
  await gotoResilient(page, LOGIN_URL, { timeout: 20000, retries: 0, backoffMs: [] }).catch(() => {})
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

// Извлечь username залогиненного аккаунта (для сохранения записи). ТОЛЬКО чтение DOM/навигация
// живым браузером — ни одного сетевого запроса от нас (проектное правило: только эмуль, никаких
// прямых API-вызовов, даже изнутри залогиненного контекста — легаси-API уже банил аккаунты).
export async function extractUsername(page) {
  // 1) страница редактирования профиля стабильно содержит поле username
  try {
    await page.goto('https://www.instagram.com/accounts/edit/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await jitter(800, 1600)
    // На этой странице может выскочить СВОЙ интерстишл (не только на главной) — дожимаем перед чтением.
    await dismissInterstitials(page).catch(() => {})
    // Иногда вместо редактирования подсовывается /accounts/suspended/?next=... — см. комментарий
    // у SEL.suspendedContinue: жмём «Continue»/«Это я» и ждём редиректа обратно на next=.
    if (/\/accounts\/suspended/.test(page.url())) {
      const clicked = await clickByText(page, SEL.suspendedContinue, { timeout: 3000 })
      if (clicked) {
        await page.waitForTimeout(1800)
        await dismissInterstitials(page).catch(() => {})
      }
    }
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
  // 3) фолбэк: свой аватар в шапке несёт username прямо в alt-тексте картинки
  // (Instagram рендерит его как «{username}'s profile picture» / локализованные варианты) —
  // это ВИДИМЫЙ текст, уже отрисованный браузером, чтение DOM, не сетевой вызов.
  try {
    const u = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img[alt]')]
      for (const img of imgs) {
        const alt = img.getAttribute('alt') || ''
        const m = alt.match(/^(.+?)['’]s profile picture$/i) || alt.match(/^Фото профиля (.+)$/i) || alt.match(/^(.+?) profile picture$/i)
        if (m && m[1] && !/\s/.test(m[1])) return m[1]
      }
      return null
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
  // Заходим на ДОМАШНЮЮ (наименее блокируемый URL), а к форме входа идём по ссылке «Log in»
  // внутри findLoginForm (client-side переход, как человек). Холодный заход СРАЗУ на deep-URL
  // /accounts/login/ у части резидентных IP Instagram отбивает мгновенным ERR_HTTP_RESPONSE_CODE_FAILURE
  // (это ОТВЕТ-ошибка, а не медленная загрузка — потому частые ретраи не помогают и лишь злят IG).
  // Патиент-ретраи: мало попыток, ДЛИННЫЕ паузы (даём IP «остыть», не долбим). Долгий per-attempt
  // таймаут (45с) — на случай реально медленного прокси (успеет догрузиться, а не «сорвётся раньше»).
  await gotoResilient(page, 'https://www.instagram.com/', { timeout: 45000, retries: 2, backoffMs: [10000, 25000] })
  await dismissCookieBanner(page)
  await idleMouse(page)
  // Изредка Instagram показывает капчу ДО формы входа (бот-стена на подозрительном IP) —
  // пробуем решить её здесь же, прежде чем искать поля username/password.
  await handleCaptchaIfPresent(page).catch(() => false)

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
  if (submit) await humanClick(page, submit)   // §1.3: человеческий подвод курсора к «Войти»
  else await passInput.press('Enter')

  // Ждём исход до ~28с (при device-approval/капче/2FA дедлайн продлевается — см. ниже).
  let deadline = Date.now() + 28000
  let approvalExtended = false
  let captchaTried = false
  let totpExtended = false
  let totpWindow = -1
  let totpAttempts = 0
  while (Date.now() < deadline) {
    await page.waitForTimeout(700)

    if (await hasSessionCookie(context)) {
      await dismissInterstitials(page)
      const uname = (await extractUsername(page)) || username
      const storageState = await safeStorageState(context)
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
      // Раньше пробовали код РОВНО ОДИН раз, ждали 2.5с и при неуспехе сразу отдавали
      // needs2fa (ручной ввод) — если Instagram не успевал подтвердить чуть дольше (или
      // код улетел на границе 30-секундного окна), автоматика сдавалась без причины, хотя
      // ключ верный. Теперь остаёмся в ЭТОЙ ветке до ~3 TOTP-окон подряд (~100с, дедлайн
      // продлевается один раз аналогично device-approval), пересчитывая код на КАЖДОЕ новое
      // окно — и только если ни одна попытка не прошла, отдаём needs2fa как честный фолбэк.
      if (totpSecret && totpAttempts < 3) {
        if (!totpExtended) { totpExtended = true; deadline = Math.max(deadline, Date.now() + 100000) }
        const window = Math.floor(Date.now() / 1000 / 30)
        if (window !== totpWindow) {
          totpWindow = window
          totpAttempts++
          const codeInput = await firstVisible(page, SEL.codeInput, 6000)
          if (codeInput) {
            // Сдвиг окна по попыткам (0/-1/+1) — толерантность к рассинхрону часов воркера.
            const offset = [0, -1, 1][(totpAttempts - 1) % 3]
            await codeInput.fill('').catch(() => {})
            await humanType(codeInput, totpCode(totpSecret, offset))
            await submitCodeForm(page, codeInput)
          }
        }
        await page.waitForTimeout(1000)
        continue
      }
      return { needs2fa: true }
    }

    if (urlHas(url, URLS.challenge) || (await firstVisible(page, SEL.codeInput, 500))) {
      let channel = null
      if (await pageHasText(page, ['email', 'e-mail', 'почт'])) channel = 'email'
      else if (await pageHasText(page, ['phone', 'SMS', 'телефон'])) channel = 'sms'
      return { needsCheckpoint: true, channel }
    }

    // «Подтвердите вход на другом устройстве» (device-approval, БЕЗ кода): пользователь approve'ит
    // в приложении Instagram. НЕ таймаутим и НЕ логаутим — ждём ДОЛЬШЕ (человеку нужно взять телефон
    // и подтвердить); как только подтвердил — появится sessionid и вход завершится успехом (проверка
    // hasSessionCookie в начале цикла). Дедлайн продлеваем ОДИН раз до ~2.5 мин (в бюджете клиента 180с).
    if (urlHas(url, URLS.deviceApproval) || (await pageHasText(page, SEL.deviceApprovalText))) {
      if (!approvalExtended) { approvalExtended = true; deadline = Date.now() + 135000 }  // ~2.25 мин, в бюджете клиента 180с
      await page.waitForTimeout(2500)   // не долбим DOM часто — просто ждём подтверждения
      continue
    }

    // Капча (reCAPTCHA/hCaptcha/Arkose) — Instagram запрашивает её при подозрительном входе
    // (новый IP/прокси/устройство). Пробуем решить ОДИН раз через 2captcha (решение занимает
    // 10–40с — на это время продлеваем дедлайн, иначе цикл выйдет по таймауту, не дождавшись ответа).
    if (!captchaTried) {
      const attempted = await handleCaptchaIfPresent(page)
      if (attempted) {
        captchaTried = true
        deadline = Math.max(deadline, Date.now() + 40000)
        continue
      }
    }

    const err = await firstVisible(page, SEL.loginError, 500)
    if (err) {
      const txt = (await err.textContent().catch(() => '')) || ''
      if (/incorrect|неверн|wasn't right|couldn't find|login information you entered/i.test(txt)) await fail(page, BAD_CREDS_MSG + ' — ' + txt.trim())
      // иная ошибка формы — вернём текст со скрином
      await fail(page, 'unknown: ' + txt.trim())
    }
    // CSS-контейнер ошибки НЕ нашёлся (форма email/pass рисует его в другом месте/классе,
    // см. selectors.js badCredsText) — доп. проверка по ВИДИМОМУ ТЕКСТУ страницы напрямую,
    // не завязана на конкретный селектор контейнера.
    if (await pageHasText(page, SEL.badCredsText)) {
      await fail(page, BAD_CREDS_MSG)
    }
  }

  // Ничего явного за отведённое время — прикладываем DOM-дамп (как при «форма не найдена»),
  // чтобы следующий необъяснённый провал сразу показал реальный текст/структуру, а не
  // расплывчатое «unknown»/«network».
  if (await firstVisible(page, SEL.codeInput, 500)) return { needsCheckpoint: true, channel: null }
  // Ждали подтверждения на устройстве, но его так и не пришло за ~2.5 мин — НЕ «ошибка входа»,
  // а «не успел подтвердить». Понятное сообщение + повтор (не «network», из-за которого раньше
  // казалось, что вход сломался, хотя нужно было просто нажать «Это я» в приложении).
  if (approvalExtended) {
    await fail(page, 'approval_pending: Instagram ждёт подтверждения входа В ПРИЛОЖЕНИИ («Это вы?» → подтвердите), затем нажмите «Войти» ещё раз. Вход не выполнен только потому, что подтверждение не пришло вовремя.')
  }
  const dom = await domSummary(page)
  console.error('[login] исход не распознан за отведённое время, DOM-дамп:', JSON.stringify(dom))
  const domTxt = dom ? ` · фреймов: ${dom.frameCount}, инпуты по фреймам: ${JSON.stringify(dom.frames.map((f) => ({ url: f.url.slice(0, 60), forms: f.forms, inputs: f.inputs })))}` : ''
  await fail(page, `network: Instagram не ответил понятным исходом за отведённое время.${domTxt}`)
}

/**
 * Довод входа кодом (challenge ИЛИ 2FA) на СОХРАНЁННОМ контексте (страница мид-флоу).
 * @returns { ok:true, username, storageState }  @throws Error('bad_code'|...) иначе
 */
export async function resumeCode(context, { code }) {
  const pages = context.pages()
  const page = pages[pages.length - 1] || (await context.newPage())
  await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {})
  // Иногда вместо/перед полем кода стоит капча (доп. проверка на этом же экране подтверждения).
  await handleCaptchaIfPresent(page).catch(() => false)

  // На экране подтверждения («Check your email») поле кода у Instagram имеет НЕОЧЕВИДНЫЕ
  // атрибуты: подтверждено DOM-дампом — это `input name="email"` type=text с placeholder
  // «Code» (тот же прикол, что форма входа использует name="email"/"pass"). Поэтому здесь,
  // на СТРАНИЦЕ ПОДТВЕРЖДЕНИЯ (уже после логина), ищем шире, чем SEL.codeInput: включаем
  // placeholder=code и единственное видимое текстовое поле (name=email/username/type=text).
  // Это безопасно именно в resumeCode — тут нет формы логина, поле только одно (код).
  const CODE_SELECTORS = [
    ...SEL.codeInput,
    'input[placeholder*="code" i]',
    'input[name="email"]',
    'input[name="username"]',
    'input[type="text"]:not([name="pass"]):not([name="password"])',
  ]
  // Ищем поле кода по ВСЕМ фреймам (challenge иногда во фрейме), с запасом по времени.
  let codeInput = await firstVisibleAnyFrame(page, CODE_SELECTORS, 10000)
  if (!codeInput) {
    // Возможно, перед полем есть промежуточный шаг «отправить код / это я / продолжить».
    await clickByText(page, ['Send Security Code', 'Send Code', 'Send code', 'Отправить код', 'This Was Me', 'This was me', 'Это я', 'Continue', 'Продолжить', 'Confirm'], { timeout: 2500 })
    await page.waitForTimeout(1500)
    codeInput = await firstVisibleAnyFrame(page, CODE_SELECTORS, 8000)
  }
  if (!codeInput) {
    // Вдруг уже вошли (кука появилась).
    if (await hasSessionCookie(context)) {
      const uname = (await extractUsername(page)) || 'unknown'
      return { ok: true, username: uname, storageState: await safeStorageState(context) }
    }
    // Не нашли поле — приложим СКРИН + DOM-дамп реального экрана подтверждения, чтобы
    // сразу видеть настоящее имя/тип поля (как сделали для формы входа), а не гадать.
    const dump = await domSummary(page)
    const domTxt = dump ? ` · фреймов: ${dump.frameCount}, инпуты: ${JSON.stringify(dump.frames.map((f) => f.inputs))}` : ''
    const err = new Error(`code_field_not_found: поле ввода кода не найдено на экране подтверждения. Скрин ниже — пришлите его.${domTxt}`)
    try { err.diag = await captureDiag(page) } catch {}
    throw err
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
      return { ok: true, username: uname, storageState: await safeStorageState(context) }
    }
    const err = await firstVisible(page, SEL.loginError, 400)
    if (err) {
      const txt = (await err.textContent().catch(() => '')) || ''
      // diag (скрин + DOM) приложен и здесь — раньше «bad_code» ничего не показывал, и
      // при повторных провалах правильного (проверенного вручную) кода не было видно,
      // на какой РЕАЛЬНО экран попал код (не туда введён / не тот скрин / что-то ещё).
      if (/incorrect|неверн|wrong|didn't match|check the code/i.test(txt)) await fail(page, 'bad_code: ' + txt.trim())
    }
  }
  {
    const btns = await buttonsSummary(page)
    const btnTxt = btns ? ` · кнопки по фреймам: ${JSON.stringify(btns)}` : ''
    await fail(page, `bad_code: код не принят (возможно, истёк, либо форма не отправилась — см. кнопки ниже) — запросите новый и попробуйте снова.${btnTxt}`)
  }
}

/**
 * Автоматическое решение 2FA-экрана ГОТОВЫМ base32-ключом (без участия человека) — на
 * УЖЕ ОТКРЫТОМ мид-флоу контексте (когда attemptLogin исчерпал свои встроенные ~3 попытки
 * и отдал needs2fa). Пересчитывает код на каждое новое 30с-окно, как и внутри attemptLogin.
 * @returns { ok:true, username, storageState }  @throws Error('bad_code'|...) иначе
 */
export async function resumeWithTotp(context, totpSecret) {
  const pages = context.pages()
  const page = pages[pages.length - 1] || (await context.newPage())
  await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {})
  await handleCaptchaIfPresent(page).catch(() => false)

  const CODE_SELECTORS = [
    ...SEL.codeInput,
    'input[placeholder*="code" i]',
    'input[type="text"]:not([name="pass"]):not([name="password"])',
  ]

  let totpWindow = -1
  let attempt = 0
  const OFFSETS = [0, -1, 1] // толерантность к рассинхрону часов: текущее → предыдущее → следующее окно
  const deadline = Date.now() + 100000 // ~3 TOTP-окна с запасом
  while (Date.now() < deadline) {
    if (await hasSessionCookie(context)) {
      await dismissInterstitials(page)
      const uname = (await extractUsername(page)) || 'unknown'
      return { ok: true, username: uname, storageState: await safeStorageState(context) }
    }
    const window = Math.floor(Date.now() / 1000 / 30)
    if (window !== totpWindow) {
      totpWindow = window
      const codeInput = await firstVisibleAnyFrame(page, CODE_SELECTORS, 6000)
      if (codeInput) {
        const offset = OFFSETS[attempt % OFFSETS.length]   // 0 / -1 / +1 — по одному коду на окно (без учащения)
        attempt++
        await codeInput.fill('').catch(() => {})
        await humanType(codeInput, totpCode(totpSecret, offset))
        await submitCodeForm(page, codeInput)
      }
    }
    await page.waitForTimeout(1000)
  }
  // Дамп кнопок ПЕРЕД финальным провалом — если реальная причина не «неверный код», а
  // «кнопка не нажалась» (как уже было — submitCodeForm не находил Continue), это будет
  // видно в тексте ошибки без необходимости смотреть скриншот.
  const btns = await buttonsSummary(page)
  const btnTxt = btns ? ` · кнопки по фреймам: ${JSON.stringify(btns)}` : ''
  await fail(page, `bad_code: автоматический TOTP-код не принят (перепробованы текущее/соседние окна) — ключ 2FA неверный ИЛИ рассинхрон часов ИЛИ форма не отправилась (см. кнопки ниже); сверьте: тот же ключ в Google Authenticator должен давать тот же код.${btnTxt}`)
}

// ВРЕМЕННО (удалить вместе с /session/username в server.js и кнопкой в UI, когда починка
// накопившихся username=unknown закончится): перечитать username УЖЕ залогиненной сессии
// (по сохранённому browserState) БЕЗ повторного входа. ТОЛЬКО DOM — заход на главную + то же
// dismissInterstitials/extractUsername, что при обычном входе.
export async function rereadUsername(context) {
  const page = await context.newPage()
  try {
    await gotoResilient(page, 'https://www.instagram.com/', { timeout: 25000, retries: 1, backoffMs: [2000] })
    await page.waitForTimeout(1500)
    await dismissInterstitials(page).catch(() => {})
    const sessionAlive = await hasSessionCookie(context)
    const uname = await extractUsername(page)
    if (uname) return { username: uname, sessionAlive, storageState: await safeStorageState(context) }
    // Не нашли ни одним способом — диагностика: жива ли сессия ВООБЩЕ (кука) + что реально
    // на экране (скрин+DOM), чтобы отличить «сессия мертва, снова форма входа» от «сессия
    // жива, но страница не та, что ждали» (интерстишл/чекпоинт без нужных элементов).
    const diag = await captureDiag(page).catch(() => null)
    const dom = await domSummary(page).catch(() => null)
    return {
      username: null,
      sessionAlive,
      url: page.url(),
      error: sessionAlive
        ? `сессия АКТИВНА (кука есть), но ник не прочитан ни одним способом — см. url/скрин/dom`
        : `сессия НЕ активна (нет sessionid в куках) — нужен повторный вход`,
      diag, dom,
      storageState: await safeStorageState(context),
    }
  } catch (e) {
    return { username: null, error: String(e?.message || 'ошибка'), storageState: await safeStorageState(context).catch(() => null) }
  }
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
  // Был ли sessionid во ВСТАВЛЕННЫХ куки ДО захода на сайт — отличает «не смогли разобрать
  // формат» (нет куки с самого начала) от «Instagram отклонил валидную на вид сессию»
  // (кука была, но после захода на instagram.com сервер её сбросил — устарела/гео/чужой аккаунт).
  const hadBefore = await hasSessionCookie(context)
  const page = await context.newPage()
  await gotoResilient(page, 'https://www.instagram.com/', { timeout: 25000, retries: 1, backoffMs: [2000] })
  await page.waitForTimeout(2500)

  if (!(await hasSessionCookie(context))) {
    if (!hadBefore) {
      // sessionid не извлёкся из ввода — проблема ФОРМАТА, не гео/срока.
      await fail(page, 'bad_cookies: во вставленных куки/сессии не найден sessionid. Нужна веб-сессия instagram.com (кука sessionid) ИЛИ мобильная строка целиком с «Authorization=Bearer IGT:2:…». Скопируйте строку полностью.')
    }
    // sessionid БЫЛ, но сервер его сбросил при заходе → сессия отклонена.
    await fail(page, 'session_rejected: Instagram отклонил сессию (скрин ниже). Частые причины: (1) ГЕО-НЕСОВПАДЕНИЕ — сессия аккаунта из одной страны, а прокси из другой (напр. аккаунт id_ID/Индонезия, прокси US) → нужен прокси В СТРАНЕ АККАУНТА; (2) сессия устарела/разлогинена; (3) это сессия другого аккаунта.')
  }

  await dismissInterstitials(page)
  const uname = await extractUsername(page)
  if (!uname) {
    // Кука осталась, но профиль не читается И снова видна форма входа — сервер не принял.
    const stillLoggedOut = await firstVisible(page, SEL.loginUsername, 1500)
    if (stillLoggedOut) {
      await fail(page, 'session_rejected: кука есть, но сервер Instagram показал форму входа (сессия истекла/поддельная/чужой аккаунт ИЛИ гео-несовпадение прокси). Нужен прокси в стране аккаунта или свежая сессия.')
    }
  }
  return { ok: true, username: uname || 'unknown', storageState: await safeStorageState(context) }
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

/**
 * Прогрев + keep-alive сессии: заходим на главную как человек (скролл ленты), чтобы
 * (а) Instagram видел периодическую живую активность с ТОГО ЖЕ IP и не «остужал» сессию,
 * (б) аккаунт грелся, (в) вернуть СВЕЖИЙ storageState (сессия дозревает — токены обновляются).
 * @returns { alive:boolean, storageState:object }
 */
export async function warmupSession(context) {
  const page = await context.newPage()
  try {
    await warmupFeed(page) // навигация на главную + человекоподобный скролл (human.js)
    const alive = await hasSessionCookie(context)
    if (alive) await dismissInterstitials(page).catch(() => {})
    return { alive, storageState: await safeStorageState(context) }
  } catch {
    // Сбой прогрева не должен ронять цикл — вернём текущее состояние и «жива по куке».
    return { alive: await hasSessionCookie(context).catch(() => false), storageState: await safeStorageState(context).catch(() => null) }
  }
}

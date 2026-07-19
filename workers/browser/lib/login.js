// Флоу входа Instagram через реальный браузер. См. plan.md §4.5.
// Разделение ответственности: этот модуль работает с ПЕРЕДАННЫМ контекстом; управление
// жизнью контекста (хранение между /login и /login/checkpoint) — на server.js.
import crypto from 'crypto'
import { SEL, URLS } from './selectors.js'
import { firstVisible, firstVisibleAnyFrame, clickByText, pageHasText, hasSessionCookie, gotoResilient, safeStorageState } from './browser.js'
import { humanType, jitter, idleMouse, warmupFeed, humanClick } from './human.js'
import { trySolveCaptcha, captchaConfigured, captchaOnScreen, findImageCaptchaLocator, solveImageCaptcha } from './captcha.js'

// Капча встретилась → решаем через 2captcha, вписываем токен, жмём «Продолжить»/submit,
// какой найдётся на экране. captchaTried гасит повторные попытки на ТОМ ЖЕ экране —
// 2captcha не бесплатна и решение занимает 10–40с, повторять его в каждой итерации poll-а нельзя.
// Возвращает { detected, solved, log }: detected=капча была на экране (даже если решить не вышло —
// тогда НЕ долбим 2captcha повторно в этом входе), solved=токен получен и вписан, log=трасса для UI.
async function handleCaptchaIfPresent(page, proxy) {
  if (!captchaConfigured()) return { detected: false, solved: false, advanced: false, log: '' }
  let r
  try { r = await trySolveCaptcha(page, { proxy }) } catch (e) { r = { solved: false, detected: false, advanced: false, log: 'captcha_exception: ' + (e?.message || e) } }
  if (!r || !r.solved) return { detected: Boolean(r && r.detected), solved: false, advanced: false, log: (r && r.log) || '' }
  // trySolveCaptcha уже вписал токен И проверил, ушла ли капча (advanced). Если ушла — готово.
  if (r.advanced) return { detected: true, solved: true, advanced: true, log: r.log }
  // Токен вписан, но экран сам не сменился. На экранах С КНОПКОЙ (2FA/challenge, где капча —
  // доп. проверка перед полем кода) — жмём «Продолжить»/submit: textarea уже заполнена, кнопка
  // отправит форму. На чистом recaptcha (auth_platform/recaptcha) кнопки нет — injectToken уже
  // дёрнул data-callback/form-submit, даём виджету/сети ещё секунду и перепроверяем.
  await page.waitForTimeout(1200)
  const btn = await firstVisible(page, ['button[type="submit"]:not([disabled])', ...SEL.codeSubmitCss], 2500).catch(() => null)
  if (btn) await btn.click({ delay: 60 }).catch(() => {})
  else await clickByText(page, [...SEL.codeSubmit, 'Verify', 'Проверить', 'Continue', 'Продолжить'], { timeout: 2500 }).catch(() => {})
  await page.waitForTimeout(1500)
  const advanced = !captchaOnScreen(page)
  return { detected: true, solved: true, advanced, log: r.log }
}

// Вписать РАЗГАДАННЫЙ текст image-капчи в ближайшее подходящее текстовое поле (НЕ логин/пароль/
// username) и отправить форму — используется и авто-решением (handleImageCaptcha), и ручным
// вводом человеком (server.js /session/captcha, тот же экран, код пришёл позже отдельным запросом).
// Селекторы поля ввода капчи — от узких (имя/aria/placeholder содержит «captcha») к широким.
// ВАЖНО: `input[type="text"]` матчит ТОЛЬКО если атрибут type ЛИТЕРАЛЬНО есть в разметке —
// у инпута БЕЗ атрибута type (частый случай, браузер дефолтит на text сам) этот CSS-селектор
// молча пропустит поле. Поэтому ниже есть отдельный `input:not([type])` — самый вероятный
// корень первого живого провала (`captcha_input_not_found`, картинка нашлась, поле — нет).
// Реальная надпись поля с живого экрана (2026-07-16): «Enter the code from the image» — ни в
// одном варианте не содержит слово «captcha», поэтому узкие *captcha*-селекторы ниже её мимо
// матчили. Эти — самые точные (проверенная фраза), идут первыми.
const CAPTCHA_INPUT_SELECTORS = [
  'input[aria-label*="code from the image" i]',
  'input[placeholder*="code from the image" i]',
  'textarea[aria-label*="code from the image" i]',
  'textarea[placeholder*="code from the image" i]',
  'input[aria-label*="enter the code" i]',
  'input[placeholder*="enter the code" i]',
  'input[name*="captcha" i]',
  'input[aria-label*="captcha" i]',
  'input[placeholder*="captcha" i]',
  'input[autocomplete="one-time-code"]',
  'input[inputmode="numeric"]',
  'input[type="tel"]',
  'input[maxlength="6"]',
  'input[maxlength="8"]',
  'input[type="text"]:not([name="username"]):not([name="email"]):not([name="pass"]):not([name="password"])',
  'input:not([type]):not([name="username"]):not([name="email"]):not([name="pass"]):not([name="password"])',
  // последний шанс — вообще любое видимое НЕ hidden/checkbox/radio/submit/button поле, не логин/пароль
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([name="username"]):not([name="email"]):not([name="pass"]):not([name="password"])',
]

// Живой провал (2026-07-16): domSummary показал 0 <input> ВООБЩЕ ни в одном из фреймов, хотя
// картинка капчи точно нашлась и человек видел на скрине поле для ввода — вероятно, поле НЕ
// <input> (защита от автозаполнения/скриптовых ботов часто рисует поле как textarea/
// contenteditable-div/role=textbox). Расширяем поиск до этих тегов ПЕРЕД координатным фолбэком.
// Известные фразы поля капчи (2026-07-16: реальный текст «Enter the code from the image»).
// Playwright getByPlaceholder/getByRole матчат по ВЫЧИСЛЕННОМУ accessible name (placeholder,
// aria-label, связанный <label>) — надёжнее сырых CSS-атрибутов, ловят и нестандартную вёрстку
// (div[role=textbox] без aria-label, но с <label> рядом).
const CAPTCHA_FIELD_PHRASES = [/code from the image/i, /enter the code/i, /код с картинки/i, /введите код/i]

async function findCaptchaFieldByAccessibleName(page) {
  for (const frame of page.frames()) {
    for (const rx of CAPTCHA_FIELD_PHRASES) {
      try {
        const byPlaceholder = frame.getByPlaceholder(rx).first()
        if (await byPlaceholder.isVisible({ timeout: 600 }).catch(() => false)) return byPlaceholder
      } catch {}
      try {
        const byRole = frame.getByRole('textbox', { name: rx }).first()
        if (await byRole.isVisible({ timeout: 600 }).catch(() => false)) return byRole
      } catch {}
      try {
        const byLabel = frame.getByLabel(rx).first()
        if (await byLabel.isVisible({ timeout: 600 }).catch(() => false)) return byLabel
      } catch {}
    }
  }
  return null
}

async function findCaptchaFieldAnyFrame(page) {
  const byPhrase = await findCaptchaFieldByAccessibleName(page)
  if (byPhrase) return { kind: 'input', locator: byPhrase }
  const input = await firstVisibleAnyFrame(page, CAPTCHA_INPUT_SELECTORS, 1500)
  if (input) return { kind: 'input', locator: input }
  const editable = await firstVisibleAnyFrame(page, ['textarea', '[contenteditable="true"]', '[role="textbox"]'], 1500)
  if (editable) return { kind: 'editable', locator: editable }
  return null
}

export async function fillImageCaptcha(page, text) {
  const found = await findCaptchaFieldAnyFrame(page)
  if (found) {
    // ВАЖНО (живой провал 2026-07-16): контекст задаёт context.setDefaultTimeout(45000)
    // (browser.js) — ЛЮБОЕ Playwright-действие БЕЗ явного {timeout} ждёт до 45с, если
    // actionability не проходит (элемент найден isVisible=true, но закрыт оверлеем/не
    // стабилен/вне вьюпорта). Раньше здесь был humanType(), чей ПЕРВЫЙ click() шёл без
    // таймаута — повесил эту функцию на 45с ВНУТРИ extractUsername, на критичном пути логина,
    // раздув общий запрос до сотен секунд и уронив клиента в «Ошибка сети». Поэтому — ТОЛЬКО
    // явные короткие таймауты, никакого humanType (который рассчитан на уже-найденные удобные
    // поля формы входа, не на потенциально нестабильные капча-виджеты).
    try {
      await found.locator.click({ timeout: 4000 })
      if (found.kind === 'input') {
        await found.locator.fill('', { timeout: 3000 }).catch(() => {})
        await found.locator.pressSequentially(String(text), { delay: 50, timeout: 6000 })
      } else {
        // textarea/contenteditable/role=textbox — очищаем клавиатурой (fill() на них ненадёжен).
        await page.keyboard.press('Control+A').catch(() => {})
        await page.keyboard.press('Backspace').catch(() => {})
        await page.keyboard.type(String(text), { delay: 50 })
      }
      await submitCodeForm(page, found.kind === 'input' ? found.locator : null)
      return true
    } catch {
      // Поле «нашлось» (isVisible=true), но кликнуть/напечатать не вышло за отведённые
      // секунды (закрыто оверлеем/анимация/не в вьюпорте) — падаем в координатный фолбэк
      // ниже, а НЕ висим до общего дефолта.
    }
  }
  // Последний шанс: НИ ОДНОГО DOM-кандидата (input/textarea/contenteditable/role=textbox) — поле,
  // возможно, управляется JS без явного focusable-тега (canvas/кастомная клавиатура). Кликаем НИЖЕ
  // картинки капчи (типичная раскладка «картинка сверху → поле снизу») и печатаем вслепую клавиатурой —
  // клик задаёт фокус куда бы он ни ушёл, keyboard.type() не зависит от того, какой это элемент.
  const capLoc = await findImageCaptchaLocator(page).catch(() => null)
  if (capLoc) {
    try {
      const box = await capLoc.boundingBox()
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height + 30)
        await page.waitForTimeout(300)
        await page.keyboard.type(String(text), { delay: 60 })
        await submitCodeForm(page, null)
        return true
      }
    } catch {}
  }
  return false
}

// Простая image-капча (искажённый текст/цифры на картинке, БЕЗ JS-виджета — отдельно от
// handleCaptchaIfPresent выше, который решает recaptcha/hcaptcha/funcaptcha). Появляется на
// некоторых identity-checkpoint экранах (напр. после /accounts/suspended/ → «Continue»).
// Пытается решить через 2captcha (Normal Captcha API — скрин уже отрисованного <img>, БЕЗ
// сетевых запросов к Instagram, только чтение DOM живым браузером). Если ключ не настроен
// или решение не подошло — честно отдаёт «нужен ручной ввод» (вызывающий код решает, что
// делать — см. rereadUsername ниже, который отдаёт картинку человеку через UI).
export async function handleImageCaptcha(page) {
  const loc = await findImageCaptchaLocator(page)
  if (!loc) return { status: 'none' }
  if (!captchaConfigured()) return { status: 'needs_manual' }
  let shot
  try { shot = await loc.screenshot({ timeout: 5000 }) } catch { return { status: 'none' } }
  try {
    const text = await solveImageCaptcha(shot.toString('base64'))
    const ok = await fillImageCaptcha(page, text)
    if (ok) { await page.waitForTimeout(1500); return { status: 'solved' } }
  } catch (e) {
    console.error('[captcha] авто-решение image-капчи не удалось:', e?.message || e)
  }
  return { status: 'needs_manual' }
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
export async function domSummary(page) {
  try {
    const perFrame = []
    for (const frame of page.frames()) {
      const d = await frame.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')].slice(0, 10).map((el) => ({
          name: el.name || null, type: el.type || null,
          aria: el.getAttribute('aria-label') || null,
          visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        }))
        // textarea/contenteditable/role=textbox — некоторые поля (напр. капча-виджеты, защита от
        // автозаполнения) НЕ используют <input> вообще; без них домSummary молчаливо показывал
        // «0 инпутов», хотя визуально поле на экране есть (живой провал 2026-07-16).
        const editables = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].slice(0, 10).map((el) => ({
          tag: el.tagName.toLowerCase(),
          name: el.getAttribute('name') || null,
          aria: el.getAttribute('aria-label') || null,
          visible: Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
        }))
        return { url: location.href, forms: document.querySelectorAll('form').length, inputs, editables, ready: document.readyState }
      }).catch(() => null)
      if (d) perFrame.push(d)
    }
    // ВИДИМЫЙ ТЕКСТ страницы (главный фрейм) — по нему сразу видно, ЧТО показал Instagram, когда
    // формы нет: «Suspicious login attempt» / «We restricted…» / «Please wait a few minutes» (мягкий
    // бан) vs cookie-стена vs пусто. Надёжнее скрина (скрин иногда не доходит до UI).
    let text = ''
    try { text = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400)) } catch {}
    // HTML верхнего фрейма (обрезанный) + ПОЛНЫЙ url — по запросу: на какой ссылке был скрин + код страницы.
    let html = ''
    try { html = await page.evaluate(() => document.documentElement.outerHTML.slice(0, 2500)) } catch {}
    let topUrl = ''
    try { topUrl = page.url() } catch {}
    return { frameCount: page.frames().length, frames: perFrame, text, html, topUrl }
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

// Отправить форму кода (challenge/2FA/капча) НАДЁЖНО: кнопка (CSS ИЛИ текст) — по ВСЕМ фреймам,
// затем Enter как последний фолбэк. codeInput может быть null (координатный фолбэк
// fillImageCaptcha — фокус выставлен кликом, а не через локатор) — тогда Enter идёт клавиатурой
// на весь page, а не через конкретный элемент.
async function submitCodeForm(page, codeInput) {
  await page.waitForTimeout(500)   // дать React «включить» кнопку после ввода кода (иначе клик по «серой»)
  const LABELS = [...SEL.codeSubmit, 'Verify', 'Проверить', 'Log in', 'Войти']
  // ГЛАВНЫЙ путь — клик ПРЯМО В DOM по ТОЧНОМУ видимому тексту. Instagram рендерит «Continue»/«Confirm»
  // как <div>/[role=button] (НЕ <button>), и локаторный getByRole по accessible-name её иногда не берёт
  // (живой баг: код вписан, кнопка не нажата → bad_code). el.click() срабатывает на любом clickable-div.
  for (const frame of page.frames()) {
    try {
      const hit = await frame.evaluate((labels) => {
        const want = new Set(labels.map((l) => l.replace(/\s+/g, ' ').trim().toLowerCase()))
        const isSkip = (t) => /trust this device|доверять|запомнить это устройство|try another way|другой способ/.test(t)
        const scan = (sel) => {
          for (const el of document.querySelectorAll(sel)) {
            const t = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().toLowerCase()
            if (!t || t.length > 18 || !want.has(t) || isSkip(t)) continue
            const r = el.getBoundingClientRect()
            if (r.width === 0 || r.height === 0) continue
            try { if (getComputedStyle(el).pointerEvents === 'none') continue } catch {}
            el.click()
            return t
          }
          return null
        }
        // сначала явные кликабельные, затем любой div/span/a с таким текстом
        return scan('div[role="button"], button, [role="button"], input[type="submit"], a[role="button"]') || scan('div, span, a')
      }, LABELS)
      if (hit) { await page.waitForTimeout(400); return }
    } catch {}
  }
  // Фолбэк 1: локаторная кнопка (CSS/role/text) + человеческий/обычный клик.
  const btn = await findButtonAnyFrame(page, SEL.codeSubmitCss, SEL.codeSubmit, 2500)
  if (btn) {
    const clicked = await humanClick(page, btn).catch(() => false)
    if (!clicked) await btn.click({ delay: 60, timeout: 3000 }).catch(() => {})
    return
  }
  // Фолбэк 2: Enter.
  if (codeInput) await codeInput.press('Enter').catch(() => {})
  else await page.keyboard.press('Enter').catch(() => {})
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
// Один снимок трёх способов чтения ника (без ожидания) — вызывается ПОВТОРНО из extractUsername,
// пока SPA не дорисуется (см. комментарий там). Возвращает username либо null.
async function readUsernameSnapshot(page) {
  // 1) страница редактирования профиля стабильно содержит поле username
  try {
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

export async function extractUsername(page) {
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
    // «Continue» иногда ведёт не сразу на next=, а на простую image-капчу (цифры на картинке).
    // НЕ пытаемся решить её ЗДЕСЬ (см. живой провал 2026-07-16): auto-solve через 2captcha
    // может занять до ~90с (ожидание ответа API) — на КРИТИЧНОМ пути обычного логина
    // (attemptLogin/loginByState вызывают extractUsername сразу после успешного входа) это
    // риск раздуть общий запрос за клиентский таймаут («Ошибка сети» вместо честного успеха).
    // extractUsername здесь просто НЕ найдёт username и вернёт null — вызывающий код (attemptLogin)
    // и так фолбэчит на переданный логин; полноценный auto-solve + ручной ввод человеком — только
    // в rereadUsername ниже (там уже есть UI-спиннер, рассчитанный именно на такое ожидание).
    //
    // Живой провал (2026-07-19): `document.readyState==='complete'`, 0 форм/инпутов, видимый текст
    // страницы — ОДНО слово «Messages» (только скелет навигации отрисован, SPA-дерево профиля ещё
    // пустое). Раньше здесь был ОДИН снимок сразу после фиксированной паузы 0.8–1.6с — на холодном
    // воркере/медленном прокси React не успевает дорисовать форму/навигацию за это время, и ник
    // ложно считался нечитаемым. Теперь опрашиваем ВСЕ три способа (readUsernameSnapshot) до ~9с
    // (как поиск формы входа, §P1.1 PLAN-MASTER.md) — не гадаем с одним снимком.
    const deadline = Date.now() + 9000
    while (Date.now() < deadline) {
      const u = await readUsernameSnapshot(page)
      if (u) return u
      await page.waitForTimeout(500)
    }
  } catch {}
  return null
}

// На экране подтверждения входа Instagram («Как отправить код?») ЯВНО выбираем ПОЧТУ и жмём
// «Отправить/Далее». Причина (живой кейс iheidy.zub, 2026-07-17): если у аккаунта привязан
// телефон, IG по умолчанию шлёт код в SMS (на номер, которого у пользователя купленного
// аккаунта НЕТ) → письмо с кодом на почту НЕ приходит, сколько ни жми «resend». Явный выбор
// e-mail направляет код туда, куда у пользователя есть доступ.
// Строго best-effort и БЕЗОПАСНО: (1) вызывается ТОЛЬКО когда поля кода ещё нет (экран выбора
// способа, а не уже открытая форма ввода); (2) НИКОГДА не выбирает телефон; (3) ничего не нашли
// по почте → no-op (поведение как раньше). Возвращает 'email' при удачном выборе, иначе null.
async function chooseEmailChannel(page) {
  const SEND = ['Send Security Code', 'Send Code', 'Send code', 'Отправить код', 'Send', 'Continue', 'Продолжить', 'Next', 'Далее', 'Отправить']
  try {
    // (1) Радио-варианты выбора способа: ищем тот, что про почту (value/связанный label), не телефон.
    const radios = page.locator('input[type="radio"]')
    const n = await radios.count().catch(() => 0)
    for (let i = 0; i < Math.min(n, 8); i++) {
      const r = radios.nth(i)
      const val = ((await r.getAttribute('value').catch(() => '')) || '').toLowerCase()
      const id = await r.getAttribute('id').catch(() => null)
      let lbl = ''
      if (id) lbl = ((await page.locator(`label[for="${id}"]`).first().textContent().catch(() => '')) || '').toLowerCase()
      const hay = `${val} ${lbl}`
      const isEmail = /email|e-mail|почт|@/.test(hay)
      const isPhone = /phone|sms|телефон|моб/.test(hay)
      if (isEmail && !isPhone) {
        await r.check({ timeout: 2500 }).catch(async () => { await r.click({ timeout: 2500 }).catch(() => {}) })
        await page.waitForTimeout(400)
        await clickByText(page, SEND, { timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(1200)
        return 'email'
      }
    }
    // (2) Кликабельная строка/кнопка «...@...» или «...на почту» (экраны без radio-инпутов).
    const opt = page.getByText(/(email|e-mail|почт)[^@]*@|@[a-z0-9.-]*(gmail|mail|outlook|yahoo|proton|icloud)|на почт|to email/i).first()
    if (await opt.isVisible({ timeout: 800 }).catch(() => false)) {
      await opt.click({ timeout: 2500 }).catch(() => {})
      await page.waitForTimeout(400)
      await clickByText(page, SEND, { timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(1200)
      return 'email'
    }
  } catch { /* best-effort — любой сбой не должен мешать обычному challenge-флоу */ }
  return null
}

// Экран «Go to your authentication app» (2FA-приложение), а СВОЕГО 2FA-ключа у нас нет → код из
// приложения бот сгенерить не может, а на почту IG для 2FA-app сам НИЧЕГО не шлёт. Жмём «Try another
// way» и на экране выбора метода выбираем ПОЧТУ → IG отправит код на email (к которому есть доступ).
// Строго best-effort: не нашли кнопку/почту → false, поведение как раньше (needs2fa на ручной код).
async function tryAnotherWayToEmail(page) {
  const ANOTHER = ['Try another way', 'Try Another Way', 'Try another', 'Другой способ', 'Другим способом', 'Попробовать другой способ', 'Выбрать другой способ', 'Use another method']
  try {
    const clicked = await clickByText(page, ANOTHER, { timeout: 3000 })
    if (!clicked) return false
    await page.waitForTimeout(1200)
    // На экране списка методов выбираем e-mail (радио/строка) и жмём отправить (переиспользуем логику).
    const ch = await chooseEmailChannel(page)
    return ch === 'email'
  } catch { return false }
}

/**
 * Одна попытка входа по логину/паролю на переданном контексте.
 * @returns один из:
 *  { ok:true, username, storageState }
 *  { needsCheckpoint:true, channel:'email'|'sms'|null }
 *  { needs2fa:true }
 * @throws Error('bad_password'|'suspended'|'network'|'unknown: ...') на жёстких исходах
 */
export async function attemptLogin(context, { username, password, totpSecret, proxy }) {
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
  await handleCaptchaIfPresent(page, proxy).catch(() => false)

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
      ? ` · URL: ${dom.topUrl || ''} · инпуты по фреймам: ${JSON.stringify(dom.frames.map((f) => ({ url: f.url, forms: f.forms, inputs: f.inputs })))} · HTML(обрезан): ${(dom.html || '').replace(/\s+/g, ' ').slice(0, 1000)}`
      : ' · DOM-дамп не снят'
    // Текст экрана — по нему сразу видно причину (мягкий бан / «подождите» / cookie-стена / пусто).
    const pageTxt = dom?.text ? ` · ТЕКСТ ЭКРАНА: «${dom.text}»` : ''
    await fail(page, `unknown: страница входа открылась, но поля логина/пароля не найдены (промежуточный экран или бот-защита).${pageTxt}${domTxt}`)
  }
  // ЛОГИН: очистить поле (автозаполнение/остаток) → ввести человечно → СВЕРИТЬ и при расхождении
  // перезаполнить начисто. ЖИВОЙ БАГ 2026-07-19: логин «5mgda18JohnsonRichard» доходил до IG как
  // «sonrichard» (отвалилось начало строки при посимвольном вводе) → IG показывал «неверный логин»
  // (ложный bad_password) на ПОЛНОСТЬЮ верном аккаунте. fill() ставит значение целиком (не посимвольно),
  // поэтому исказиться не может — это гарантирует ТОЧНЫЙ логин в поле.
  await userInput.fill('').catch(() => {})
  await humanType(userInput, username)
  try {
    const tu = await userInput.inputValue().catch(() => null)
    if (tu !== null && tu.replace(/^@/, '').trim().toLowerCase() !== String(username).toLowerCase()) {
      console.error(`[login] логин искажён при вводе: в поле "${tu}", ожидалось "${username}" — перезаполняю через fill`)
      await userInput.fill('').catch(() => {})
      await userInput.fill(username).catch(() => {})
    }
  } catch { /* сверка не удалась — не критично */ }
  await jitter(400, 900)
  // ПАРОЛЬ: та же схема — очистить → ввести → сверить/перезаполнить (см. коммент выше). Пароль критичен.
  await passInput.fill('').catch(() => {})
  await humanType(passInput, password)
  try {
    const typed = await passInput.inputValue().catch(() => null)
    if (typed !== null && typed !== password) {
      console.error('[login] пароль искажён при вводе — перезаполняю через fill')
      await passInput.fill('').catch(() => {})
      await passInput.fill(password).catch(() => {})
    }
  } catch { /* сверка не удалась — не критично, ниже обычный разбор исхода */ }
  await jitter(500, 1100)

  const submit = await firstVisible(page, SEL.loginSubmit, 5000)
  if (submit) await humanClick(page, submit)   // §1.3: человеческий подвод курсора к «Войти»
  else await passInput.press('Enter')

  // Ждём исход до ~28с (при device-approval/капче/2FA дедлайн продлевается — см. ниже).
  let deadline = Date.now() + 28000
  let approvalExtended = false
  let captchaAttempts = 0        // §4.5: сколько раз пробовали решить капчу в ЭТОМ входе (лимит ниже)
  let captchaBudgetEnd = 0       // §4.6: общий потолок времени на капчу (ставим при первом обнаружении)
  const CAPTCHA_MAX_ATTEMPTS = 2
  let captchaLog = ''   // трасса капчи (что распознали / что ответила 2captcha) — в ошибку для UI
  let totpExtended = false
  let totpWindow = -1
  let totpAttempts = 0
  let anotherWayTried = false   // 2FA-app без ключа → один раз пробуем «Try another way» → почта
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
      // Своего 2FA-ключа нет → код из приложения не сгенерить, а на почту IG для 2FA-app сам не шлёт.
      // ОДИН раз пробуем «Try another way» → выбрать ПОЧТУ: тогда IG отправит код на email (с доступом).
      if (!totpSecret && !anotherWayTried) {
        anotherWayTried = true
        if (await tryAnotherWayToEmail(page)) {
          let diag = null; try { diag = await captureDiag(page) } catch {}
          return { needsCheckpoint: true, channel: 'email', diag }   // код ушёл на почту — ждём ввод кода
        }
      }
      // Скрин РЕАЛЬНОГО экрана 2FA (раньше needs2fa отдавался без diag → в UI не было скриншота).
      let diag2fa = null; try { diag2fa = await captureDiag(page) } catch {}
      return { needs2fa: true, diag: diag2fa }
    }

    if (urlHas(url, URLS.challenge) || (await firstVisible(page, SEL.codeInput, 500))) {
      // Если поля кода ещё НЕТ — это экран ВЫБОРА способа: явно выбираем ПОЧТУ (иначе IG шлёт код
      // в SMS на телефон аккаунта, которого у пользователя нет → письмо не приходит). Если поле кода
      // уже есть — IG способ уже выбрал сам, не трогаем (просто отдаём на ввод кода).
      const codeFieldNow = await firstVisibleAnyFrame(page, SEL.codeInput, 400)
      let channel = codeFieldNow ? null : await chooseEmailChannel(page)
      if (!channel) {
        if (await pageHasText(page, ['email', 'e-mail', 'почт'])) channel = 'email'
        else if (await pageHasText(page, ['phone', 'SMS', 'телефон'])) channel = 'sms'
      }
      // Скрин РЕАЛЬНОГО экрана подтверждения — чтобы было видно, что именно показал Instagram
      // (выбор способа / «код отправлен на +**89» / только SMS), а не гадать, почему нет письма.
      let diag = null
      try { diag = await captureDiag(page) } catch {}
      return { needsCheckpoint: true, channel, diag }
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
    // Капча при подозрительном входе. handleCaptchaIfPresent решает её через 2captcha (с ВНУТРЕННИМИ
    // ретраями транзиентных UNSOLVABLE/таймаутов — §4.2) и вписывает токен. §4.5/§4.6: до
    // CAPTCHA_MAX_ATTEMPTS попыток, ПОКА капча ещё на экране (captchaOnScreen) и не пройдена. Вторую
    // попытку начинаем ТОЛЬКО при достаточном запасе времени под ПОЛНЫЙ solve — иначе клиент порвёт
    // fetch раньше воркера (ложный «network»). Практически это значит: 2-я попытка идёт лишь если
    // 1-я была быстрой (токен получен, но виджет не провёл дальше) → повторный solve+inject уместен.
    if (captchaOnScreen(page)) {
      if (!captchaBudgetEnd) captchaBudgetEnd = Date.now() + 200000   // общий потолок работы капчи (< клиентских LOGIN_TIMEOUT_MS)
      const roomForAttempt = Date.now() + 155000 <= captchaBudgetEnd  // хватит ли времени ещё на один полный solve (2×75с)
      if (captchaAttempts < CAPTCHA_MAX_ATTEMPTS && roomForAttempt) {
        captchaAttempts++
        const c = await handleCaptchaIfPresent(page, proxy)
        if (c.log) captchaLog = c.log
        if (c.detected) {
          // advanced=капча РЕАЛЬНО ушла (verify §4.4) → ждём следующий экран/успех; иначе токен вписан,
          // но виджет не провёл → даём время и (если остались попытки/бюджет) повторим solve.
          deadline = c.advanced
            ? Math.max(deadline, Date.now() + 25000)
            : Math.min(captchaBudgetEnd, Math.max(deadline, Date.now() + 60000))
          continue
        }
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
  if (await firstVisible(page, SEL.codeInput, 500)) { let d = null; try { d = await captureDiag(page) } catch {} ; return { needsCheckpoint: true, channel: null, diag: d } }
  // Ждали подтверждения на устройстве, но его так и не пришло за ~2.5 мин — НЕ «ошибка входа»,
  // а «не успел подтвердить». Понятное сообщение + повтор (не «network», из-за которого раньше
  // казалось, что вход сломался, хотя нужно было просто нажать «Это я» в приложении).
  if (approvalExtended) {
    await fail(page, 'approval_pending: Instagram ждёт подтверждения входа В ПРИЛОЖЕНИИ («Это вы?» → подтвердите), затем нажмите «Войти» ещё раз. Вход не выполнен только потому, что подтверждение не пришло вовремя.')
  }
  const dom = await domSummary(page)
  console.error('[login] исход не распознан за отведённое время, DOM-дамп:', JSON.stringify(dom))
  // ПОЛНЫЙ дамп (фреймы+HTML) уходит в логи воркера выше. В UI — компактно: трасса капчи (главное для
  // этого кейса — почему 2captcha не прошла) + короткий URL. Визуал экрана несёт приложенный скрин (fail).
  const capTxt = captchaLog
    ? `\n\n🔐 Капча: ${captchaLog}`
    : (captchaConfigured() ? '\n\n🔐 Капча: на этом экране не обнаружена.' : '\n\n🔐 Капча: 2captcha НЕ настроена на воркере (TWOCAPTCHA_API_KEY).')
  const shortUrl = (() => { try { const u = new URL(dom?.topUrl || page.url()); return u.origin + u.pathname } catch { return dom?.topUrl || '' } })()
  await fail(page, `network: Instagram не ответил понятным исходом за отведённое время.${capTxt}\n\n🔗 Экран: ${shortUrl} (фреймов: ${dom?.frameCount ?? '?'})`)
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
    let uname = await extractUsername(page)
    if (uname) return { username: uname, sessionAlive, storageState: await safeStorageState(context) }
    // Ник не нашли — здесь (в отличие от extractUsername на обычном логине) можно позволить
    // себе полноценную попытку auto-solve через 2captcha (до ~90с) — эта функция вызывается
    // ЯВНО пользователем (кнопка 🔤), UI уже показывает спиннер и рассчитан на ожидание.
    const cap = await handleImageCaptcha(page).catch(() => ({ status: 'none' }))
    if (cap.status === 'solved') {
      await page.waitForTimeout(800)
      uname = await extractUsername(page)
      if (uname) return { username: uname, sessionAlive, storageState: await safeStorageState(context) }
    }
    // Всё ещё не нашли — прежде чем уходить в общую диагностику, проверим: вдруг на экране ЕЩЁ
    // стоит НЕРЕШЁННАЯ image-капча (2captcha не настроен на воркере / решение не подошло).
    // Тогда это не «страница не та» — это явный запрос кода у ЧЕЛОВЕКА.
    // Контекст/страницу НЕ закрываем здесь (это делает server.js) — их держат живыми для
    // последующего /session/captcha с введённым текстом.
    const capLoc = await findImageCaptchaLocator(page).catch(() => null)
    if (capLoc) {
      let image = null
      try { image = `data:image/png;base64,${(await capLoc.screenshot({ timeout: 5000 })).toString('base64')}` } catch {}
      if (image) {
        return {
          username: null, sessionAlive, url: page.url(), needsCaptcha: true, captchaImage: image,
          error: 'Instagram просит код с картинки (капча) — введите текст/цифры с изображения',
          storageState: await safeStorageState(context),
        }
      }
    }
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

  // §9: заход по куке РЕДКО, но может упереться в капчу (bot-wall на подозрительном IP) ДО того, как
  // сессия применится. Решаем её той же машинерией, что и обычный вход (§4.1), прежде чем судить о
  // валидности сессии. Best-effort — сбой не должен ломать вход по куке (дальше обычные проверки).
  if (captchaOnScreen(page)) { await handleCaptchaIfPresent(page).catch(() => null); await page.waitForTimeout(1500) }

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

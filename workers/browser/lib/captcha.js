// Решение капчи через 2captcha.com при входе Instagram (reCAPTCHA v2 / hCaptcha / Arkose FunCaptcha).
// Instagram показывает капчу как доп. проверку при подозрительном входе (новый IP/прокси/устройство) —
// отдельно от challenge-кода и 2FA. Ключ — переменная окружения TWOCAPTCHA_API_KEY на сервисе воркера.
const API_KEY = process.env.TWOCAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY || ''
const IN_URL = 'https://2captcha.com/in.php'
const RES_URL = 'https://2captcha.com/res.php'

export function captchaConfigured() { return Boolean(API_KEY) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function submitTask(params) {
  const body = new URLSearchParams({ key: API_KEY, json: '1', ...params })
  const res = await fetch(IN_URL, { method: 'POST', body })
  const data = await res.json().catch(() => null)
  if (!data || data.status !== 1) throw new Error('2captcha_submit_failed: ' + (data?.request || 'нет ответа от 2captcha'))
  return data.request // id задачи
}

async function pollResult(id, { timeoutMs = 150000, intervalMs = 6000 } = {}) {
  const deadline = Date.now() + timeoutMs
  await sleep(intervalMs) // решению нужно время — сразу опрашивать бессмысленно
  while (Date.now() < deadline) {
    const res = await fetch(`${RES_URL}?key=${API_KEY}&action=get&id=${id}&json=1`)
    const data = await res.json().catch(() => null)
    if (data?.status === 1) return data.request
    if (data && data.request !== 'CAPCHA_NOT_READY') throw new Error('2captcha_failed: ' + data.request)
    await sleep(intervalMs)
  }
  throw new Error('2captcha_timeout: решение не пришло за отведённое время')
}

export async function solveRecaptchaV2({ sitekey, url, invisible = false, enterprise = false }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  // enterprise=1 — для reCAPTCHA ENTERPRISE (Instagram /auth_platform/recaptcha/, экран «I'm not a
  // robot» от Meta). БЕЗ этого флага 2captcha решает капчу как обычную v2, и enterprise-виджет такой
  // токен ОТВЕРГАЕТ → вход не проходит (таймаут «network»). Именно это ломало вход с reCAPTCHA-экраном.
  const id = await submitTask({ method: 'userrecaptcha', googlekey: sitekey, pageurl: url, invisible: invisible ? '1' : '0', ...(enterprise ? { enterprise: '1' } : {}) })
  // Таймаут 135с (не дефолтные 150) — чтобы воркер успел вписать токен и вернуть исход в клиентском
  // бюджете входа (см. LOGIN_TIMEOUT_MS в lib/browser/client.ts). enterprise reCAPTCHA на 2captcha
  // обычно решается за 20–60с, 135с — с запасом.
  return pollResult(id, { timeoutMs: 135000 })
}

export async function solveHCaptcha({ sitekey, url }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  const id = await submitTask({ method: 'hcaptcha', sitekey, pageurl: url })
  return pollResult(id)
}

export async function solveFunCaptcha({ publicKey, surl, url }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  const id = await submitTask({ method: 'funcaptcha', publickey: publicKey, surl, pageurl: url })
  return pollResult(id)
}

// Простая image-капча (искажённый текст/цифры НА КАРТИНКЕ, без JS-виджета) — Instagram иногда
// показывает такую на identity-checkpoint экранах (напр. после /accounts/suspended/). Отдельный
// метод 2captcha — «Normal Captcha» (тот же in.php/res.php, method=base64 + сырой base64 картинки).
export async function solveImageCaptcha(base64Image) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  const id = await submitTask({ method: 'base64', body: base64Image })
  return pollResult(id, { timeoutMs: 90000, intervalMs: 5000 })
}

// Найти на странице img-капчу (искажённый текст, не виджет) по подсказкам в src/alt/id/class,
// по ВСЕМ фреймам — возвращает Locator (нужен для .screenshot()), не текст/токен.
export async function findImageCaptchaLocator(page) {
  const candidates = [
    'img[src*="captcha" i]',
    'img[alt*="captcha" i]',
    'img[id*="captcha" i]',
    'img[class*="captcha" i]',
  ]
  for (const frame of page.frames()) {
    for (const sel of candidates) {
      try {
        const loc = frame.locator(sel).first()
        if (await loc.isVisible({ timeout: 800 }).catch(() => false)) return loc
      } catch {}
    }
  }
  return null
}

// Найти капчу по ВСЕМ фреймам страницы (виджет часто рисуется в главном документе,
// а сам вызов/iframe — вложенный; сначала ищем data-атрибуты, потом URL iframe).
export async function detectCaptcha(page) {
  for (const frame of page.frames()) {
    let found = null
    try {
      found = await frame.evaluate(() => {
        const rc = document.querySelector('.g-recaptcha[data-sitekey], [data-sitekey][data-callback], div[data-sitekey]')
        if (rc && rc.getAttribute('data-sitekey')) {
          return { type: 'recaptcha', sitekey: rc.getAttribute('data-sitekey') }
        }
        const hc = document.querySelector('.h-captcha[data-sitekey], [data-hcaptcha-widget-id]')
        if (hc && hc.getAttribute('data-sitekey')) {
          return { type: 'hcaptcha', sitekey: hc.getAttribute('data-sitekey') }
        }
        const fc = document.querySelector('#FunCaptcha, [data-pkey]')
        if (fc && fc.getAttribute('data-pkey')) {
          return { type: 'funcaptcha', publicKey: fc.getAttribute('data-pkey') }
        }
        const rcFrame = document.querySelector('iframe[src*="recaptcha"]')
        if (rcFrame) {
          const m = rcFrame.src.match(/[?&]k=([^&]+)/)
          if (m) return { type: 'recaptcha', sitekey: decodeURIComponent(m[1]), enterprise: /enterprise/i.test(rcFrame.src) }
        }
        const hcFrame = document.querySelector('iframe[src*="hcaptcha"]')
        if (hcFrame) {
          const m = hcFrame.src.match(/[?&]sitekey=([^&]+)/)
          if (m) return { type: 'hcaptcha', sitekey: decodeURIComponent(m[1]) }
        }
        const fcFrame = document.querySelector('iframe[src*="arkoselabs"], iframe[src*="funcaptcha"]')
        if (fcFrame) {
          const m = fcFrame.src.match(/[?&]pk=([^&]+)/)
          const s = fcFrame.src.match(/^https?:\/\/([^/]+)/)
          if (m) return { type: 'funcaptcha', publicKey: decodeURIComponent(m[1]), surl: s ? `https://${s[1]}` : undefined }
        }
        return null
      })
    } catch { found = null }
    if (found) return found
  }
  return null
}

// Вписать токен решения в форму + дёрнуть JS-callback виджета (нужно многим виджетам,
// иначе форма не считает капчу пройденной, даже если textarea заполнена). Возвращает
// { textarea, callback } — заполнили ли поле ответа и нашёлся ли колбэк (для диагностики).
async function injectToken(page, type, token) {
  const result = { textarea: false, callback: false }
  const script = ({ tok, kind }) => {
    const out = { textarea: false, callback: false }
    const fire = (el) => { try { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) } catch {} }
    if (kind === 'hcaptcha') {
      document.querySelectorAll('textarea[name="h-captcha-response"], #h-captcha-response, textarea[name="g-recaptcha-response"]').forEach((el) => { el.value = tok; el.innerHTML = tok; fire(el); out.textarea = true })
      return out
    }
    if (kind === 'funcaptcha') {
      const el = document.querySelector('textarea[name="fc-token"], #fc-token, input[name="fc-token"]')
      if (el) { el.value = tok; fire(el); out.textarea = true }
      try { if (typeof window.onFunCaptchaSuccess === 'function') { window.onFunCaptchaSuccess(tok); out.callback = true } } catch {}
      return out
    }
    // recaptcha v2 / ENTERPRISE: заполняем ВСЕ textarea ответа (id может быть g-recaptcha-response-N) +
    // дёргаем ВСЕ найденные колбэки из ___grecaptcha_cfg (структура varies по версии/enterprise —
    // раньше выходили по первому найденному, у enterprise реальный колбэк бывает вложен глубже).
    document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea[id^="g-recaptcha-response"], #g-recaptcha-response').forEach((el) => { el.value = tok; el.innerHTML = tok; fire(el); out.textarea = true })
    try {
      const cfg = window.___grecaptcha_cfg
      if (cfg && cfg.clients) {
        for (const k in cfg.clients) {
          const client = cfg.clients[k]
          for (const kk in client) {
            const obj = client[kk]
            if (obj && typeof obj.callback === 'function') { try { obj.callback(tok); out.callback = true } catch {} }
            if (obj && typeof obj === 'object') {
              for (const kkk in obj) {
                const inner = obj[kkk]
                if (inner && typeof inner.callback === 'function') { try { inner.callback(tok); out.callback = true } catch {} }
              }
            }
          }
        }
      }
    } catch {}
    return out
  }
  for (const frame of page.frames()) {
    try {
      const r = await frame.evaluate(script, { tok: token, kind: type })
      if (r) { result.textarea = result.textarea || r.textarea; result.callback = result.callback || r.callback }
    } catch {}
  }
  return result
}

// Обнаружить и решить капчу на текущей странице, вписав токен в форму.
// НЕ кликает «Продолжить»/submit — это делает вызывающий код (login.js), т.к. кнопка
// и её текст зависят от конкретного экрана (форма входа / challenge / device-approval).
// Снять sitekey ПРЯМО ИЗ URL фреймов reCAPTCHA/hCaptcha (anchor/bframe несут ?k=/&sitekey=). Надёжнее
// evaluate внутри кросс-ориджин фрейма (fbsbx/google часто блокируют доступ → detectCaptcha возвращал
// null → 2captcha не вызывалась → таймаут «network», баланс не тратился). Это и был живой корень.
function detectFromFrameUrls(page) {
  const frames = page.frames()
  // pageurl для 2captcha ДОЛЖЕН быть на домене, где зарегистрирован sitekey. У Instagram капча
  // рендерится в iframe fbsbx.com (`/captcha/recaptcha/iframe`), и sitekey привязан к fbsbx.com
  // (anchor-URL: co=<base64 https://www.fbsbx.com>). Если слать pageurl=instagram.com — 2captcha
  // отвечает ERROR_CAPTCHA_UNSOLVABLE. Поэтому берём URL фрейма-хоста капчи.
  let host = ''
  for (const f of frames) {
    let u = ''; try { u = f.url() || '' } catch {}
    if (/\/captcha\/recaptcha\/iframe|\/captcha\/hcaptcha/i.test(u)) { try { const p = new URL(u); host = p.origin + p.pathname } catch { host = u } ; break }
  }
  for (const f of frames) {
    let u = ''
    try { u = f.url() || '' } catch { u = '' }
    if (/recaptcha/i.test(u)) {
      const m = u.match(/[?&]k=([^&]+)/)
      if (m) return { type: 'recaptcha', sitekey: decodeURIComponent(m[1]), enterprise: /enterprise/i.test(u), pageurl: host || undefined }
    }
    if (/hcaptcha/i.test(u)) {
      const m = u.match(/[?&]sitekey=([^&]+)/)
      if (m) return { type: 'hcaptcha', sitekey: decodeURIComponent(m[1]), pageurl: host || undefined }
    }
  }
  return null
}

// reCAPTCHA грузится вложенными фреймами (fbsbx → google/recaptcha/(enterprise/)anchor → bframe)
// АСИНХРОННО. Если решать ДО их загрузки — anchor-фрейм ещё about:blank, enterprise-флаг не
// определится, а виджет не готов принять токен. Ждём появления anchor-фрейма (готовность виджета).
async function waitForRecaptchaReady(page, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ready = page.frames().some((f) => { try { return /recaptcha\/(enterprise\/)?anchor/i.test(f.url() || '') } catch { return false } })
    if (ready) return true
    await sleep(500)
  }
  return false
}

// reCAPTCHA ENTERPRISE или обычная v2? Для 2captcha это КРИТИЧНО: enterprise-виджет ОТВЕРГАЕТ
// токен, решённый без enterprise=1 (подтверждённый живой баг — enterprise:false → вход зависал).
// Определяем НЕЗАВИСИМО ОТ ТАЙМИНГА загрузки google-фреймов: главный признак — top-URL Instagram
// `auth_platform/recaptcha` (Meta показывает там ИМЕННО enterprise «I'm not a robot»). Плюс флаг из
// детектора и любой фрейм с /recaptcha/enterprise/ (когда уже догрузились).
function isEnterpriseRecaptcha(page, found) {
  if (found && found.enterprise) return true
  try { if (/auth_platform\/recaptcha/i.test(page.url() || '')) return true } catch {}
  return page.frames().some((f) => { try { return /recaptcha\/enterprise/i.test(f.url() || '') } catch { return false } })
}

// Обнаружить и решить капчу. Возвращает { solved, detected, log } — log несёт человекочитаемую
// трассу (что распознали, enterprise ли, что ответила 2captcha, вписан ли токен), которую login.js
// прикладывает к ошибке входа в UI — чтобы НЕ гадать вслепую, почему капча не прошла.
export async function trySolveCaptcha(page) {
  const t = []
  if (!captchaConfigured()) return { solved: false, detected: false, log: '2captcha не настроена (TWOCAPTCHA_API_KEY не задан на воркере)' }

  // Дать вложенным фреймам reCAPTCHA догрузиться — иначе enterprise-флаг/виджет не готовы (см. helper).
  await waitForRecaptchaReady(page).catch(() => {})

  let found = await detectCaptcha(page).catch(() => null)
  let via = 'dom'
  if (!found) { found = detectFromFrameUrls(page); via = 'frame-url' }   // фолбэк по URL фреймов (кросс-ориджин reCAPTCHA)
  if (!found) { console.error('[captcha] капча не распознана (нет sitekey ни в DOM, ни в URL фреймов)'); return { solved: false, detected: false, log: 'капча не распознана (нет sitekey ни в DOM, ни в URL фреймов)' } }

  // pageurl для 2captcha — домен ХОСТА капчи. Instagram рендерит reCAPTCHA в iframe fbsbx.com, и
  // sitekey привязан к fbsbx (не к instagram). С pageurl=instagram 2captcha даёт ERROR_CAPTCHA_UNSOLVABLE.
  let url = found.pageurl || page.url()
  for (const f of page.frames()) {
    let u = ''; try { u = f.url() || '' } catch {}
    if (/\/captcha\/(recaptcha|hcaptcha)\/iframe/i.test(u)) { try { const p = new URL(u); url = p.origin + p.pathname } catch { url = u } ; break }
  }
  const enterprise = isEnterpriseRecaptcha(page, found)
  const skHead = String(found.sitekey || found.publicKey || '').slice(0, 14)
  t.push(`распознана ${found.type}${enterprise ? ' ENTERPRISE' : ''} (via ${via}), sitekey ${skHead}…, pageurl ${url}`)
  console.error('[captcha]', t[t.length - 1])
  try {
    let token
    if (found.type === 'hcaptcha') token = await solveHCaptcha({ sitekey: found.sitekey, url })
    else if (found.type === 'funcaptcha') token = await solveFunCaptcha({ publicKey: found.publicKey, surl: found.surl, url })
    else token = await solveRecaptchaV2({ sitekey: found.sitekey, url, enterprise })
    const applied = await injectToken(page, found.type, token)
    t.push(`2captcha OK: токен получен (len ${token ? token.length : 0}), вписан [textarea ${applied.textarea ? '✓' : '✗'}, callback ${applied.callback ? '✓' : '✗'}]`)
    console.error('[captcha]', t[t.length - 1])
    return { solved: true, detected: true, log: t.join(' | ') }
  } catch (e) {
    t.push('2captcha ОШИБКА: ' + (e?.message || String(e)))
    console.error('[captcha] решение 2captcha не удалось:', e?.message || e)
    return { solved: false, detected: true, log: t.join(' | ') }
  }
}

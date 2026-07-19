// Решение капчи через 2captcha.com при входе Instagram (reCAPTCHA v2 / hCaptcha / Arkose FunCaptcha).
// Instagram показывает капчу как доп. проверку при подозрительном входе (новый IP/прокси/устройство) —
// отдельно от challenge-кода и 2FA. Ключ — переменная окружения TWOCAPTCHA_API_KEY на сервисе воркера.
import { splitProxy } from './proxy.js'
import { curveMoveTo, humanClick } from './human.js'
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

// Ретраибельные исходы 2captcha — пробуем ЗАНОВО с новой задачей: воркеры не смогли решить
// (ERROR_CAPTCHA_UNSOLVABLE — вероятностно, Enterprise reCAPTCHA решается хуже обычной v2),
// нет свободных слотов, таймаут/сеть. Именно отсутствие ретрая роняло весь вход с ПЕРВОГО
// UNSOLVABLE (живой баг 2026-07-18, ошибка B). ФАТАЛЬНЫЕ коды (ретрай бессмыслен — только жжёт
// время/баланс): неверный ключ сайта/аккаунта, ноль баланса, забаненный IP, битые параметры.
const FATAL_2CAPTCHA = /ERROR_WRONG_GOOGLEKEY|GOOGLEKEY_INVALID|ERROR_KEY_DOES_NOT_EXIST|ERROR_ZERO_BALANCE|ERROR_WRONG_USER_KEY|ERROR_GOOGLEKEY|IP_BANNED|ERROR_PAGEURL|ERROR_BAD_PARAMETERS|not_configured/i

// submit + poll с РЕТРАЯМИ: при ретраибельном исходе — новая задача (до attempts раз). Фатальные
// коды пробрасываются сразу. onAttempt(n, msg) — для трассы (сколько попыток, чем упала предыдущая).
async function solveWithRetry(params, { attempts = 2, timeoutMs = 75000, onAttempt } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const id = await submitTask(params)
      return await pollResult(id, { timeoutMs })
    } catch (e) {
      lastErr = e
      const msg = e?.message || String(e)
      if (onAttempt) { try { onAttempt(i + 1, msg) } catch {} }
      if (FATAL_2CAPTCHA.test(msg)) throw e   // ретрай не поможет — сразу наверх
      // иначе (UNSOLVABLE / NO_SLOT / timeout / сеть) — следующая попытка с новой задачей
    }
  }
  throw lastErr
}

// ── reCAPTCHA ENTERPRISE через НОВЫЙ JSON-API 2captcha (createTask) ───────────────────────────
// Легаси in.php (method=userrecaptcha) НЕ умеет передать ACTION для enterprise-v2 → 2captcha решает
// капчу без action, токен без action, и бэкенд Meta его ОТВЕРГАЕТ (assessment.action ≠ ig_login_recaptcha;
// живой кейс 2026-07-19: клиентская отправка идентична штатной, экран не сменяется = токен не принят).
// createTask + enterprisePayload.action заставляет 2captcha отрендерить виджет С нужным action → токен
// несёт action, как ждёт Meta. (Плюс s, если попадётся.)
const CT_URL = 'https://api.2captcha.com/createTask'
const RT_URL = 'https://api.2captcha.com/getTaskResult'

async function solveEnterpriseOnce(task, { timeoutMs = 90000, intervalMs = 6000 } = {}) {
  const cr = await fetch(CT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientKey: API_KEY, task }) })
  const cd = await cr.json().catch(() => null)
  if (!cd || cd.errorId) throw new Error('2captcha_create_failed: ' + (cd?.errorCode || cd?.errorDescription || 'нет ответа createTask'))
  const taskId = cd.taskId
  const deadline = Date.now() + timeoutMs
  await sleep(intervalMs)
  while (Date.now() < deadline) {
    const rr = await fetch(RT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientKey: API_KEY, taskId }) })
    const rd = await rr.json().catch(() => null)
    if (rd && rd.status === 'ready') return (rd.solution && (rd.solution.gRecaptchaResponse || rd.solution.token)) || ''
    if (rd && rd.errorId) throw new Error('2captcha_failed: ' + (rd.errorCode || rd.errorDescription))
    await sleep(intervalMs)
  }
  throw new Error('2captcha_timeout: enterprise-решение не пришло за отведённое время')
}

// Координатное распознавание картинок (2captcha CoordinatesTask, api-docs/coordinates) — для
// грид-челленджа reCAPTCHA («выберите все картинки с …»). Отдаём base64 СКРИНШОТА области челленджа
// + инструкцию текстом (`comment`) → 2captcha возвращает МАССИВ точек {x,y}, координаты ВНУТРИ
// присланного изображения (по одной точке на подходящую плитку) — их и кликаем мышью в НАШЕЙ
// странице (см. solveGridInBrowser). НЕ токен — сырые пиксельные координаты, контракт другой, чем
// у RecaptchaV2*Task (там gRecaptchaResponse), поэтому свой createTask/getTaskResult цикл (не трогаем
// solveEnterpriseOnce — он рабочий и на другой контракт).
async function solveCoordinates(base64Image, instruction, { timeoutMs = 90000, intervalMs = 6000 } = {}) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  const task = { type: 'CoordinatesTask', body: base64Image, comment: (instruction || 'select matching images').slice(0, 255) }
  const cr = await fetch(CT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientKey: API_KEY, task }) })
  const cd = await cr.json().catch(() => null)
  if (!cd || cd.errorId) throw new Error('2captcha_create_failed: ' + (cd?.errorCode || cd?.errorDescription || 'нет ответа createTask'))
  const taskId = cd.taskId
  const deadline = Date.now() + timeoutMs
  await sleep(intervalMs)
  while (Date.now() < deadline) {
    const rr = await fetch(RT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientKey: API_KEY, taskId }) })
    const rd = await rr.json().catch(() => null)
    if (rd && rd.status === 'ready') return (rd.solution && rd.solution.coordinates) || []
    if (rd && rd.errorId) throw new Error('2captcha_failed: ' + (rd.errorCode || rd.errorDescription))
    await sleep(intervalMs)
  }
  throw new Error('2captcha_timeout: координатное решение не пришло за отведённое время')
}

// reCAPTCHA v2 ENTERPRISE (чекбокс «I'm not a robot» на auth_platform/recaptcha).
// КЛЮЧЕВОЕ (по докам 2captcha + живой кейс 2026-07-19, verify ✗ даже с правильным action): если задан
// proxy — используем PROXY-задачу `RecaptchaV2EnterpriseTask`, т.е. 2captcha решает капчу ЧЕРЕЗ НАШ IP
// и с НАШИМ userAgent → токен привязан к тому же IP/браузеру, что и наш вход, и Meta-assessment скорит
// его как консистентный (proxyless-токен решается с датацентр-IP 2captcha → Meta бракует по скору/IP).
// enterprisePayload несёт action/s (без них assessment.action не совпадает). meta.
export async function solveRecaptchaEnterprise({ sitekey, url, action, dataS, proxy, userAgent, onAttempt }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  const ep = {}
  if (action) ep.action = action
  if (dataS) ep.s = dataS
  const p = proxy ? splitProxy(proxy) : null
  let task
  if (p && p.hostPort && p.hostPort.includes(':')) {
    const i = p.hostPort.lastIndexOf(':')
    task = {
      type: 'RecaptchaV2EnterpriseTask',       // ПРОКСИ-версия: решают через наш IP
      websiteURL: url, websiteKey: sitekey,
      proxyType: (p.scheme && /^socks/i.test(p.scheme)) ? p.scheme.toLowerCase() : 'http',
      proxyAddress: p.hostPort.slice(0, i),
      proxyPort: Number(p.hostPort.slice(i + 1)),
      ...(p.username ? { proxyLogin: p.username } : {}),
      ...(p.password ? { proxyPassword: p.password } : {}),
    }
  } else {
    task = { type: 'RecaptchaV2EnterpriseTaskProxyless', websiteURL: url, websiteKey: sitekey }
  }
  if (userAgent) task.userAgent = userAgent      // тот же UA, что у нашего входа — консистентный отпечаток токена
  if (Object.keys(ep).length) task.enterprisePayload = ep
  let lastErr
  for (let i = 0; i < 2; i++) {
    try { return await solveEnterpriseOnce(task) }
    catch (e) { lastErr = e; const m = e?.message || String(e); if (onAttempt) { try { onAttempt(i + 1, m) } catch {} } if (FATAL_2CAPTCHA.test(m)) throw e }
  }
  throw lastErr
}

export async function solveRecaptchaV2({ sitekey, url, invisible = false, enterprise = false, dataS, action, onAttempt }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  // enterprise=1 — для reCAPTCHA ENTERPRISE (Instagram /auth_platform/recaptcha/, экран «I'm not a
  // robot» от Meta). БЕЗ этого флага 2captcha решает капчу как обычную v2, и enterprise-виджет такой
  // токен ОТВЕРГАЕТ → вход не проходит (таймаут «network»). data-s — доп. токен, который иногда
  // несёт enterprise-виджет Meta; передаём, если удалось снять (см. detectFromFrameUrls/detectCaptcha).
  const params = { method: 'userrecaptcha', googlekey: sitekey, pageurl: url, invisible: invisible ? '1' : '0', ...(enterprise ? { enterprise: '1' } : {}), ...(dataS ? { 'data-s': dataS } : {}), ...(action ? { action } : {}) }
  // attempts=2 × ≤75с — с запасом под клиентский бюджет входа (LOGIN_TIMEOUT_MS). UNSOLVABLE
  // 2captcha обычно возвращает быстро (~15–40с), так что 2 попытки редко упираются в потолок.
  return solveWithRetry(params, { attempts: 2, timeoutMs: 75000, onAttempt })
}

export async function solveHCaptcha({ sitekey, url, onAttempt }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  return solveWithRetry({ method: 'hcaptcha', sitekey, pageurl: url }, { attempts: 2, timeoutMs: 110000, onAttempt })
}

export async function solveFunCaptcha({ publicKey, surl, url, onAttempt }) {
  if (!captchaConfigured()) throw new Error('2captcha_not_configured: TWOCAPTCHA_API_KEY не задан')
  return solveWithRetry({ method: 'funcaptcha', publickey: publicKey, surl, pageurl: url }, { attempts: 2, timeoutMs: 110000, onAttempt })
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
          // §4.3 B8: определить enterprise ПРЯМО В DOM-ветке (не только по URL фреймов, которые к
          // моменту детекта ещё about:blank) — по grecaptcha.enterprise / скрипту enterprise.js /
          // атрибуту data-enterprise. isEnterpriseRecaptcha остаётся страховкой по top-URL.
          const ent = !!(window.grecaptcha && window.grecaptcha.enterprise)
            || !!document.querySelector('script[src*="recaptcha/enterprise.js"], script[src*="/enterprise.js"]')
            || /^(1|true)$/i.test(rc.getAttribute('data-enterprise') || '')
          // data-s / data-action — КРИТИЧНО для reCAPTCHA на сервисах Meta/Google: без секретного
          // `data-s` 2captcha решает капчу «в отрыве», и Meta ОТВЕРГАЕТ токен (живой кейс 2026-07-19:
          // клиентская отправка идентична штатной, но экран не сменялся → токен не принят бэкендом).
          const dataS = rc.getAttribute('data-s') || undefined
          const action = rc.getAttribute('data-action') || undefined
          // Все data-* атрибуты виджета — в диагностику (увидеть реальные имена параметров, если data-s звучит иначе).
          const dataAttrs = {}
          for (const a of rc.attributes) { if (/^data-/.test(a.name)) dataAttrs[a.name] = (a.value || '').slice(0, 60) }
          return { type: 'recaptcha', sitekey: rc.getAttribute('data-sitekey'), enterprise: ent, dataS, action, dataAttrs }
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

// Вписать токен решения В ФОРМУ + ОТПРАВИТЬ его ВСЕМИ доступными способами. На экране Meta
// auth_platform/recaptcha КНОПКИ НЕТ — отправка целиком callback-driven: успех reCAPTCHA должен
// дёрнуть data-callback-функцию внутри iframe fbsbx, которая постит токен обратно в Meta. Раньше мы
// дёргали только ___grecaptcha_cfg (2 уровня) → у ENTERPRISE колбэк не находился (callback ✗) →
// токен вписывался, но НЕ отправлялся → вход зависал (живой баг 2026-07-18, ошибка A). Теперь делаем
// ВСЁ: textarea + прямой вызов data-callback-атрибута + РЕКУРСИВНЫЙ обход cfg + submit формы.
// Возвращает { textarea, dataCallback, cfgCallback, formSubmit } — для трассы в UI.
async function injectToken(page, type, token) {
  const result = { textarea: false, getResponse: false, dataCallback: false, cfgCallback: false, formSubmit: false, postMessage: false }
  const script = ({ tok, kind }) => {
    const out = { textarea: false, getResponse: false, dataCallback: false, cfgCallback: false, formSubmit: false, postMessage: false }
    const fire = (el) => { try { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) } catch {} }
    if (kind === 'funcaptcha') {
      const el = document.querySelector('textarea[name="fc-token"], #fc-token, input[name="fc-token"]')
      if (el) { el.value = tok; fire(el); out.textarea = true }
      try { if (typeof window.onFunCaptchaSuccess === 'function') { window.onFunCaptchaSuccess(tok); out.cfgCallback = true } } catch {}
      return out
    }
    // recaptcha v2 / ENTERPRISE / hcaptcha:
    // (1) заполнить ВСЕ textarea ответа (id может быть g-recaptcha-response-N)
    document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea[id^="g-recaptcha-response"], #g-recaptcha-response, textarea[name="h-captcha-response"], #h-captcha-response').forEach((el) => { el.value = tok; el.innerHTML = tok; fire(el); out.textarea = true })
    // (2) ПОДМЕНИТЬ grecaptcha(.enterprise).getResponse → возвращать наш токен. КЛЮЧЕВОЕ: заполнение
    //     textarea НЕ меняет внутреннее состояние reCAPTCHA, а success-хендлер Meta/fbsbx читает решение
    //     через grecaptcha.enterprise.getResponse() → получал ПУСТО (живой кейс 2026-07-18: data-callback
    //     ✓/cfg-callback ✓, но verify ✗ — колбэк дёрнулся, а токена в getResponse нет → экран не сменился).
    try {
      const patchGR = (g) => {
        if (!g || typeof g.getResponse !== 'function') return
        // defineProperty надёжнее прямого присваивания (если свойство non-writable — присваивание
        // молча не сработает, а out.getResponse был бы ложно-true). Затем ПРОВЕРЯЕМ, что реально вернулось.
        try { Object.defineProperty(g, 'getResponse', { configurable: true, writable: true, value: () => tok }) }
        catch { try { g.getResponse = () => tok } catch {} }
        try { if (g.getResponse('') === tok || g.getResponse() === tok) out.getResponse = true } catch {}
      }
      if (window.grecaptcha) { patchGR(window.grecaptcha); if (window.grecaptcha.enterprise) patchGR(window.grecaptcha.enterprise) }
    } catch {}
    // (3) ДЁРНУТЬ data-callback НАПРЯМУЮ — штатный success-хендлер fbsbx:
    //     атрибут data-callback у виджета — это ИМЯ глобальной функции, которую reCAPTCHA зовёт с токеном.
    try {
      document.querySelectorAll('.g-recaptcha[data-callback], [data-sitekey][data-callback], .h-captcha[data-callback], [data-hcaptcha-widget-id][data-callback]').forEach((w) => {
        const name = w.getAttribute('data-callback')
        if (name && typeof window[name] === 'function') { try { window[name](tok); out.dataCallback = true } catch {} }
      })
    } catch {}
    // (4) РЕКУРСИВНЫЙ обход ___grecaptcha_cfg — вызвать ВСЕ функции-колбэки (у ENTERPRISE вложены
    //     глубже, чем 2 уровня, которыми мы ограничивались раньше — потому колбэк и не находился).
    try {
      const cfg = window.___grecaptcha_cfg
      if (cfg && cfg.clients) {
        const seen = new Set()
        const visit = (obj, depth) => {
          if (!obj || depth > 6) return
          if (typeof obj === 'object') { if (seen.has(obj)) return; seen.add(obj) }
          for (const k in obj) {
            let v
            try { v = obj[k] } catch { continue }
            if (typeof v === 'function' && /callback/i.test(k)) { try { v(tok); out.cfgCallback = true } catch {} }
            else if (v && typeof v === 'object') visit(v, depth + 1)
          }
        }
        for (const k in cfg.clients) visit(cfg.clients[k], 0)
      }
    } catch {}
    // (5) SUBMIT формы: сначала форма с textarea ответа, ИНАЧЕ любая форма во фрейме (Meta-форма fbsbx,
    //     textarea reCAPTCHA часто лежит в google-подфрейме, а не в форме fbsbx → closest('form') пуст).
    try {
      const area = document.querySelector('textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"]')
      const form = (area && area.closest('form')) || document.querySelector('form')
      if (form) { try { (form.requestSubmit ? form.requestSubmit() : form.submit()); out.formSubmit = true } catch {} }
    } catch {}
    // (6) postMessage НАВЕРХ — fbsbx-iframe отдаёт результат родителю Instagram через message-канал.
    //     Формат нам неизвестен, поэтому шлём и сырой токен, и пару типовых структур (родитель игнорит чужое).
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(tok, '*')
        try { window.parent.postMessage(JSON.stringify({ type: 'captcha', event: 'success', token: tok, response: tok }), '*') } catch {}
        out.postMessage = true
      }
    } catch {}
    return out
  }
  for (const frame of page.frames()) {
    try {
      const r = await frame.evaluate(script, { tok: token, kind: type })
      if (r) {
        result.textarea = result.textarea || r.textarea
        result.getResponse = result.getResponse || r.getResponse
        result.dataCallback = result.dataCallback || r.dataCallback
        result.cfgCallback = result.cfgCallback || r.cfgCallback
        result.formSubmit = result.formSubmit || r.formSubmit
        result.postMessage = result.postMessage || r.postMessage
      }
    } catch {}
  }
  return result
}

// Компактный дамп фреймов капчи ПРИ НЕУДАЧЕ (verify ✗) — чтобы увидеть, ЧЕГО именно ждёт fbsbx для
// отправки решения: сколько форм и куда (action), какие кнопки, имя data-callback, есть ли
// grecaptcha(.enterprise), какие глобальные функции похожи на success/submit-хендлеры. По этому
// дампу следующая итерация фикса делается ТОЧНО, а не вслепую (frame.evaluate внутри своего origin — ADR-002).
async function captchaFramesDump(page) {
  const parts = []
  for (const f of page.frames()) {
    let u = ''; try { u = f.url() || '' } catch {}
    if (!/\/captcha\/(recaptcha|hcaptcha)\/iframe|auth_platform\/(recaptcha|captcha)|recaptcha\/(enterprise\/)?(anchor|bframe)/i.test(u)) continue
    try {
      const info = await f.evaluate(() => {
        const forms = [...document.querySelectorAll('form')].map((fm) => (fm.getAttribute('action') || fm.method || 'form').slice(0, 50))
        const btns = [...document.querySelectorAll('button, [role=button], input[type=submit], a[role=button]')].map((b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().slice(0, 22)).filter(Boolean).slice(0, 6)
        const cb = document.querySelector('[data-callback]') && document.querySelector('[data-callback]').getAttribute('data-callback')
        const globals = Object.getOwnPropertyNames(window).filter((n) => /callback|verify|submit|onCaptcha|onSuccess|onToken/i.test(n)).slice(0, 10)
        // ИСХОДНИК success/callback-хендлеров (не нативных) — по нему видно ТОЧНЫЙ механизм отправки
        // решения (postMessage какого формата / fetch / навигация), чтобы воспроизвести его без гадания.
        const handlers = {}
        for (const n of globals) { try { const v = window[n]; if (typeof v === 'function') { const s = String(v); if (!/\{\s*\[native code\]\s*\}/.test(s)) handlers[n] = s.replace(/\s+/g, ' ').slice(0, 320) } } catch {} }
        return { forms, btns, cb: cb || null, gr: !!window.grecaptcha, ent: !!(window.grecaptcha && window.grecaptcha.enterprise), globals, handlers }
      })
      let tag = u.slice(0, 45); try { tag = new URL(u).pathname } catch {}
      parts.push(`{${tag}: forms=${JSON.stringify(info.forms)} btns=${JSON.stringify(info.btns)} data-cb=${info.cb} gr=${info.gr}/ent=${info.ent} fns=${JSON.stringify(info.globals)} src=${JSON.stringify(info.handlers)}}`)
    } catch { parts.push(`{${u.slice(0, 40)}: evaluate недоступен (кросс-ориджин)}`) }
  }
  return parts.join(' ') || 'нет фреймов капчи'
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
      const sM = u.match(/[?&]s=([^&]+)/)   // data-s из URL anchor-фрейма (фолбэк, если в DOM не нашли)
      if (m) return { type: 'recaptcha', sitekey: decodeURIComponent(m[1]), enterprise: /enterprise/i.test(u), pageurl: host || undefined, dataS: sM ? decodeURIComponent(sM[1]) : undefined }
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

// Капча ещё на экране? Верхний URL = auth_platform/recaptcha (экран Meta «I'm not a robot») ИЛИ
// на странице есть iframe капчи fbsbx. Дёшево (только чтение URL) — можно звать в цикле входа.
export function captchaOnScreen(page) {
  try { if (/auth_platform\/(recaptcha|captcha)/i.test(page.url() || '')) return true } catch {}
  return page.frames().some((f) => { try { return /\/captcha\/(recaptcha|hcaptcha)\/iframe/i.test(f.url() || '') } catch { return false } })
}

// После вписывания токена — дождаться, что капча РЕАЛЬНО ушла (верхний экран сменился / iframe
// капчи отвалился). Возвращает true = прошли; false = токен вписан, но экран не сменился (виджет
// не принял токен ИЛИ отправка не сработала) → вызывающий код (login.js) может повторить решение.
async function waitCaptchaCleared(page, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!captchaOnScreen(page)) return true
    await sleep(600)
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

// Кликнуть чекбокс reCAPTCHA «I'm not a robot» в anchor-фрейме — «человеческий» проход. Если браузер/IP
// достаточно доверенный, reCAPTCHA пропустит БЕЗ картинок и САМА дёрнет successCallback с РОДНЫМ токеном
// (привязан к нашей сессии, нормальный risk-score → Meta примет — в отличие от пересаженного 2captcha-токена,
// который Meta скорит низко/бракует по action). Это самый дешёвый и правильный шанс. Клик мышью по
// координатам (кросс-ориджин google-фрейм — coordinates от boundingBox корректны и для под-фрейма).
async function clickRecaptchaCheckbox(page) {
  const rnd = (n) => Math.floor(Math.random() * n)
  // Подводим курсор ПО-ЧЕЛОВЕЧЕСКИ боевым `curveMoveTo` (человекоподобная кривая Безье из случайной
  // точки с промежуточными точками и дрожанием — тем же, что используется для кликов действий, `human.js`).
  // reCAPTCHA смотрит на траекторию мыши; «холодный» клик-телепорт без движения подозрителен.
  const humanClickAt = async (x, y) => {
    try { await curveMoveTo(page, x, y) } catch {}
    await sleep(140 + rnd(260))
    await page.mouse.click(x, y)
  }
  // Прочитать aria-checked чекбокса (true = reCAPTCHA пропустила/в процессе; false = не отреагировала/челлендж).
  const readChecked = async () => {
    for (const f of page.frames()) {
      let u = ''; try { u = f.url() || '' } catch {}
      if (!/recaptcha.*anchor/i.test(u)) continue
      try { const a = await f.locator('#recaptcha-anchor, .recaptcha-checkbox').first().getAttribute('aria-checked', { timeout: 1200 }); if (a != null) return a } catch {}
    }
    return 'unknown'
  }
  // Открылся ли челлендж-фрейм (bframe с картинками)? Значит клик СРАБОТАЛ, но нужен грид-солвинг.
  const challengeOpen = () => page.frames().some((f) => { try { return /recaptcha.*bframe/i.test(f.url() || '') } catch { return false } })

  // Один проход всех способов клика. Возвращает метод или null.
  const doClick = async () => {
    // (a) frameLocator во ВЛОЖЕННЫЕ фреймы (top→fbsbx→google anchor) — ждём кликабельности, человечный клик.
    try {
      const cb = page.frameLocator('iframe[src*="/captcha/recaptcha/iframe"]').frameLocator('iframe[src*="anchor"], iframe[title*="reCAPTCHA" i], iframe[title*="captcha" i]').locator('#recaptcha-anchor, .recaptcha-checkbox').first()
      await cb.waitFor({ state: 'visible', timeout: 10000 })
      const box = await cb.boundingBox().catch(() => null)
      if (box) { await humanClickAt(box.x + box.width / 2, box.y + box.height / 2); return 'frameLocator' }
      await cb.click({ timeout: 5000 }); return 'frameLocator-el'
    } catch {}
    // (b) перебор фреймов anchor (любой путь …recaptcha…anchor: api2/enterprise/bare).
    for (const f of page.frames()) {
      let u = ''; try { u = f.url() || '' } catch {}
      if (!/recaptcha.*anchor/i.test(u)) continue
      try {
        const cb = f.locator('#recaptcha-anchor, .recaptcha-checkbox, [role="checkbox"]').first()
        if (await cb.isVisible({ timeout: 3000 }).catch(() => false)) {
          const box = await cb.boundingBox().catch(() => null)
          if (box) { await humanClickAt(box.x + box.width / 2, box.y + box.height / 2); return 'anchor-el' }
          await cb.click({ timeout: 3000 }); return 'anchor-el'
        }
      } catch {}
    }
    // (c) координаты anchor-iframe (левый край = чекбокс).
    for (const f of page.frames()) {
      let u = ''; try { u = f.url() || '' } catch {}
      if (!/\/captcha\/recaptcha\/iframe/i.test(u)) continue
      try {
        const el = await f.$('iframe[src*="/anchor"], iframe[title*="reCAPTCHA" i], iframe[src*="recaptcha"]')
        const box = el && await el.boundingBox().catch(() => null)
        if (box) { await humanClickAt(box.x + 28, box.y + box.height / 2); return 'anchor-coord' }
      } catch {}
    }
    // (d) крайнее — левый край fbsbx-iframe виджета.
    for (const f of page.frames()) {
      let u = ''; try { u = f.url() || '' } catch {}
      if (!/\/captcha\/recaptcha\/iframe/i.test(u)) continue
      try { const fe = await f.frameElement().catch(() => null); const box = fe && await fe.boundingBox().catch(() => null); if (box) { await humanClickAt(box.x + 28, box.y + 26); return 'fbsbx-coord' } } catch {}
    }
    return null
  }

  let method = await doClick()
  if (!method) return { method: null, checked: 'unknown', challenge: false }
  await sleep(1600)
  let checked = await readChecked()
  let challenge = challengeOpen()
  // Клик не зарегистрировался (галочка не среагировала И челленджа нет) — ОДНА повторная попытка.
  if (checked !== 'true' && !challenge) {
    await sleep(900)
    const m2 = await doClick()
    if (m2) { method += '+retry(' + m2 + ')'; await sleep(1600); checked = await readChecked(); challenge = challengeOpen() }
  }
  return { method, checked, challenge }
}

// ── IN-BROWSER GRID-SOLVING (PLAN-MASTER.md §1.1 шаг 2 / Приложение A) ──────────────────────────
// Когда клик по чекбоксу открывает bframe-челлендж (картинки «выберите все …») — решаем ЕГО в
// НАШЕМ браузере, а не пересаживаем токен с фермы. 2captcha (CoordinatesTask) только РАСПОЗНАЁТ
// картинки; кликаем плитки мышью МЫ, в нашей странице → reCAPTCHA сама вызывает successCallback с
// РОДНЫМ токеном (наша сессия/IP/поведение) → Meta его принимает по скору (в отличие от пересаженного
// токена — см. §1.0 PLAN-MASTER.md, «ГЛАВНАЯ СТЕНА»). ADR-002 не нарушен: bframe — свой google-origin
// фрейм, не Instagram API; frame.evaluate/локаторы внутри него легальны.
const MAX_GRID_ROUNDS = 4

function findBframe(page) {
  return page.frames().find((f) => { try { return /recaptcha.*bframe/i.test(f.url() || '') } catch { return false } }) || null
}

// Инструкция задания («Select all images with a bus») — reCAPTCHA рендерит её то одним блоком
// (-no-canonical, динамические 3×3), то составным (обычная сетка) — пробуем оба варианта.
async function readChallengeInstruction(bframe) {
  for (const sel of ['.rc-imageselect-desc-no-canonical', '.rc-imageselect-desc', '.rc-imageselect-desc-wrapper']) {
    try {
      const t = (await bframe.locator(sel).first().innerText({ timeout: 2500 })).trim()
      if (t) return t
    } catch {}
  }
  return ''
}

// Кликнуть КАЖДУЮ точку, возвращённую 2captcha (координаты ВНУТРИ скриншота challenge-области) —
// смещаем на боундинг-бокс области, кривая мышь (`curveMoveTo`), пауза между кликами (не пулемётом).
async function clickCoordPoints(page, areaBox, points) {
  for (const pt of points) {
    if (!areaBox || typeof pt?.x !== 'number' || typeof pt?.y !== 'number') continue
    const x = areaBox.x + pt.x
    const y = areaBox.y + pt.y
    try { await curveMoveTo(page, x, y); await sleep(120 + Math.floor(Math.random() * 240)); await page.mouse.click(x, y) } catch {}
    await sleep(300 + Math.floor(Math.random() * 500))
  }
}

// Решить грид-челлендж: до MAX_GRID_ROUNDS раундов (reCAPTCHA обычно даёт 2–4 раунда картинок
// подряд, прежде чем принять решение). Каждый раунд: инструкция + сетка + скриншот → 2captcha
// (координаты) → клик по точкам → один доп. проход на «динамическую» подмену плиток (частый паттерн
// 3×3: клик по плитке подменяет её новой картинкой, которую тоже нужно проверить) → Verify → проверка,
// ушла ли капча (`waitCaptchaCleared`, тот же критерий, что и для чекбокса). Возвращает { ok, reason,
// rounds } — `rounds` идёт в трассу (диагностика ОБЯЗАТЕЛЬНА, вслепую эту логику не отладить — §0.1.8).
async function solveGridInBrowser(page) {
  const rounds = []
  for (let round = 1; round <= MAX_GRID_ROUNDS; round++) {
    const bframe = findBframe(page)
    if (!bframe) { rounds.push({ round, error: 'no-bframe' }); return { ok: false, reason: 'no-challenge-frame', rounds } }

    const instruction = await readChallengeInstruction(bframe)
    const tileCount = await bframe.locator('.rc-imageselect-tile').count().catch(() => 0)
    if (!tileCount) { rounds.push({ round, instruction, tileCount: 0, error: 'no-tiles' }); return { ok: false, reason: 'no-tiles-found', rounds } }

    const area = bframe.locator('.rc-imageselect-challenge, #rc-imageselect').first()
    const areaBox = await area.boundingBox().catch(() => null)
    const shotBuf = await area.screenshot({ timeout: 6000 }).catch(() => null)
    if (!shotBuf || !areaBox) { rounds.push({ round, instruction, tileCount, error: 'screenshot-failed' }); return { ok: false, reason: 'screenshot-failed', rounds } }

    let points
    try { points = await solveCoordinates(shotBuf.toString('base64'), instruction) }
    catch (e) { rounds.push({ round, instruction, tileCount, error: '2captcha: ' + (e?.message || e) }); return { ok: false, reason: 'coordinates-solve-failed', rounds } }
    if (!points || !points.length) { rounds.push({ round, instruction, tileCount, error: 'empty-coordinates' }); return { ok: false, reason: 'empty-coordinates', rounds } }

    await clickCoordPoints(page, areaBox, points)

    // Динамическая подмена (типично для 3×3 «one-time»): клик по плитке подгружает НОВУЮ картинку в
    // ту же клетку. Один дополнительный проход — переснять ту же область и добить точки, если решение
    // 2captcha всё ещё что-то находит (если новых совпадений нет — solveCoordinates вернёт пусто, тихо пропускаем).
    await sleep(900 + Math.floor(Math.random() * 700))
    const bframeAfter = findBframe(page) || bframe
    const areaAfter = bframeAfter.locator('.rc-imageselect-challenge, #rc-imageselect').first()
    const areaBoxAfter = await areaAfter.boundingBox().catch(() => null)
    const shotAfter = await areaAfter.screenshot({ timeout: 5000 }).catch(() => null)
    if (shotAfter && areaBoxAfter) {
      try {
        const points2 = await solveCoordinates(shotAfter.toString('base64'), instruction)
        if (points2 && points2.length) await clickCoordPoints(page, areaBoxAfter, points2)
      } catch {} // доп. проход best-effort — провал не критичен, идём на Verify с тем, что уже кликнули
    }

    const verifyBtn = bframeAfter.locator('#recaptcha-verify-button').first()
    if (await verifyBtn.isVisible({ timeout: 2500 }).catch(() => false)) await humanClick(page, verifyBtn)
    await sleep(1200 + Math.floor(Math.random() * 600))

    rounds.push({ round, instruction, tileCount, clicked: points.length })
    if (await waitCaptchaCleared(page, 6000)) return { ok: true, native: true, rounds }
    // не ушла — следующий раунд перечитает bframe заново (новая картинка либо «попробуйте снова»)
  }
  return { ok: false, reason: 'grid-rounds-exhausted', rounds }
}

// Обнаружить и решить капчу. Возвращает { solved, detected, log } — log несёт человекочитаемую
// трассу (что распознали, enterprise ли, что ответила 2captcha, вписан ли токен), которую login.js
// прикладывает к ошибке входа в UI — чтобы НЕ гадать вслепую, почему капча не прошла.
export async function trySolveCaptcha(page, opts = {}) {
  const t = []
  // Сетевой лог капча-запросов: когда наш токен уходит в Meta, она дёргает эндпоинт проверки —
  // его СТАТУС и есть «почему отвергнут» (низкий скор → часто 4xx/особый JSON). Ловим статусы
  // капча/verify-запросов и на неудаче прикладываем к трассе — видно СЕРВЕРНУЮ причину, не гадаем.
  const netLog = []
  try {
    page.on('response', (r) => {
      try {
        const ru = r.url()
        if (/\/captcha\/|recaptcha|auth_platform|userverify|reload|bloks|challenge/i.test(ru) && netLog.length < 16) {
          netLog.push(`${r.status()} ${ru.replace(/^https?:\/\//, '').slice(0, 70)}`)
        }
      } catch {}
    })
  } catch {}
  if (!captchaConfigured()) return { solved: false, detected: false, advanced: false, log: '2captcha не настроена (TWOCAPTCHA_API_KEY не задан на воркере)' }

  // Дать вложенным фреймам reCAPTCHA догрузиться — иначе enterprise-флаг/виджет не готовы (см. helper).
  await waitForRecaptchaReady(page).catch(() => {})

  let found = await detectCaptcha(page).catch(() => null)
  let via = 'dom'
  if (!found) { found = detectFromFrameUrls(page); via = 'frame-url' }   // фолбэк по URL фреймов (кросс-ориджин reCAPTCHA)
  if (!found) { console.error('[captcha] капча не распознана (нет sitekey ни в DOM, ни в URL фреймов)'); return { solved: false, detected: false, advanced: false, log: 'капча не распознана (нет sitekey ни в DOM, ни в URL фреймов)' } }

  // pageurl для 2captcha — домен ХОСТА капчи. Instagram рендерит reCAPTCHA в iframe fbsbx.com, и
  // sitekey привязан к fbsbx (не к instagram). С pageurl=instagram 2captcha даёт ERROR_CAPTCHA_UNSOLVABLE.
  let url = found.pageurl || page.url()
  for (const f of page.frames()) {
    let u = ''; try { u = f.url() || '' } catch {}
    if (/\/captcha\/(recaptcha|hcaptcha)\/iframe/i.test(u)) { try { const p = new URL(u); url = p.origin + p.pathname } catch { url = u } ; break }
  }
  const enterprise = isEnterpriseRecaptcha(page, found)
  const skHead = String(found.sitekey || found.publicKey || '').slice(0, 14)
  t.push(`распознана ${found.type}${enterprise ? ' ENTERPRISE' : ''} (via ${via}), sitekey ${skHead}…, pageurl ${url}, data-s ${found.dataS ? ('есть len ' + String(found.dataS).length) : 'НЕТ'}${found.dataAttrs ? ' data-attrs=' + JSON.stringify(found.dataAttrs) : ''}`)
  console.error('[captcha]', t[t.length - 1])

  // ШАГ 0 — «человеческий» клик по чекбоксу ДО 2captcha. Даёт РОДНОЙ токен, если reCAPTCHA пропустит
  // без картинок (Meta примет). Если появится картинка-челлендж — ШАГ 0.5 решает его В БРАУЗЕРЕ
  // (грид-солвинг, тоже родной токен); полная пересадка токена (ниже) — только последний фолбэк.
  if (found.type === 'recaptcha') {
    try {
      const cr = await clickRecaptchaCheckbox(page)
      if (cr.method) {
        if (await waitCaptchaCleared(page, 8000)) {
          t.push(`клик чекбокса (${cr.method}, aria-checked=${cr.checked}) → verify: капча УШЛА ✓ (РОДНОЙ токен, без 2captcha)`)
          console.error('[captcha]', t[t.length - 1])
          return { solved: true, detected: true, advanced: true, log: t.join(' | ') }
        }
        // Диагноз ТОЧНО: клик зарегистрировался? выпала ли картинка? — по aria-checked + bframe.
        t.push(`клик чекбокса (${cr.method}) СДЕЛАН: aria-checked=${cr.checked}, картинка-челлендж=${cr.challenge ? 'ДА' : 'нет'}`)
        console.error('[captcha]', t[t.length - 1])

        // ШАГ 0.5 — картинка выпала → решаем ЕЁ в браузере (грид, §1.1 шаг 2 PLAN-MASTER.md), а не
        // пересаживаем токен. Только если есть чем решать (2captcha настроена) и bframe реально открылся.
        if (cr.challenge && captchaConfigured()) {
          try {
            const grid = await solveGridInBrowser(page)
            const roundsTxt = grid.rounds.map((r) => {
              const instr = r.instruction ? `«${r.instruction.replace(/\s+/g, ' ').slice(0, 50)}»` : '—'
              const outcome = r.error ? `ошибка=${r.error}` : `кликов=${r.clicked ?? 0}`
              return `раунд ${r.round}: ${instr} сетка=${r.tileCount || '?'} ${outcome}`
            }).join('; ')
            if (grid.ok) {
              t.push(`грид-солвинг: ${roundsTxt} → капча УШЛА ✓ (РОДНОЙ токен, без пересадки)`)
              console.error('[captcha]', t[t.length - 1])
              return { solved: true, detected: true, advanced: true, log: t.join(' | ') }
            }
            t.push(`грид-солвинг: ${roundsTxt} → не решено (${grid.reason}) → пересадка токена (фолбэк)`)
          } catch (e) { t.push('грид-солвинг: ошибка ' + (e?.message || e) + ' → пересадка токена (фолбэк)') }
        } else if (cr.challenge) {
          t.push('грид-солвинг недоступен (2captcha не настроена) → пересадка токена (фолбэк)')
        } else {
          t.push('картинки нет, но капча не ушла → пересадка токена')
        }
        console.error('[captcha]', t[t.length - 1])
      } else {
        t.push('чекбокс НЕ найден для клика (anchor-фрейм не загрузился?) → 2captcha')
      }
    } catch (e) { t.push('клик чекбокса: ошибка ' + (e?.message || e)) }
  }

  const attemptNotes = []
  const onAttempt = (n, msg) => { attemptNotes.push(`п.${n}: ${msg}`) }
  try {
    const started = Date.now()
    let token
    if (found.type === 'hcaptcha') token = await solveHCaptcha({ sitekey: found.sitekey, url, onAttempt })
    else if (found.type === 'funcaptcha') token = await solveFunCaptcha({ publicKey: found.publicKey, surl: found.surl, url, onAttempt })
    else if (found.type === 'recaptcha' && enterprise) {
      // ENTERPRISE → createTask. Если есть наш proxy → PROXY-задача (решают через НАШ IP+UA → токен
      // привязан к нашей сессии, Meta скорит выше). userAgent берём со страницы (тот же, что у входа).
      let userAgent = ''
      try { userAgent = await page.evaluate(() => navigator.userAgent) } catch {}
      t.push(`solve via createTask ENTERPRISE (${opts.proxy ? 'PROXY-задача, наш IP' : 'proxyless'}, action=${found.action || '—'}${found.dataS ? ', s=есть' : ''})`)
      token = await solveRecaptchaEnterprise({ sitekey: found.sitekey, url, action: found.action, dataS: found.dataS, proxy: opts.proxy, userAgent, onAttempt })
    } else token = await solveRecaptchaV2({ sitekey: found.sitekey, url, enterprise, dataS: found.dataS, action: found.action, onAttempt })
    const solveSec = Math.round((Date.now() - started) / 1000)
    const applied = await injectToken(page, found.type, token)
    // Проверяем, что капча РЕАЛЬНО ушла (экран сменился / iframe отвалился) — а не «токен вписан вслепую».
    const advanced = await waitCaptchaCleared(page)
    const retryTxt = attemptNotes.length > 1 ? ` [ретраи: ${attemptNotes.slice(0, -1).join('; ')}]` : ''
    let verifyTxt = advanced ? 'капча УШЛА ✓' : 'экран НЕ сменился ✗'
    if (!advanced) {
      try { verifyTxt += ' | frames: ' + (await captchaFramesDump(page)) } catch {}   // дамп fbsbx — чего ждёт для отправки
      await sleep(1500)   // дать verify-запросу Meta уйти после инъекции токена, прежде чем снять netLog
      if (netLog.length) verifyTxt += ' | net: ' + JSON.stringify(netLog.slice(-10))   // статусы капча/verify-запросов = серверная причина отказа
    }
    t.push(`2captcha OK: токен len ${token ? token.length : 0} за ${solveSec}с${retryTxt}, вписан [textarea ${applied.textarea ? '✓' : '✗'}, getResponse ${applied.getResponse ? '✓' : '✗'}, data-callback ${applied.dataCallback ? '✓' : '✗'}, cfg-callback ${applied.cfgCallback ? '✓' : '✗'}, form-submit ${applied.formSubmit ? '✓' : '✗'}, postMessage ${applied.postMessage ? '✓' : '✗'}] → verify: ${verifyTxt}`)
    console.error('[captcha]', t[t.length - 1])
    return { solved: true, detected: true, advanced, log: t.join(' | ') }
  } catch (e) {
    const retryTxt = attemptNotes.length ? ` [${attemptNotes.join('; ')}]` : ''
    t.push('2captcha ОШИБКА: ' + (e?.message || String(e)) + retryTxt)
    console.error('[captcha] решение 2captcha не удалось:', e?.message || e)
    return { solved: false, detected: true, advanced: false, log: t.join(' | ') }
  }
}

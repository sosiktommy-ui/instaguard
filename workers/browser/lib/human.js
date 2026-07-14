// Человекоподобное поведение: ввод по буквам, паузы, «прогрев» ленты.
// Медленный ввод и паузы — ключевое отличие от мгновенного page.fill (см. plan.md §1/§4.3).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Случайная пауза в диапазоне [min,max] мс.
export function jitter(min, max) {
  return sleep(min + Math.floor(Math.random() * Math.max(1, max - min)))
}

// ── Реалистичная печать (plan.md §1.4) ───────────────────────────────────────
const rnd = (n) => Math.floor(Math.random() * n)

// Соседи по QWERTY — для правдоподобной опечатки (её тут же исправляем backspace,
// поэтому итоговое значение поля ВСЕГДА корректно; меняется лишь ДИНАМИКА ввода,
// которую анализирует анти-бот Instagram — так выглядит по-человечески).
const QWERTY_NEIGHBORS = {
  a: 'qwsz', b: 'vghn', c: 'xdfv', d: 'serfcx', e: 'wsdr', f: 'drtgvc', g: 'ftyhbv',
  h: 'gyujnb', i: 'ujko', j: 'huikmn', k: 'jiolm', l: 'kop', m: 'njk', n: 'bhjm',
  o: 'iklp', p: 'ol', q: 'wa', r: 'edft', s: 'awedxz', t: 'rfgy', u: 'yhji',
  v: 'cfgb', w: 'qase', x: 'zsdc', y: 'tghu', z: 'asx',
  1: '2', 2: '13', 3: '24', 4: '35', 5: '46', 6: '57', 7: '68', 8: '79', 9: '80', 0: '9',
}
function neighborOf(ch) {
  const low = ch.toLowerCase()
  const n = QWERTY_NEIGHBORS[low]
  if (!n) return null
  const t = n[rnd(n.length)]
  return ch === ch.toUpperCase() && /[a-z]/.test(low) ? t.toUpperCase() : t
}
// Задержка под символ: заглавные/цифры/пунктуация печатаются чуть дольше (Shift/дальше от рук).
function charDelay(ch) {
  let d = 65 + rnd(120)                                 // база 65–185 мс
  if (/[A-ZА-Я]/.test(ch)) d += 40 + rnd(80)            // Shift
  if (/[^a-zA-Zа-яА-Я0-9\s]/.test(ch)) d += 30 + rnd(90) // пунктуация/символы
  return d
}

// Печать по буквам: переменный ритм + редкие опечатки с исправлением + паузы после слов
// и «раздумья». Используется ВЕЗДЕ (логин, пароль, код, директы, комменты) — см. plan.md §1.4.
export async function humanType(locator, text) {
  await locator.click({ delay: 40 + rnd(80) })
  await jitter(120, 380)                                // «прочитал» поле перед вводом
  const s = String(text)
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    // ~4%/символ: опечатка соседней клавишей → замечаем → стираем → печатаем верную.
    if (Math.random() < 0.04) {
      const wrong = neighborOf(ch)
      if (wrong) {
        try {
          await locator.pressSequentially(wrong, { delay: charDelay(ch) })
          await jitter(140, 360)                        // «заметил ошибку»
          await locator.press('Backspace')
          await jitter(90, 240)
        } catch { /* исправление не удалось — не критично, печатаем верный символ ниже */ }
      }
    }
    await locator.pressSequentially(ch, { delay: charDelay(ch) })
    if (ch === ' ') await jitter(70, 200)               // микропауза между словами
    else if (Math.random() < 0.05) await jitter(220, 560) // иногда «задумался»
  }
}

// ── Человеческая траектория мыши (plan.md §1.3) ──────────────────────────────
// Подвести курсор к точке НЕ телепортом, а кривой: 2–4 промежуточные точки с лёгким
// отклонением от прямой и разной скоростью (steps). Старт — из случайной позиции.
export async function curveMoveTo(page, x, y) {
  try {
    const vp = page.viewportSize() || { width: 1280, height: 800 }
    let cx = rnd(vp.width), cy = rnd(vp.height)
    const pts = 2 + rnd(3)
    for (let i = 1; i <= pts; i++) {
      const t = i / pts
      const nx = cx + (x - cx) * t + (Math.random() - 0.5) * 40   // дрожь/кривизна
      const ny = cy + (y - cy) * t + (Math.random() - 0.5) * 40
      await page.mouse.move(nx, ny, { steps: 6 + rnd(14) })
      await jitter(30, 120)
    }
    await page.mouse.move(x, y, { steps: 4 + rnd(8) })            // финальное наведение точно к цели
  } catch {}
}

// Клик по локатору по-человечески: доскроллить к элементу, навести курсор кривой к точке
// СО СМЕЩЕНИЕМ от центра (человек не бьёт идеально в центр), затем клик мышью по координатам.
// Фолбэк на обычный locator.click(), если bounding box недоступен. Возвращает true/false.
export async function humanClick(page, locator, { timeout = 8000 } = {}) {
  try {
    const el = locator.first()
    await el.waitFor({ state: 'visible', timeout }).catch(() => {})
    await el.scrollIntoViewIfNeeded().catch(() => {})
    const box = await el.boundingBox().catch(() => null)
    if (box && box.width > 0 && box.height > 0) {
      const x = box.x + box.width * (0.3 + Math.random() * 0.4)
      const y = box.y + box.height * (0.3 + Math.random() * 0.4)
      await curveMoveTo(page, x, y)
      await jitter(60, 200)
      await page.mouse.click(x, y, { delay: 40 + rnd(90) })
      return true
    }
    await el.click({ delay: 50 + rnd(80) })
    return true
  } catch {
    return false
  }
}

// Лёгкие движения мыши + случайный скролл, чтобы не выглядеть как бот при старте.
export async function idleMouse(page) {
  try {
    const w = page.viewportSize()?.width ?? 1280
    const hgt = page.viewportSize()?.height ?? 800
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      await page.mouse.move(Math.random() * w, Math.random() * hgt, { steps: 5 + Math.floor(Math.random() * 10) })
      await jitter(120, 400)
    }
  } catch {}
}

// Пауза «чтения поста» — переменная (иногда бегло, иногда залипнуть). §1.2.
const readingPause = () => (Math.random() < 0.2 ? jitter(4000, 9000) : jitter(1200, 5000))

const goHome = (page) =>
  page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})

// Плавный «человеческий» скролл: несколько колёсиков вниз с паузами чтения, редкий скролл вверх
// (передумал / вернулся посмотреть), движения мыши. Разное число/амплитуда каждый раз.
async function humanScroll(page, min, max) {
  const n = min + rnd(Math.max(1, max - min + 1))
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, 260 + rnd(820))          // разная амплитуда
    await readingPause()
    if (Math.random() < 0.15) { await page.mouse.wheel(0, -(120 + rnd(300))); await jitter(600, 1800) } // отскок вверх
    if (Math.random() < 0.3) await idleMouse(page)
  }
}

// ── Репертуар органических активностей (каждая best-effort, НИКОГДА не роняет прогрев) ──
// Бот не повторяет одно и то же: каждый прогрев — случайная выборка из этих действий в случайном
// порядке, с разной глубиной/таймингом. Все — навигация + скролл + возврат (устойчиво, без хрупких
// кликов, что могли бы зависнуть). ⚠️ Лайки/подписки тут НЕ делаем (нет доступа к дневным лимитам).

async function actFeed(page) {
  if (!/^https:\/\/www\.instagram\.com\/?(\?.*)?$/.test(page.url())) await goHome(page)
  await jitter(1000, 2600); await idleMouse(page)
  await humanScroll(page, 2, 6)
}

async function actExplore(page) {
  await page.goto('https://www.instagram.com/explore/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await jitter(1400, 3200); await idleMouse(page)
  await humanScroll(page, 1, 4)
  if (Math.random() < 0.5) await goHome(page)  // иногда вернуться на ленту, иногда остаться
}

async function actReels(page) {
  await page.goto('https://www.instagram.com/reels/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await jitter(2500, 6000)                       // «смотрит» ролик
  const n = 1 + rnd(3)
  for (let i = 0; i < n; i++) { await page.mouse.wheel(0, 500 + rnd(600)); await jitter(2500, 7000) }
  if (Math.random() < 0.6) await goHome(page)
}

async function actProfilePeek(page) {
  // заглянуть в случайный профиль из текущей страницы и вернуться
  const hrefs = await page.locator('main a[href^="/"], a[href^="/"]').evaluateAll((els) =>
    Array.from(new Set(els.map((e) => e.getAttribute('href'))))
      .filter((h) => h && /^\/[^/]+\/$/.test(h) && !['/explore/', '/reels/', '/direct/', '/p/', '/accounts/'].some((s) => h.startsWith(s)))
  ).catch(() => [])
  if (!hrefs.length) return actFeed(page)
  const h = hrefs[rnd(Math.min(hrefs.length, 8))]
  await page.goto(`https://www.instagram.com${h}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await jitter(1500, 3800); await idleMouse(page)
  await humanScroll(page, 1, 3)
  if (Math.random() < 0.75) await goHome(page)
}

async function actIdle(page) {
  // просто «завис»: подвигал мышью, подождал (человек отвлёкся)
  await idleMouse(page); await readingPause()
  if (Math.random() < 0.5) { await page.mouse.wheel(0, 200 + rnd(400)); await readingPause() }
}

// Иногда поставить лайк в ЛЕНТЕ (как живой человек листает и лайкает интересное). Клик мышью
// (humanClick — курсор кривой + клик по координатам), лайкаем свои же ленточные посты (контент,
// на который аккаунт подписан) — низкий риск, но живое поведение. Локализованный aria-label сердца.
const FEED_LIKE_LABELS = ['Like', 'Нравится', 'Подобається', 'Me gusta', 'Curtir', 'J’aime', "J'aime", 'Suka', 'いいね！', '좋아요', 'Beğen']
async function actLikeInFeed(page) {
  if (!/^https:\/\/www\.instagram\.com\/?(\?.*)?$/.test(page.url())) await goHome(page)
  await jitter(1000, 2400)
  await humanScroll(page, 1, 3)                       // долистать до поста, «почитать»
  const likes = 1 + (Math.random() < 0.25 ? 1 : 0)    // обычно 1, иногда 2 — не увлекаемся
  for (let n = 0; n < likes; n++) {
    let liked = false
    for (const label of FEED_LIKE_LABELS) {
      const heart = page.locator(`article svg[aria-label="${label}"]`).first()
      if (await heart.isVisible().catch(() => false)) {
        const anc = heart.locator('xpath=ancestor::*[(@role="button") or (self::button)][1]')
        const target = (await anc.count().catch(() => 0)) ? anc.first() : heart
        await humanClick(page, target)
        liked = true
        break
      }
    }
    if (!liked) break
    await readingPause()
    if (n < likes - 1) await humanScroll(page, 1, 2)  // пролистать к следующему перед вторым лайком
  }
}

// Взвешенный выбор активности (лента — чаще всего; остальное — приправа для разнообразия).
const ACTIVITIES = [
  { fn: actFeed, w: 5 }, { fn: actExplore, w: 2 }, { fn: actProfilePeek, w: 2 },
  { fn: actReels, w: 1 }, { fn: actIdle, w: 2 }, { fn: actLikeInFeed, w: 2 },
]
function pickActivity(exclude, allowLike) {
  const pool = ACTIVITIES.filter((a) => a.fn !== exclude && (allowLike || a.fn !== actLikeInFeed))
  const total = pool.reduce((s, a) => s + a.w, 0)
  let r = Math.random() * total
  for (const a of pool) { r -= a.w; if (r <= 0) return a.fn }
  return actFeed
}

/**
 * Органический прогрев (plan.md §1.2): выполняет `count` РАЗНЫХ активностей в случайном порядке,
 * чтобы поведение не было машинно-однообразным (не «скролл ленты» 1000 раз подряд весь месяц).
 * Всё в try/catch — прогрев НИКОГДА не роняет вход/действие.
 */
async function organicBrowse(page, count, { allowLike = false } = {}) {
  try {
    let last = null
    for (let i = 0; i < count; i++) {
      const fn = pickActivity(last, allowLike)   // не повторяем ту же активность подряд
      last = fn
      try { await fn(page) } catch {}
      if (i < count - 1) await jitter(800, 2400)  // пауза между активностями
    }
  } catch {}
}

// Богатый «прогрев» — при входе / в начале визита (§1.1) / keep-alive: 2–4 разных активности.
// Лайки в ленте разрешены ЗДЕСЬ (нечастый прогрев: вход + keep-alive раз в ~3.5ч), чтобы аккаунт
// иногда лайкал ленту как живой человек — но не перед каждым действием (иначе накопится много).
export async function warmupFeed(page) {
  await organicBrowse(page, 2 + rnd(3), { allowLike: true })
}

// Лёгкий браузинг ПЕРЕД действием (§1.2), чтобы действие не шло «вхолодную»: 1–2 активности,
// но тоже разные от раза к разу (иногда лента, иногда explore/idle) — не предсказуемо.
// БЕЗ лайков в ленте (иначе перед каждым действием = слишком много лайков).
export async function preActionBrowse(page) {
  await organicBrowse(page, 1 + rnd(2))
}

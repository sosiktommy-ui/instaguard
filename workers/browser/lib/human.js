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

// «Прогрев»: зайти на главную и проскроллить пару экранов перед первым действием сессии.
export async function warmupFeed(page) {
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 })
    await jitter(1500, 3000)
    await idleMouse(page)
    for (let i = 0; i < 2; i++) {
      await page.mouse.wheel(0, 500 + Math.random() * 700)
      await jitter(800, 1800)
    }
  } catch {}
}

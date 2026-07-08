// Человекоподобное поведение: ввод по буквам, паузы, «прогрев» ленты.
// Медленный ввод и паузы — ключевое отличие от мгновенного page.fill (см. plan.md §1/§4.3).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Случайная пауза в диапазоне [min,max] мс.
export function jitter(min, max) {
  return sleep(min + Math.floor(Math.random() * Math.max(1, max - min)))
}

// Печать по буквам с задержкой 80–220 мс/символ + редкие «раздумья».
export async function humanType(locator, text) {
  await locator.click({ delay: 40 + Math.floor(Math.random() * 80) })
  for (const ch of String(text)) {
    await locator.type(ch, { delay: 80 + Math.floor(Math.random() * 140) })
    if (Math.random() < 0.06) await jitter(200, 550) // иногда «задумался»
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

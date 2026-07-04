// Цветовые помощники для 3D-иконок и свечения (единый источник для всех вкладок).

/** hex → rgba со заданной альфой */
export function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** затемнить hex на коэффициент f (0..1) — для градиента объёмной иконки */
export function darken(hex: string, f = 0.8) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

// Фирменные цвета типов/акцентов — одни и те же на всех экранах
export const TONE = {
  brand: '#663af1',
  alt: '#6a7df9',
  ok: '#34c759',
  warn: '#ff9500',
  bad: '#ff3b30',
  pink: '#ff2d92',
} as const

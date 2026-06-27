/**
 * Неоновый логотип InstaGuard — голубая Instagram-камера со свечением на тёмной плитке.
 * Двухслойный неон: цветной ореол (с blur-фильтром) + бело-голубое «горячее» ядро сверху.
 */
export function AppLogo({ size = 38, detailed = false, className }: { size?: number; detailed?: boolean; className?: string }) {
  // Контуры камеры (рисуются дважды — ореол и ядро)
  const glyph = (stroke: string, sw: number, dotR: number, filter?: string) => (
    <g filter={filter} stroke={stroke} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <rect x="24" y="24" width="52" height="52" rx="16" />
      <circle cx="50" cy="50" r="13.5" />
      <circle cx="68.5" cy="31.5" r={dotR} fill={stroke} stroke="none" />
    </g>
  )

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ig-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0c1530" />
          <stop offset="1" stopColor="#05070f" />
        </linearGradient>
        <linearGradient id="ig-neon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7df3ff" />
          <stop offset="0.5" stopColor="#39b6ff" />
          <stop offset="1" stopColor="#2f74ff" />
        </linearGradient>
        <radialGradient id="ig-aura" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#39b6ff" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#2f74ff" stopOpacity="0.18" />
          <stop offset="1" stopColor="#2f74ff" stopOpacity="0" />
        </radialGradient>
        <filter id="ig-neon-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="b1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="ig-tile-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000000" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* тёмная плитка */}
      <rect x="6" y="6" width="88" height="88" rx="24" fill="url(#ig-tile)" filter="url(#ig-tile-shadow)" />
      <rect x="6" y="6" width="88" height="88" rx="24" fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="1" />
      {/* мягкая аура-«дымка» */}
      <circle cx="50" cy="52" r="40" fill="url(#ig-aura)" />

      {/* неон: цветной ореол (пульсирует) + бело-голубое ядро */}
      <g className={detailed ? 'pulse-glow' : undefined}>
        {glyph('url(#ig-neon)', 5, 4, 'url(#ig-neon-glow)')}
      </g>
      {glyph('#e6fcff', 1.7, 2.3)}
    </svg>
  )
}

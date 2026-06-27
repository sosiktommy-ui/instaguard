/**
 * Неоновый 3D-логотип InstaGuard.
 * compact (по умолчанию) — тёмная плитка с неоновым IG-кольцом и молнией (для шапки/favicon).
 * detailed — та же плитка + вокруг связанные узлы-аккаунты с «схемными» линиями (для крупного показа).
 */
export function AppLogo({ size = 36, detailed = false, className }: { size?: number; detailed?: boolean; className?: string }) {
  // Центральная плитка как переиспользуемая группа
  const Tile = (
    <g filter="url(#ig-soft)">
      {/* плитка */}
      <rect x="34" y="34" width="64" height="64" rx="18" fill="url(#ig-tile)" stroke="url(#ig-stroke)" strokeWidth="1.5" />
      <rect x="34" y="34" width="64" height="64" rx="18" fill="url(#ig-gloss)" />
      {/* неоновое IG-кольцо */}
      <g filter="url(#ig-glow)">
        <circle cx="66" cy="66" r="18" fill="none" stroke="url(#ig-ring)" strokeWidth="4.2" strokeLinecap="round" strokeDasharray="96 18" transform="rotate(-35 66 66)" />
        <circle cx="80.5" cy="51.5" r="2.6" fill="#ff8ad4" />
      </g>
      {/* молния */}
      <g filter="url(#ig-glow)">
        <path d="M70 46 L55 69 L65 69 L61 86 L80 61 L69.5 61 Z" fill="url(#ig-bolt)" stroke="#eafcff" strokeWidth="1" strokeLinejoin="round" />
      </g>
    </g>
  )

  const Node = (cx: number, cy: number, color: string) => (
    <g filter="url(#ig-glow)">
      <circle cx={cx} cy={cy} r="9" fill="url(#ig-tile)" stroke={color} strokeWidth="2" />
      <circle cx={cx} cy={cy - 1.5} r="2.6" fill={color} />
      <path d={`M ${cx - 4} ${cy + 4.5} q 4 -4 8 0`} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </g>
  )

  if (!detailed) {
    // обрезаем viewBox до плитки (+ запас под свечение/тень)
    return (
      <svg width={size} height={size} viewBox="28 28 78 80" className={className} xmlns="http://www.w3.org/2000/svg">
        <Defs />
        {Tile}
      </svg>
    )
  }

  // Узлы по кругу + схемные линии к плитке
  const nodes: [number, number, string][] = [
    [66, 16, '#a78bfa'], [116, 40, '#ff5fa2'], [116, 92, '#ff5fa2'],
    [66, 116, '#a78bfa'], [16, 92, '#38bdf8'], [16, 40, '#38bdf8'],
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" className={className} xmlns="http://www.w3.org/2000/svg">
      <Defs />
      {/* линии-схемы */}
      <g stroke="url(#ig-line)" strokeWidth="1.6" fill="none" opacity="0.85" filter="url(#ig-glow)">
        {nodes.map(([x, y], i) => {
          const tx = 66 + (x - 66) * 0.34
          const ty = 66 + (y - 66) * 0.34
          return <path key={i} d={`M${x} ${y} L${tx} ${ty}`} />
        })}
        <circle cx="66" cy="66" r="50" stroke="url(#ig-line)" strokeWidth="1.1" opacity="0.5" />
      </g>
      {nodes.map(([x, y, c], i) => <g key={i}>{Node(x, y, c)}</g>)}
      {Tile}
    </svg>
  )
}

function Defs() {
  return (
    <defs>
      <linearGradient id="ig-tile" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#241b2e" />
        <stop offset="1" stopColor="#0b0b12" />
      </linearGradient>
      <linearGradient id="ig-gloss" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
        <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="ig-stroke" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0.05" />
      </linearGradient>
      <linearGradient id="ig-ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffd166" />
        <stop offset="0.35" stopColor="#ff5fa2" />
        <stop offset="0.7" stopColor="#a855f7" />
        <stop offset="1" stopColor="#22d3ee" />
      </linearGradient>
      <linearGradient id="ig-bolt" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7df9ff" />
        <stop offset="0.55" stopColor="#38bdf8" />
        <stop offset="1" stopColor="#6366f1" />
      </linearGradient>
      <linearGradient id="ig-line" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#38bdf8" />
        <stop offset="0.5" stopColor="#a855f7" />
        <stop offset="1" stopColor="#ff5fa2" />
      </linearGradient>
      <filter id="ig-glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="1.8" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="ig-soft" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000000" floodOpacity="0.35" />
      </filter>
    </defs>
  )
}

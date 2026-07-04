/**
 * Reactive — маскот сервиса. Неоновое «энергетическое» существо в фирменных
 * фиолетово-синих цветах (свечение, светящиеся глаза, языки-пламя, искры).
 * Используется в игровом обучении. Чтобы заменить на реальный арт —
 * положите PNG в /public/Foto и отрендерьте <img> вместо этого SVG.
 */
export function ReactiveMascot({ size = 120, className, animated = true }: { size?: number; className?: string; animated?: boolean }) {
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 220 240" className={cnAnim(className, animated)} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="rm-aura" cx="50%" cy="45%" r="55%">
          <stop offset="0" stopColor="#9b66ff" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#6a7df9" stopOpacity="0.22" />
          <stop offset="1" stopColor="#6a7df9" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="rm-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cff" />
          <stop offset="0.55" stopColor="#663af1" />
          <stop offset="1" stopColor="#3aa0ff" />
        </linearGradient>
        <linearGradient id="rm-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#6a7df9" />
          <stop offset="0.5" stopColor="#9b66ff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <filter id="rm-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="b2" />
          <feMerge>
            <feMergeNode in="b2" /><feMergeNode in="b1" /><feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="rm-eye" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
        </filter>
      </defs>

      {/* аура */}
      <ellipse cx="110" cy="112" rx="100" ry="110" fill="url(#rm-aura)" />

      {/* искры */}
      <g fill="#ffd7a1" opacity="0.9">
        <circle cx="40" cy="80" r="2.4" /><circle cx="52" cy="70" r="1.6" />
        <circle cx="182" cy="96" r="2.6" /><circle cx="192" cy="120" r="1.6" />
        <circle cx="60" cy="150" r="1.6" />
      </g>

      <g filter="url(#rm-glow)">
        {/* языки-пламя на голове */}
        <path d="M78 58 C70 30 96 26 98 44 C104 20 128 26 122 52 C140 34 150 58 132 70 Z"
          fill="url(#rm-flame)" opacity="0.95" />

        {/* уши */}
        <path d="M70 76 L58 44 L92 66 Z" fill="url(#rm-body)" />
        <path d="M150 76 L162 44 L128 66 Z" fill="url(#rm-body)" />

        {/* голова */}
        <ellipse cx="110" cy="96" rx="52" ry="46" fill="url(#rm-body)" />

        {/* тело */}
        <path d="M74 128 C74 118 146 118 146 128 C150 168 138 196 110 196 C82 196 70 168 74 128 Z" fill="url(#rm-body)" />

        {/* руки */}
        <path d="M74 138 C56 146 48 164 54 178 C60 168 70 160 82 156 Z" fill="url(#rm-body)" />
        <path d="M146 138 C164 146 172 164 166 178 C160 168 150 160 138 156 Z" fill="url(#rm-body)" />

        {/* ноги */}
        <ellipse cx="94" cy="204" rx="14" ry="10" fill="url(#rm-body)" />
        <ellipse cx="126" cy="204" rx="14" ry="10" fill="url(#rm-body)" />
      </g>

      {/* блики на теле */}
      <ellipse cx="92" cy="80" rx="14" ry="18" fill="#ffffff" opacity="0.18" />

      {/* светящиеся глаза */}
      <g>
        <g filter="url(#rm-eye)" fill="#eaf6ff">
          <path d="M84 92 q14 -12 26 -2 q-14 8 -26 2 Z" />
          <path d="M136 90 q-14 -12 -26 -2 q14 8 26 2 Z" />
        </g>
        <path d="M84 92 q14 -12 26 -2 q-14 8 -26 2 Z" fill="#ffffff" />
        <path d="M136 90 q-14 -12 -26 -2 q14 8 26 2 Z" fill="#ffffff" />
      </g>

      {/* рот */}
      <path d="M104 112 q6 6 12 0" stroke="#0b1030" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function cnAnim(className?: string, animated?: boolean) {
  return [className, animated ? 'rm-bob' : ''].filter(Boolean).join(' ')
}

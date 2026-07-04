'use client'

import { useState, useRef, useEffect } from 'react'

/**
 * Reactive — маскот сервиса.
 * Если в /public/Foto/reactive-mascot.png лежит реальный арт (как на фото 3) —
 * используется он. Если файла нет — рисуется запасной милый неоновый SVG.
 * То есть, чтобы поставить «того самого» маскота, достаточно положить PNG,
 * ничего в коде менять не нужно.
 */
export function ReactiveMascot({ size = 120, className, animated = true }: { size?: number; className?: string; animated?: boolean }) {
  const [imgOk, setImgOk] = useState(true)
  const ref = useRef<HTMLImageElement>(null)
  const cls = [className, animated ? 'rm-bob' : ''].filter(Boolean).join(' ')

  // Событие error у <img> при SSR/гидрации может выстрелить раньше, чем навесится
  // React-обработчик, — тогда бы висела «сломанная» картинка. Проверяем состояние
  // картинки после монтирования и надёжно переключаемся на SVG-фолбэк.
  useEffect(() => {
    const img = ref.current
    if (img && img.complete && img.naturalWidth === 0) setImgOk(false)
  }, [])

  if (imgOk) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img ref={ref} src="/Foto/reactive-mascot.png" alt="Reactive" width={size} height={size} draggable={false}
        className={cls} style={{ objectFit: 'contain', display: 'block' }}
        onError={() => setImgOk(false)}
        onLoad={(e) => { if ((e.currentTarget as HTMLImageElement).naturalWidth === 0) setImgOk(false) }} />
    )
  }

  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={cls} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="rm-aura" cx="50%" cy="48%" r="52%">
          <stop offset="0" stopColor="#9b66ff" stopOpacity="0.5" />
          <stop offset="0.55" stopColor="#6a7df9" stopOpacity="0.16" />
          <stop offset="1" stopColor="#6a7df9" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="rm-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8b5cff" />
          <stop offset="0.55" stopColor="#6f45f0" />
          <stop offset="1" stopColor="#4f7bf7" />
        </linearGradient>
        <radialGradient id="rm-eye" cx="50%" cy="42%" r="60%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#eaf3ff" />
          <stop offset="1" stopColor="#bcd8ff" />
        </radialGradient>
        <filter id="rm-soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.4" result="b1" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b2" />
          <feMerge><feMergeNode in="b2" /><feMergeNode in="b1" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="rm-eyeglow" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" />
        </filter>
      </defs>

      <circle cx="100" cy="98" r="92" fill="url(#rm-aura)" />

      <g fill="#ffd7a1" opacity="0.85">
        <circle cx="46" cy="70" r="2" /><circle cx="156" cy="72" r="2.2" /><circle cx="150" cy="120" r="1.5" /><circle cx="52" cy="120" r="1.5" />
      </g>

      <g filter="url(#rm-soft)">
        <path d="M64 62 C60 40 78 40 84 58 C74 56 68 58 64 62 Z" fill="url(#rm-body)" />
        <path d="M136 62 C140 40 122 40 116 58 C126 56 132 58 136 62 Z" fill="url(#rm-body)" />
        <path d="M100 46 C132 46 152 70 152 104 C152 140 130 160 100 160 C70 160 48 140 48 104 C48 70 68 46 100 46 Z" fill="url(#rm-body)" />
        <ellipse cx="82" cy="162" rx="13" ry="9" fill="url(#rm-body)" />
        <ellipse cx="118" cy="162" rx="13" ry="9" fill="url(#rm-body)" />
      </g>

      <ellipse cx="100" cy="74" rx="40" ry="22" fill="#ffffff" opacity="0.14" />

      <g filter="url(#rm-eyeglow)" opacity="0.9">
        <circle cx="80" cy="100" r="16" fill="#daf0ff" />
        <circle cx="120" cy="100" r="16" fill="#daf0ff" />
      </g>
      <circle cx="80" cy="100" r="14" fill="url(#rm-eye)" />
      <circle cx="120" cy="100" r="14" fill="url(#rm-eye)" />
      <circle cx="84" cy="104" r="4.2" fill="#3a2a7a" opacity="0.55" />
      <circle cx="116" cy="104" r="4.2" fill="#3a2a7a" opacity="0.55" />
      <circle cx="76" cy="94" r="3" fill="#ffffff" />
      <circle cx="112" cy="94" r="3" fill="#ffffff" />

      <ellipse cx="66" cy="120" rx="7" ry="4" fill="#ff8ad4" opacity="0.35" />
      <ellipse cx="134" cy="120" rx="7" ry="4" fill="#ff8ad4" opacity="0.35" />
      <path d="M90 124 Q100 133 110 124" stroke="#f3e9ff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  )
}

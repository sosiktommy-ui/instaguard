'use client'

import { useEffect, useRef } from 'react'

/**
 * Живой 3D-фон:
 *  1) анимированные цветные орбы (CSS) — видны всегда, даже без WebGL;
 *  2) сеть Vanta NET поверх прозрачным холстом (тематически = связанные аккаунты);
 *  3) лёгкая вуаль для читаемости контента.
 */
export default function VantaBackground() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let effect: any = null
    let cancelled = false

    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    ;(async () => {
      try {
        const THREE = await import('three')
        const mod = await import('vanta/dist/vanta.net.min')
        const NET = (mod as any).default ?? (mod as any)
        if (cancelled || !ref.current) return
        effect = NET({
          el: ref.current,
          THREE,
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          scale: 1,
          scaleMobile: 1,
          color: 0x4f46e5,           // насыщенный индиго — заметнее на светлом
          backgroundColor: 0xf5f5f7,
          backgroundAlpha: 0,        // прозрачный холст → видно орбы под ним
          points: 13,
          maxDistance: 26,
          spacing: 14,
          showDots: true,
        })
      } catch (e) {
        console.warn('[vanta] init failed, using gradient fallback:', e)
      }
    })()

    return () => { cancelled = true; if (effect?.destroy) effect.destroy() }
  }, [])

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      {/* 1. Анимированные орбы — ярче и крупнее (видны всегда) */}
      <div className="orb" style={{ top: '-14%', left: '-8%', width: '60vw', height: '60vw', background: 'radial-gradient(circle, rgba(0,113,227,0.70), transparent 66%)', animation: 'drift-a 18s ease-in-out infinite' }} />
      <div className="orb" style={{ bottom: '-18%', right: '-10%', width: '58vw', height: '58vw', background: 'radial-gradient(circle, rgba(94,92,230,0.66), transparent 66%)', animation: 'drift-b 22s ease-in-out infinite' }} />
      <div className="orb" style={{ top: '26%', right: '8%', width: '38vw', height: '38vw', background: 'radial-gradient(circle, rgba(255,95,162,0.50), transparent 68%)', animation: 'drift-a 26s ease-in-out infinite reverse' }} />
      <div className="orb" style={{ bottom: '4%', left: '14%', width: '36vw', height: '36vw', background: 'radial-gradient(circle, rgba(34,211,238,0.48), transparent 68%)', animation: 'drift-b 20s ease-in-out infinite' }} />

      {/* 2. Сеть Vanta поверх (прозрачный холст) */}
      <div ref={ref} className="absolute inset-0" style={{ opacity: 1 }} />

      {/* 3. Совсем лёгкая вуаль (чтобы текст вне карточек читался), карточки стеклянные */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(140% 120% at 50% 40%, rgba(245,245,247,0.04), rgba(245,245,247,0.30))' }} />
    </div>
  )
}

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
          color: 0x5e5ce6,           // линии/точки — индиго
          backgroundColor: 0xf5f5f7,
          backgroundAlpha: 0,        // прозрачный холст → видно орбы под ним
          points: 11,
          maxDistance: 23,
          spacing: 16,
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
      {/* 1. Анимированные орбы (всегда видны) */}
      <div className="orb" style={{ top: '-12%', left: '-6%', width: '52vw', height: '52vw', background: 'radial-gradient(circle, rgba(0,113,227,0.45), transparent 68%)', animation: 'drift-a 20s ease-in-out infinite' }} />
      <div className="orb" style={{ bottom: '-16%', right: '-8%', width: '50vw', height: '50vw', background: 'radial-gradient(circle, rgba(94,92,230,0.42), transparent 68%)', animation: 'drift-b 24s ease-in-out infinite' }} />
      <div className="orb" style={{ top: '30%', right: '12%', width: '32vw', height: '32vw', background: 'radial-gradient(circle, rgba(255,95,162,0.30), transparent 70%)', animation: 'drift-a 28s ease-in-out infinite reverse' }} />
      <div className="orb" style={{ bottom: '8%', left: '18%', width: '30vw', height: '30vw', background: 'radial-gradient(circle, rgba(34,211,238,0.28), transparent 70%)', animation: 'drift-b 22s ease-in-out infinite' }} />

      {/* 2. Сеть Vanta поверх (прозрачный холст) */}
      <div ref={ref} className="absolute inset-0" style={{ opacity: 0.9 }} />

      {/* 3. Лёгкая вуаль для читаемости */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(245,245,247,0.10), rgba(245,245,247,0.42))' }} />
    </div>
  )
}

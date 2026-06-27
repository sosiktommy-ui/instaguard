'use client'

import { useEffect, useRef } from 'react'

/**
 * Живой 3D-фон (Vanta NET) — сеть связанных точек в фирменных цветах.
 * Тематически совпадает с логотипом (связанные аккаунты). Монтируется только на клиенте.
 */
export default function VantaBackground() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let effect: any = null
    let cancelled = false

    // Уважаем системную настройку «меньше движения»
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    ;(async () => {
      try {
        const THREE = await import('three')
        const NET = (await import('vanta/dist/vanta.net.min')).default
        if (cancelled || !ref.current) return
        effect = NET({
          el: ref.current,
          THREE,
          mouseControls: false,
          touchControls: false,
          gyroControls: false,
          minHeight: 200,
          minWidth: 200,
          scale: 1,
          scaleMobile: 1,
          color: 0x5e5ce6,            // линии/точки — индиго/брендовый
          backgroundColor: 0xf5f5f7,  // совпадает с canvas
          points: 10,
          maxDistance: 21,
          spacing: 18,
          showDots: true,
        })
      } catch (e) {
        // если WebGL недоступен — просто без фона, не падаем
        console.warn('[vanta] init failed:', e)
      }
    })()

    return () => { cancelled = true; if (effect?.destroy) effect.destroy() }
  }, [])

  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <div ref={ref} className="absolute inset-0 opacity-[0.55]" />
      {/* мягкая вуаль, чтобы контент читался поверх сети */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(120% 90% at 50% 0%, rgba(245,245,247,0.35), rgba(245,245,247,0.78) 70%)',
      }} />
    </div>
  )
}

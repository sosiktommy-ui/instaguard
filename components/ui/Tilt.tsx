'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Лёгкий 3D-наклон карточки вслед за курсором (параллакс). План §13.12.
 *
 * Деликатно и безопасно:
 *  - малый угол (по умолчанию 6°, ≤ 8°), плавный возврат при уходе курсора;
 *  - уважает prefers-reduced-motion (наклон выключен);
 *  - выключен на тач-устройствах / без тонкого указателя (hover:none) — там наклона нет;
 *  - это лишь transform на ВНЕШНЕЙ обёртке, поэтому клики, тултипы и «проваливание»
 *    внутрь карточки продолжают работать; собственный hover-lift `.card-3d` сохраняется.
 *
 * SSR-safe: на сервере и в первом клиентском рендере — проходная обёртка (совпадает),
 * наклон включается эффектом только на десктопе без reduced-motion.
 */
export function Tilt({
  children,
  className,
  max = 6,
}: {
  children: React.ReactNode
  className?: string
  max?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const raf = useRef<number | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [t, setT] = useState<{ rx: number; ry: number; active: boolean }>({ rx: 0, ry: 0, active: false })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setEnabled(fine.matches && !reduce.matches)
    update()
    fine.addEventListener?.('change', update)
    reduce.addEventListener?.('change', update)
    return () => {
      fine.removeEventListener?.('change', update)
      reduce.removeEventListener?.('change', update)
    }
  }, [])

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const px = (e.clientX - r.left) / r.width // 0..1 по ширине
      const py = (e.clientY - r.top) / r.height // 0..1 по высоте
      const ry = (px - 0.5) * 2 * max // курсор справа → поворот вправо
      const rx = -(py - 0.5) * 2 * max // курсор ниже → наклон «от себя»
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = requestAnimationFrame(() => setT({ rx, ry, active: true }))
    },
    [enabled, max],
  )

  const onLeave = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    setT({ rx: 0, ry: 0, active: false })
  }, [])

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current) }, [])

  // Тач / reduced-motion / SSR — проходная обёртка без наклона.
  if (!enabled) return <div className={cn(className)}>{children}</div>

  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={cn(className)} style={{ perspective: 900 }}>
      <div
        style={{
          transform: `rotateX(${t.rx}deg) rotateY(${t.ry}deg)`,
          transformStyle: 'preserve-3d',
          transition: t.active
            ? 'transform 0.08s ease-out'
            : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  )
}

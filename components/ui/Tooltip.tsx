'use client'

import { useState, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TipState { x: number; y: number; placement: 'top' | 'bottom' }

/**
 * Лёгкий тултип на портале (не обрезается overflow-hidden родителями).
 * Появляется при наведении, тёмный «стеклянный» пузырь со стрелкой.
 */
export function Tooltip({
  content, children, maxWidth = 240, className = 'inline-flex',
}: {
  content: ReactNode
  children: ReactNode
  maxWidth?: number
  className?: string
}) {
  const [tip, setTip] = useState<TipState | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  const show = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const placement: 'top' | 'bottom' = r.top < 90 ? 'bottom' : 'top'
    setTip({
      x: r.left + r.width / 2,
      y: placement === 'top' ? r.top - 10 : r.bottom + 10,
      placement,
    })
  }, [])
  const hide = useCallback(() => setTip(null), [])

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className={className}
    >
      {children}
      {tip && typeof document !== 'undefined' && createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[200] animate-tip"
          style={{
            left: tip.x,
            top: tip.y,
            transform: `translate(-50%, ${tip.placement === 'top' ? '-100%' : '0'})`,
            maxWidth,
          }}
        >
          <div
            className="relative rounded-xl px-3 py-2 text-[11.5px] leading-snug font-medium text-white text-center"
            style={{
              background: 'linear-gradient(165deg, rgba(40,40,48,0.96), rgba(20,20,26,0.96))',
              boxShadow: '0 8px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {content}
            <span
              className="absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45"
              style={{
                background: tip.placement === 'top' ? 'rgba(20,20,26,0.96)' : 'rgba(40,40,48,0.96)',
                [tip.placement === 'top' ? 'bottom' : 'top']: -4,
                borderRight: '1px solid rgba(255,255,255,0.08)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              } as any}
            />
          </div>
        </div>,
        document.body
      )}
    </span>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { IconTile } from '@/components/common/IconTile'
import { Hint } from '@/components/common/Hint'

// Плавный счётчик цифр (только для числовых значений)
function useCountUp(value: number, dur = 900) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    let start: number | null = null
    const tick = (ts: number) => {
      if (start === null) start = ts
      const p = Math.min(1, (ts - start) / dur)
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, dur])
  return n
}

/**
 * Объёмная карточка-метрика — единый вид для «Статистики», «Прокси» и главной.
 * Числа плавно набегают; строковые значения (например «1.2K») показываются как есть.
 */
export function StatCard({ icon, color, value, label, tip, delay = 0 }: {
  icon: any; color: string; value: number | string; label: string; tip?: string; delay?: number
}) {
  const isNum = typeof value === 'number'
  const n = useCountUp(isNum ? value : 0)
  const display = isNum ? n.toLocaleString('ru') : value
  return (
    <div className="card card-3d gloss rise px-5 py-4 flex items-center gap-3 relative overflow-hidden" style={{ animationDelay: `${delay}ms` }}>
      {tip && <div className="absolute right-3 top-3 z-10"><Hint text={tip} /></div>}
      <IconTile icon={icon} color={color} size={44} />
      <div className="min-w-0">
        <div className="text-[24px] font-semibold tracking-tighter leading-none tabular-nums">{display}</div>
        <div className="text-[12px] text-subt mt-1">{label}</div>
      </div>
    </div>
  )
}

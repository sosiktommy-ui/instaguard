'use client'

import { ShieldCheck } from 'lucide-react'
import { securityIndex } from '@/lib/safety'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

interface AccLike { status?: string | null; errorCount?: number | null; limits?: unknown; proxy?: string | null }

// Флагманский бейдж «Индекс безопасности». size='lg' — с подписью и /100.
export function SecurityBadge({ acc, size = 'sm', className }: { acc: AccLike; size?: 'sm' | 'lg'; className?: string }) {
  const s = securityIndex(acc)
  const tip = `Индекс безопасности ${s.score}/100 — насколько аккаунт защищён от бана. `
    + (s.reasons.length ? `Снижают: ${s.reasons.join('; ')}.` : 'Всё в порядке.')
  return (
    <Tooltip content={tip} className={className}>
      <span
        className={cn('inline-flex items-center gap-1 rounded-lg font-semibold cursor-help', size === 'lg' ? 'px-2.5 py-1 text-[13px]' : 'px-2 py-0.5 text-[11px]')}
        style={{ background: hexA(s.color, 0.12), color: s.color }}
      >
        <ShieldCheck className={size === 'lg' ? 'w-4 h-4' : 'w-3 h-3'} />
        {s.score}{size === 'lg' && <span className="font-normal opacity-80">/100 · {s.label}</span>}
      </span>
    </Tooltip>
  )
}

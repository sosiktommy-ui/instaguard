'use client'

import { ShieldCheck, Check, Minus } from 'lucide-react'
import { securityIndex } from '@/lib/safety'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

interface AccLike {
  status?: string | null
  errorCount?: number | null
  limits?: unknown
  proxy?: string | null
  hasSession?: boolean | null
  lastChecked?: string | Date | null
  createdAt?: string | Date | null
  role?: string | null
}

interface SecCtx { draftCount?: number; allowNoDrafts?: boolean; totalFires?: number }

// Флагманский бейдж «Индекс безопасности». size='lg' — с подписью и /100.
// При наведении — разбор по факторам (что снижает счёт, что в порядке), не просто число.
// ctx — глобальные данные владельца (сколько черновых, разрешён ли парсинг без них).
export function SecurityBadge({ acc, ctx, size = 'sm', className }: { acc: AccLike; ctx?: SecCtx; size?: 'sm' | 'lg'; className?: string }) {
  const s = securityIndex(acc, ctx)
  const tip = (
    <div className="text-left">
      <div className="font-semibold text-[12.5px] mb-1.5 text-center">Индекс безопасности {s.score}/100 · {s.label}</div>
      <div className="space-y-1">
        {s.factors.map((f, i) => (
          <div key={i} className="flex items-start gap-1.5">
            {f.ok
              ? <Check className="w-3 h-3 text-ok shrink-0 mt-0.5" />
              : <Minus className="w-3 h-3 text-bad shrink-0 mt-0.5" />}
            <span className="flex-1 text-[11.5px] leading-snug">{f.label}</span>
            {!f.ok && <span className="text-[11px] font-semibold text-bad shrink-0">−{f.delta}</span>}
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <Tooltip content={tip} maxWidth={280} className={className}>
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

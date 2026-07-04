'use client'

import { ReactNode } from 'react'
import { IconTile } from '@/components/common/IconTile'

/**
 * Единая шапка страницы для всех вкладок: объёмная иконка + заголовок + подзаголовок,
 * справа — слот под кнопки/действия. Гарантирует одинаковый вид от вкладки к вкладке.
 */
export function PageHeader({ icon, color = '#663af1', title, subtitle, tourId, children }: {
  icon: any; color?: string; title: string; subtitle?: string; tourId?: string; children?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3.5 min-w-0">
        <IconTile icon={icon} color={color} size={48} />
        <div className="min-w-0">
          <h1 data-tour={tourId} className="text-[26px] font-semibold tracking-tighter leading-none">{title}</h1>
          {subtitle && <p className="text-subt mt-1.5 text-[14px]">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  )
}

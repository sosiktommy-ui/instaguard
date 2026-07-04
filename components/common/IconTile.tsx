'use client'

import { hexA, darken } from '@/lib/colors'
import { cn } from '@/lib/utils'

/**
 * Объёмная 3D-иконка-плитка — единый элемент для шапок, статистики и строк настроек.
 * Градиент + мягкая цветная тень + внутренние блики дают «выпуклый» вид.
 */
export function IconTile({ icon: Icon, color = '#663af1', size = 44, className }: {
  icon: any; color?: string; size?: number; className?: string
}) {
  const inner = Math.round(size * 0.46)
  return (
    <div
      className={cn('rounded-2xl flex items-center justify-center shrink-0', className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, ${color}, ${darken(color)})`,
        boxShadow: `0 5px 16px ${hexA(color, 0.45)}, inset 0 1.5px 1px rgba(255,255,255,0.5), inset 0 -2px 4px ${hexA(darken(color, 0.6), 0.5)}`,
      }}
    >
      <Icon style={{ width: inner, height: inner }} className="text-white" />
    </div>
  )
}

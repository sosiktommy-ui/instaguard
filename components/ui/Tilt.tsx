'use client'

import { cn } from '@/lib/utils'

/**
 * Ранее — наклон карточки за курсором. По плану H1 («успокоить эффекты») наклон убран:
 * теперь это простая проходная обёртка, чтобы не трогать все места использования.
 */
export function Tilt({ children, className }: { children: React.ReactNode; className?: string; max?: number }) {
  return <div className={cn(className)}>{children}</div>
}

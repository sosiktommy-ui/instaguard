'use client'

import { HelpCircle } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'

// Маленький серый «?» с пояснением по наведению — для непонятных с виду терминов/значений.
export function Hint({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <HelpCircle className="w-3.5 h-3.5 text-subt/60 hover:text-brand transition-colors cursor-help" />
    </Tooltip>
  )
}

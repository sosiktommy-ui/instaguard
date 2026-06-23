'use client'

import { useEffect } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToastProps {
  message: string
  type: 'success' | 'error' | 'info'
  onClose: () => void
}

const CONFIG = {
  success: { icon: CheckCircle, bg: 'bg-emerald-600' },
  error:   { icon: AlertCircle, bg: 'bg-red-600' },
  info:    { icon: Info,        bg: 'bg-zinc-700' },
}

export default function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [onClose])

  const { icon: Icon, bg } = CONFIG[type]

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 text-white rounded-2xl px-6 py-4',
        'flex items-center gap-4 shadow-2xl z-[9999] min-w-[320px] max-w-sm',
        'animate-in slide-in-from-bottom-4 fade-in duration-300',
        bg
      )}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
        <X size={18} />
      </button>
    </div>
  )
}

// Хук для использования Toast в компонентах
export function useToast() {
  // Простая глобальная реализация через событие
  const show = (message: string, type: ToastProps['type'] = 'info') => {
    window.dispatchEvent(new CustomEvent('instaguard:toast', { detail: { message, type } }))
  }
  return { success: (m: string) => show(m, 'success'), error: (m: string) => show(m, 'error'), info: show }
}

import * as React from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'ghost'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-2xl font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:pointer-events-none disabled:opacity-50',
          {
            default:   'bg-white text-black hover:bg-zinc-200',
            secondary: 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-700',
            ghost:     'hover:bg-zinc-900',
          }[variant],
          {
            default: 'h-11 px-6',
            sm:      'h-8 px-3 text-sm',
            lg:      'h-14 px-8 text-lg',
            icon:    'h-10 w-10',
          }[size],
          className
        )}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'

export { Button }

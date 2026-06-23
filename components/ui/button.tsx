import * as React from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'default' | 'sm' | 'lg' | 'icon'
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-all duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/20 disabled:pointer-events-none disabled:opacity-40',
          {
            primary: 'bg-brand text-white hover:bg-brand-hover shadow-sm',
            secondary: 'bg-black/[0.05] text-ink hover:bg-black/[0.08]',
            ghost: 'text-subt hover:bg-black/[0.05] hover:text-ink',
            danger: 'bg-bad/10 text-bad hover:bg-bad/15',
          }[variant],
          {
            default: 'h-10 px-5 text-[15px]',
            sm: 'h-8 px-3.5 text-sm',
            lg: 'h-12 px-7 text-base',
            icon: 'h-10 w-10 rounded-2xl',
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

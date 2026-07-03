/**
 * Логотип ReactiveGram — фирменная иконка «R» из /public/Foto/reactive.png.
 * detailed не влияет на изображение (оставлен для совместимости вызовов).
 */
export function AppLogo({ size = 38, detailed = false, className }: { size?: number; detailed?: boolean; className?: string }) {
  return (
    <img
      src="/Foto/reactive.png"
      alt="ReactiveGram"
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: size * 0.24, display: 'block' }}
      draggable={false}
    />
  )
}

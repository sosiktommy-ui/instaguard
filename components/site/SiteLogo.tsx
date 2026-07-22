/* Фирменный знак ReactiveGram — ТОТ ЖЕ логотип, что в приложении (/public/Foto/reactive.png). */
export function SiteLogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/Foto/reactive.png"
      alt=""
      aria-hidden="true"
      width={34}
      height={34}
      className={className}
      style={{ borderRadius: 9, display: 'block' }}
      draggable={false}
    />
  )
}

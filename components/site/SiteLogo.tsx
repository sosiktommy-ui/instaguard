// Векторный знак ReactiveGram: «искра-отклик» в фиолетовом градиенте (crisp на любом экране).
export function SiteLogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="rgLogo" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9b6bff" />
          <stop offset="1" stopColor="#6a7df9" />
        </linearGradient>
      </defs>
      {/* скруглённый квадрат-«пузырь диалога» */}
      <rect x="3" y="3" width="34" height="34" rx="11" stroke="url(#rgLogo)" strokeWidth="2.4" />
      {/* молния-отклик */}
      <path d="M22.5 10L14 21.5h5.5L17.5 30 26 18.5h-5.5L22.5 10Z" fill="url(#rgLogo)" />
    </svg>
  )
}

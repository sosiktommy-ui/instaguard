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
      {/* фирменный знак «R» в фиолетовом скруглённом квадрате (единый бренд-марк с приложением) */}
      <rect x="3" y="3" width="34" height="34" rx="11" fill="url(#rgLogo)" />
      <text x="20" y="21" textAnchor="middle" dominantBaseline="central"
        fontFamily="Inter, system-ui, -apple-system, sans-serif" fontSize="22" fontWeight="800" fill="#fff">R</text>
    </svg>
  )
}

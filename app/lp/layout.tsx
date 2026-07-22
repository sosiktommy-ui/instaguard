import type { Metadata } from 'next'
import './site.css'
import './sections.css'

export const metadata: Metadata = {
  title: 'ReactiveGram — автоответы и вовлечение в Instagram 24/7',
  description:
    'Автоматические ответы новым подписчикам, на комментарии и сторис. Превращайте активность аудитории в клиентов — 24/7, без ручной рутины.',
}

// Публичный сайт ReactiveGram — светлая premium-тема (изолирована от дашборда).
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Inter (с кириллицей) — гротеск как в референсе, но для русского текста */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
      />
      <div className="rg-site">{children}</div>
    </>
  )
}

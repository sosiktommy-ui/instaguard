import { SiteNav } from '@/components/site/SiteNav'
import { Pricing } from '@/components/site/Pricing'
import { SiteFooter } from '@/components/site/sections'

export const metadata = {
  title: 'Тарифы и оплата — ReactiveGram',
  description: 'Выберите тариф ReactiveGram по числу Instagram-аккаунтов. Помесячно или за год со скидкой.',
}

// Отдельная страница тарифов + оплаты (сюда ведёт «Начать сейчас»). Индикатор шага — «где ты сейчас».
export default function PricingPage() {
  return (
    <>
      <SiteNav solid />
      <main>
        <div className="rg-container" style={{ paddingTop: 'clamp(28px, 5vw, 44px)' }}>
          <div className="rg-stepsbar">
            <span className="rg-step-pill on"><span className="num">1</span> Тариф</span>
            <span className="rg-step-sep" />
            <span className="rg-step-pill"><span className="num">2</span> Оплата</span>
            <span className="rg-step-sep" />
            <span className="rg-step-pill"><span className="num">3</span> Доступ</span>
          </div>
        </div>
        <Pricing />
      </main>
      <SiteFooter />
    </>
  )
}

'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'

const FAQ = [
  { q: 'Это безопасно для моего аккаунта?', a: 'Да. Сервис действует аккуратно и в спокойном, человеческом темпе, с учётом ограничений Instagram. Вы в любой момент можете поставить всё на паузу или выключить.' },
  { q: 'Нужно ли давать пароль от Instagram?', a: 'Подключение проходит безопасно, а доступ можно отозвать в любой момент. Вы полностью контролируете, что и когда происходит.' },
  { q: 'Можно остановить в любой момент?', a: 'Да. Включение и выключение автоматизации — в один клик, без потери настроек и сценариев.' },
  { q: 'Работает с личным или бизнес-аккаунтом?', a: 'И с тем, и с другим. Настройка одинаково простая для личного, экспертного и бизнес-аккаунта.' },
  { q: 'Помогаете с настройкой?', a: 'Да, поможем запуститься и подскажем готовые сценарии под вашу нишу — блог, услуги или магазин.' },
  { q: 'Как происходит оплата?', a: 'Оплата картой — помесячно или за год со скидкой. Без скрытых условий, отмена в любой момент.' },
]

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="rg-section">
      <div className="rg-container">
        <div className="rg-section-head">
          <span className="rg-eyebrow">Вопросы</span>
          <h2 className="rg-h2">Частые вопросы</h2>
        </div>
        <div className="rg-faq">
          {FAQ.map((item, i) => {
            const isOpen = open === i
            return (
              <div key={item.q} className="rg-faq-item">
                <button className="rg-faq-q" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)}>
                  {item.q}
                  <Plus size={20} strokeWidth={2.5} />
                </button>
                <div className={`rg-faq-a${isOpen ? ' open' : ''}`}>
                  <p>{item.a}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

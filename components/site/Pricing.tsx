'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, X } from 'lucide-react'
import { PLANS, planMonthly, formatPrice, type BillingCycle } from '@/lib/plans'

// Только платные тарифы (без Free, без пробного периода — по решению владельца).
const PAID = PLANS.filter((p) => p.id !== 'free')

export function Pricing() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly')

  return (
    <section id="pricing" className="rg-section rg-section-alt">
      <div className="rg-container">
        <div className="rg-section-head">
          <span className="rg-eyebrow">Тарифы</span>
          <h2 className="rg-h2">Простые тарифы — платите за результат</h2>
          <p className="rg-lead">Цена зависит от числа Instagram-аккаунтов. Чем больше аккаунтов — тем дешевле каждый.</p>
          <div className="rg-toggle" role="group" aria-label="Период оплаты">
            <button className={cycle === 'monthly' ? 'on' : ''} onClick={() => setCycle('monthly')}>Помесячно</button>
            <button className={cycle === 'yearly' ? 'on' : ''} onClick={() => setCycle('yearly')}>За год <span className="save">−20%</span></button>
          </div>
        </div>

        <div className="rg-price-grid">
          {PAID.map((p) => {
            const price = planMonthly(p, cycle)
            const cta = p.contact ? 'Связаться' : 'Оформить доступ'
            return (
              <div key={p.id} className={`rg-price${p.recommended ? ' pop' : ''}`}>
                {p.recommended && <span className="rg-price-pop-badge">Популярный</span>}
                <div className="rg-price-name">{p.name}</div>
                <div className="rg-price-tag">{p.tagline}</div>

                <div className="rg-price-amt">
                  {p.priceFrom && <span>от</span>}
                  <b>{formatPrice(price)}</b>
                  <span>/{p.perAccount ? 'аккаунт · мес' : 'мес'}</span>
                </div>
                <div className="rg-price-acc">{p.accountsLabel}{cycle === 'yearly' ? ' · при оплате за год' : ''}</div>

                <ul className="rg-price-feats">
                  {p.features.map((f) => (
                    <li key={f.text}>
                      {f.included
                        ? <Check className="yes" size={18} strokeWidth={2.5} />
                        : <X className="no" size={18} strokeWidth={2.5} />}
                      <span className={f.included ? '' : 'no'}>{f.text}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={p.contact ? '#' : '/register'}
                  className={`rg-btn ${p.recommended ? 'rg-btn-primary' : 'rg-btn-light'} rg-btn-lg`}
                  style={{ minWidth: 0, width: '100%' }}
                >
                  {cta}
                </Link>
                {p.note && <p className="rg-price-note">{p.note}</p>}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

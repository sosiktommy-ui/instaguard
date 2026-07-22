'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, X } from 'lucide-react'
import { PLANS, planMonthly, formatPrice, BYOP_DISCOUNT, type BillingCycle } from '@/lib/plans'

// Только платные тарифы (без Free, без пробного периода — по решению владельца).
const PAID = PLANS.filter((p) => p.id !== 'free')

export function Pricing() {
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [byop, setByop] = useState(false)   // «свой прокси» — дешевле на €10/аккаунт (мы прокси не выдаём)

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
          {/* Дешевле со своим прокси (BYOP) — мы не выдаём прокси, цена ниже на €10/аккаунт */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 14, cursor: 'pointer', fontSize: 14.5, color: 'var(--rg-text)', userSelect: 'none' }}>
            <input type="checkbox" checked={byop} onChange={(e) => setByop(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: '#663af1', cursor: 'pointer' }} />
            <span>Со своим прокси (BYOP) — дешевле на <b>{formatPrice(BYOP_DISCOUNT)}</b>/аккаунт</span>
          </label>
        </div>

        <div className="rg-price-grid">
          {PAID.map((p) => {
            const base = planMonthly(p, cycle)
            // Со своим прокси — минус €10/аккаунт (только у платных per-account тарифов).
            const price = byop && p.perAccount ? Math.max(0, base - BYOP_DISCOUNT) : base
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
                <div className="rg-price-acc">{p.accountsLabel}{cycle === 'yearly' ? ' · при оплате за год' : ''}{byop && p.perAccount ? ' · свой прокси' : ''}</div>

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

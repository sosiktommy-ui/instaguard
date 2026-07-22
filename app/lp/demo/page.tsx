import Link from 'next/link'
import { PlayCircle, ArrowRightCircle } from 'lucide-react'
import { SiteNav } from '@/components/site/SiteNav'
import { DemoTour } from '@/components/site/DemoTour'
import { SiteFooter } from '@/components/site/sections'

export const metadata = {
  title: 'Демо — ReactiveGram',
  description: 'Посмотрите, как выглядит ReactiveGram. Реальные действия — после подключения аккаунта.',
}

export default function DemoPage() {
  return (
    <>
      <SiteNav solid />
      <main>
        <section className="rg-section" style={{ paddingTop: 'clamp(104px, 12vw, 128px)' }}>
          <div className="rg-container">
            <div className="rg-page-head">
              <span className="rg-demo-badge"><PlayCircle size={15} /> Демо-режим</span>
              <h1 className="rg-h2" style={{ fontSize: 'clamp(1.8rem,4.5vw,2.8rem)' }}>Посмотрите, как это работает</h1>
              <p className="rg-lead" style={{ maxWidth: 620, margin: '14px auto 0' }}>
                Пройдите короткий тур по интерфейсу. Здесь ничего не отправляется — реальные ответы
                начнутся после подключения вашего аккаунта.
              </p>
            </div>

            <DemoTour />

            <div className="rg-center rg-mt">
              <Link href="/register" className="rg-btn rg-btn-primary rg-btn-lg">
                Запустить на своём аккаунте <ArrowRightCircle size={20} />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}

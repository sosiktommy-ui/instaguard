import { SiteNav } from '@/components/site/SiteNav'
import { Hero } from '@/components/site/Hero'
import { TrustBar, Features, HowItWorks, UseCases, FinalCta, SiteFooter } from '@/components/site/sections'
import { Pricing } from '@/components/site/Pricing'
import { Faq } from '@/components/site/Faq'

// Публичный лендинг ReactiveGram (превью-маршрут /lp; финальный свап на «/» — этап S7 plansite.md).
export default function LandingPage() {
  return (
    <>
      <SiteNav />
      <main>
        <Hero />
        <TrustBar />
        <Features />
        <HowItWorks />
        <UseCases />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  )
}

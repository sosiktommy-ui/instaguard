import TopNav from '@/components/common/TopNav'
import SimulationProvider from '@/components/common/SimulationProvider'
import { BreadcrumbProvider } from '@/lib/breadcrumbs'
import { OnboardingTour } from '@/components/common/OnboardingTour'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-canvas">
      <SimulationProvider />
      <BreadcrumbProvider>
        <div className="relative z-10">
          <TopNav />
          <main className="px-8 py-7 max-w-[1400px] mx-auto animate-fade-in">{children}</main>
          {/* ВРЕМЕННО (тест) — удалить: ссылка на телеграм-канал для проверки */}
          <footer className="px-8 pb-8 max-w-[1400px] mx-auto text-center text-[12px] text-subt">
            <a href="https://telegram.me/impreza_events" target="_blank" rel="noopener noreferrer"
              className="hover:text-brand transition-colors">Наш канал: telegram.me/impreza_events</a>
          </footer>
          {/* /ВРЕМЕННО */}
        </div>
      </BreadcrumbProvider>
      <OnboardingTour />
    </div>
  )
}

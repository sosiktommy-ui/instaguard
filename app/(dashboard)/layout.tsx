import TopNav from '@/components/common/TopNav'
import SimulationProvider from '@/components/common/SimulationProvider'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-canvas">
      <div className="aurora" aria-hidden />
      <SimulationProvider />
      <div className="relative z-10">
        <TopNav />
        <main className="px-8 py-7 max-w-[1400px] mx-auto animate-fade-in">{children}</main>
      </div>
    </div>
  )
}

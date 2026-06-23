import TopNav from '@/components/common/TopNav'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <TopNav />
      <main className="px-8 py-7 max-w-[1400px] mx-auto animate-fade-in">{children}</main>
    </div>
  )
}

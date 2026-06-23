import Sidebar from '@/components/common/Sidebar'
import Header from '@/components/common/Header'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-zinc-950 text-white">
      <Sidebar />
      <div className="flex-1 ml-72">
        <Header />
        <main className="p-10 pt-8">{children}</main>
      </div>
    </div>
  )
}

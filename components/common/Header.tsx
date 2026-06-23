'use client'

export default function Header() {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-xl h-20 flex items-center px-10 z-50">
      <div className="flex-1" />
      <div className="flex items-center gap-6">
        <div className="bg-zinc-900 px-4 py-2 rounded-2xl text-sm flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          Все системы активны
        </div>
        <div className="text-sm text-zinc-500">23 июня 2026</div>
      </div>
    </header>
  )
}

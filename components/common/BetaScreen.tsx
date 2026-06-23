'use client'

import { Construction } from 'lucide-react'

export default function BetaScreen({ title, desc, features }: { title: string; desc: string; features?: string[] }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 max-w-lg mx-auto">
      <div className="w-16 h-16 rounded-3xl bg-warn/10 flex items-center justify-center mb-6">
        <Construction className="w-8 h-8 text-warn" />
      </div>
      <div className="flex items-center gap-2 mb-2">
        <h1 className="text-[26px] font-semibold tracking-tighter">{title}</h1>
        <span className="text-[11px] font-bold px-2 py-1 rounded-md bg-warn/15 text-warn">BETA</span>
      </div>
      <p className="text-subt text-[15px] leading-relaxed">{desc}</p>
      {features && (
        <div className="card p-6 mt-8 w-full text-left">
          <div className="text-[12px] font-semibold text-subt uppercase tracking-wider mb-3">Скоро будет доступно</div>
          <ul className="space-y-2.5">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-3 text-[14px] text-ink/80">
                <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Zap, X, Send, Trash2, ChevronUp } from 'lucide-react'
import { Toggle } from '@/components/ui/Toggle'
import {
  useStore, TRIGGER_LABELS, triggerIsActive, formatFollowers,
} from '@/lib/store'
import { cn } from '@/lib/utils'

export default function ActiveTriggersDock() {
  const triggers = useStore((s) => s.triggers)
  const accounts = useStore((s) => s.accounts)
  const toggleTriggerAccount = useStore((s) => s.toggleTriggerAccount)
  const setTriggerAccountsActive = useStore((s) => s.setTriggerAccountsActive)
  const removeTrigger = useStore((s) => s.removeTrigger)
  const [open, setOpen] = useState(false)

  const acc = (id: string) => accounts.find((a) => a.id === id)
  // total active account-trigger pairs
  const activePairs = triggers.reduce((s, t) => s + t.accounts.filter((a) => a.active).length, 0)

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 pl-4 pr-5 h-12 rounded-full bg-ink text-white shadow-xl shadow-black/20 hover:scale-[1.03] active:scale-95 transition-transform"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-70 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ok" />
        </span>
        <span className="text-[14px] font-semibold">Активные триггеры</span>
        <span className="text-[12px] font-bold px-2 py-0.5 rounded-full bg-white/15">{activePairs}</span>
        <ChevronUp className="w-4 h-4 opacity-70" />
      </button>

      {/* Bottom sheet */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
          <div
            className="relative bg-canvas rounded-t-[28px] shadow-2xl max-h-[82vh] flex flex-col"
            style={{ animation: 'sheet-up 0.35s cubic-bezier(0.16,1,0.3,1)' }}
          >
            {/* Grabber + header */}
            <div className="shrink-0 px-7 pt-3 pb-4 border-b border-black/[0.06]">
              <div className="w-10 h-1.5 rounded-full bg-black/15 mx-auto mb-4" />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-ink/5 flex items-center justify-center">
                    <Zap className="w-[18px] h-[18px] text-ink" fill="currentColor" />
                  </div>
                  <div>
                    <div className="font-semibold text-[18px] tracking-tight">Активные триггеры</div>
                    <div className="text-[12px] text-subt">{activePairs} активных правил на аккаунтах</div>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="text-subt hover:text-ink p-2"><X size={22} /></button>
              </div>
            </div>

            {/* List */}
            <div className="overflow-y-auto px-7 py-5 space-y-4">
              {triggers.length === 0 && (
                <div className="py-16 text-center text-subt text-[14px]">Триггеров пока нет</div>
              )}
              {triggers.map((t) => {
                const on = triggerIsActive(t)
                return (
                  <div key={t.id} className={cn('card-flat overflow-hidden', !on && 'opacity-70')}>
                    {/* Trigger header */}
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-black/[0.05] bg-black/[0.015]">
                      <span className={cn('w-2 h-2 rounded-full shrink-0', on ? 'bg-ok' : 'bg-black/20')} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[15px] truncate">{t.name}</div>
                        <div className="flex items-center gap-2 text-[12px] text-subt mt-0.5">
                          <span className="px-2 py-0.5 rounded-full bg-brand/10 text-brand font-medium">{TRIGGER_LABELS[t.type]}</span>
                          <span>·</span>
                          <span>Ответ в директ</span>
                        </div>
                      </div>
                      <button
                        onClick={() => setTriggerAccountsActive(t.id, !on)}
                        className="text-[12px] font-medium text-brand hover:underline shrink-0"
                      >
                        {on ? 'Выключить все' : 'Включить все'}
                      </button>
                      <button onClick={() => removeTrigger(t.id)} className="text-subt hover:text-bad p-1 shrink-0"><Trash2 size={16} /></button>
                    </div>

                    {/* Message preview */}
                    <div className="px-5 py-3 flex items-start gap-2.5 text-[13px] text-ink/70 bg-white">
                      <Send className="w-4 h-4 text-subt shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{t.message}</span>
                    </div>

                    {/* Per-account rows */}
                    <div className="divide-y divide-black/[0.04]">
                      {t.accounts.map((ta) => {
                        const a = acc(ta.accountId)
                        if (!a) return null
                        return (
                          <div key={ta.accountId} className={cn('flex items-center gap-3 px-5 py-3 transition-colors', ta.active ? 'bg-white' : 'bg-black/[0.015]')}>
                            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold shrink-0">
                              {a.username[0].toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-[14px] truncate">@{a.username}</div>
                              <div className="text-[12px] text-subt">
                                {formatFollowers(a.followers)} · {TRIGGER_LABELS[t.type].toLowerCase()} · Ответ в директ
                              </div>
                            </div>
                            <div className="text-right shrink-0 hidden sm:block">
                              <div className="text-[13px] font-semibold tabular-nums">{ta.runs.toLocaleString('ru')}</div>
                              <div className="text-[11px] text-subt">ответов</div>
                            </div>
                            <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 hidden sm:inline',
                              ta.active ? 'bg-ok/10 text-ok' : 'bg-black/[0.05] text-subt')}>
                              {ta.active ? 'Работает' : 'Пауза'}
                            </span>
                            <Toggle checked={ta.active} onChange={() => toggleTriggerAccount(t.id, ta.accountId)} />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

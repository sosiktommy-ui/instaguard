'use client'

import { useState, useMemo } from 'react'
import { Zap, X, Send, Trash2, ChevronUp, ChevronRight, MessageSquare } from 'lucide-react'
import { Toggle } from '@/components/ui/Toggle'
import { useStore, TRIGGER_LABELS, triggerIsActive, formatFollowers } from '@/lib/store'
import { cn } from '@/lib/utils'

function DetailModal({ triggerId, accountId, onClose }: { triggerId: string; accountId: string; onClose: () => void }) {
  const responses = useStore((s) => s.responses)
  const accounts = useStore((s) => s.accounts)
  const triggers = useStore((s) => s.triggers)
  const acc = accounts.find((a) => a.id === accountId)
  const trig = triggers.find((t) => t.id === triggerId)
  const list = useMemo(
    () => responses.filter((r) => r.triggerId === triggerId && r.accountId === accountId),
    [responses, triggerId, accountId]
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[80vh] flex flex-col animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-6 py-5 border-b border-black/[0.06]">
          <span className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold">
            {acc?.username[0].toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[16px] truncate">@{acc?.username}</div>
            <div className="text-[12px] text-subt">{trig ? TRIGGER_LABELS[trig.type] : ''} · {list.length} ответов</div>
          </div>
          <button onClick={onClose} className="text-subt hover:text-ink p-1"><X size={22} /></button>
        </div>
        <div className="overflow-y-auto px-6 py-4 space-y-2.5">
          {list.length === 0 && (
            <div className="py-14 text-center text-subt text-[14px]">
              <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-40" />
              Пока нет ответов.<br />Когда триггер сработает — здесь появятся детали.
            </div>
          )}
          {list.map((r) => (
            <div key={r.id} className="flex items-start gap-3 p-3.5 rounded-2xl bg-canvas">
              <span className="w-2 h-2 rounded-full bg-ok mt-2 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="font-semibold">{r.target}</span>
                  <span className="text-subt">·</span>
                  <span className="text-subt">{new Date(r.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
                <div className="text-[13px] text-ink/70 mt-1 leading-relaxed">{r.message}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function ActiveTriggersDock() {
  const triggers = useStore((s) => s.triggers)
  const accounts = useStore((s) => s.accounts)
  const responses = useStore((s) => s.responses)
  const toggleTriggerAccount = useStore((s) => s.toggleTriggerAccount)
  const setTriggerAccountsActive = useStore((s) => s.setTriggerAccountsActive)
  const removeTrigger = useStore((s) => s.removeTrigger)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<{ triggerId: string; accountId: string } | null>(null)

  const acc = (id: string) => accounts.find((a) => a.id === id)
  const activePairs = triggers.reduce((s, t) => s + t.accounts.filter((a) => a.active).length, 0)
  const lastResponseAt = (triggerId: string, accountId: string) =>
    responses.find((r) => r.triggerId === triggerId && r.accountId === accountId)?.timestamp

  if (triggers.length === 0) return null

  return (
    <>
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

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
          <div className="relative bg-canvas rounded-t-[28px] shadow-2xl max-h-[82vh] flex flex-col" style={{ animation: 'sheet-up 0.35s cubic-bezier(0.16,1,0.3,1)' }}>
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

            <div className="overflow-y-auto px-7 py-5 space-y-4">
              {triggers.map((t) => {
                const on = triggerIsActive(t)
                return (
                  <div key={t.id} className={cn('card-flat overflow-hidden', !on && 'opacity-70')}>
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
                      <button onClick={() => setTriggerAccountsActive(t.id, !on)} className="text-[12px] font-medium text-brand hover:underline shrink-0">
                        {on ? 'Выключить все' : 'Включить все'}
                      </button>
                      <button onClick={() => removeTrigger(t.id)} className="text-subt hover:text-bad p-1 shrink-0"><Trash2 size={16} /></button>
                    </div>

                    <div className="px-5 py-3 flex items-start gap-2.5 text-[13px] text-ink/70 bg-white">
                      <Send className="w-4 h-4 text-subt shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{t.message}</span>
                    </div>

                    <div className="divide-y divide-black/[0.04]">
                      {t.accounts.map((ta) => {
                        const a = acc(ta.accountId)
                        if (!a) return null
                        const last = lastResponseAt(t.id, ta.accountId)
                        return (
                          <div key={ta.accountId} className={cn('flex items-center gap-3 px-5 py-3 transition-colors', ta.active ? 'bg-white' : 'bg-black/[0.015]')}>
                            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold shrink-0">
                              {a.username[0].toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-[14px] truncate">@{a.username}</div>
                              {/* clickable per-account stat */}
                              <button
                                onClick={() => setDetail({ triggerId: t.id, accountId: ta.accountId })}
                                className="group flex items-center gap-1.5 text-[12px] text-subt hover:text-brand transition-colors"
                              >
                                <span className="font-semibold text-ink group-hover:text-brand">{ta.runs.toLocaleString('ru')}</span> срабатываний
                                {last && <span className="text-subt">· {new Date(last).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>}
                                <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            </div>
                            <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 hidden sm:inline', ta.active ? 'bg-ok/10 text-ok' : 'bg-black/[0.05] text-subt')}>
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

      {detail && <DetailModal triggerId={detail.triggerId} accountId={detail.accountId} onClose={() => setDetail(null)} />}
    </>
  )
}

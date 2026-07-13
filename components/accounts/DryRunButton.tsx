'use client'
import { useState } from 'react'
import { FlaskConical, X, Loader2, Check, Minus, ShieldCheck, Globe, KeyRound, MousePointerClick } from 'lucide-react'
import { cn } from '@/lib/utils'

// §10.3/§10.4 «Полный тест» — кнопка на карточке аккаунта. Сквозная проверка готовности БЕЗ
// реальных действий: прокси жив, сессия жива, антидетект (0 сигналов), кнопки действий доступны.
// Безопасно на живых аккаунтах — ничего не отправляется/не лайкается/не подписывается.
type Checks = {
  proxy?: { ok?: boolean; ip?: string | null; country?: string | null; datacenter?: boolean | null; scheme?: string | null; error?: string }
  followers?: { count?: number | null; error?: string; note?: string }
  session?: { alive?: boolean; error?: string }
  antidetect?: { redCount?: number | null; red?: string[]; webrtcLeaks?: string[]; egressIp?: string | null; error?: string }
  actions?: Record<string, any>
}
type Report = { ok?: boolean; account?: string; target?: string; ready?: boolean; note?: string; error?: string; checks?: Checks }

const ACT_LABEL: Record<string, string> = { dm: 'Директ', follow: 'Подписка', like: 'Лайк', story: 'Сторис' }

function Row({ icon: Icon, label, good, warn, detail }: { icon: any; label: string; good: boolean; warn?: boolean; detail?: string }) {
  const color = good ? '#34c759' : warn ? '#ff9500' : '#ff3b30'
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2" style={{ background: `${color}14` }}>
      <Icon className="w-4 h-4 shrink-0" style={{ color }} />
      <span className="text-[13px] font-medium">{label}</span>
      <span className="ml-auto text-[12px] text-subt truncate max-w-[55%] text-right">{detail}</span>
    </div>
  )
}

export function DryRunButton({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Report | null>(null)
  const [target, setTarget] = useState('')

  async function run() {
    setLoading(true); setData(null)
    try {
      const res = await fetch('/api/dryrun', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, targetUsername: target.trim() || undefined }),
      })
      setData(await res.json().catch(() => ({ error: 'Ошибка ответа сервера' })))
    } catch (e: any) {
      setData({ error: String(e?.message ?? 'Ошибка сети') })
    } finally { setLoading(false) }
  }

  const c = data?.checks
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true) }} title="Полный тест аккаунта (без действий)"
        className="p-1.5 -m-1.5 rounded-lg text-subt hover:text-brand hover:bg-brand/[0.08] transition-colors shrink-0">
        <FlaskConical className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => { e.stopPropagation(); setOpen(false) }}>
          <div className="card w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="flex items-center gap-2"><FlaskConical className="w-5 h-5 text-brand" /><h3 className="font-semibold text-[15px]">Полный тест аккаунта</h3></div>
              <button onClick={() => setOpen(false)} className="p-1 -m-1 text-subt hover:text-ink"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[12px] text-subt mb-4 leading-relaxed">
              Проверяет <b>прокси · сессию · антидетект · доступность кнопок</b> действий. Ничего не
              отправляется и не нажимается — безопасно для аккаунта.
            </p>

            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="цель (username) — необязательно, возьмём подписчика"
              className="w-full px-3 py-2 rounded-xl border bg-transparent text-[13px] mb-3 outline-none focus:border-brand" />

            <button onClick={run} disabled={loading}
              className="w-full py-2.5 rounded-xl bg-brand text-white font-medium text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Тестирую… (до ~2 мин)</> : 'Запустить полный тест'}
            </button>

            {data && (
              <div className="mt-4 space-y-1.5">
                {data.error ? (
                  <div className="text-[13px] text-bad bg-bad/10 rounded-xl p-3">{data.error}</div>
                ) : c ? (
                  <>
                    {data.ready !== undefined && (
                      <div className={cn('text-[13px] font-semibold rounded-xl px-3 py-2 mb-1', data.ready ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')}>
                        {data.ready ? '✓ Аккаунт готов к работе' : '⚠ Есть замечания — см. ниже'}
                      </div>
                    )}
                    <Row icon={Globe} label="Прокси" good={Boolean(c.proxy?.ok)}
                      detail={c.proxy?.error ?? [c.proxy?.ip, c.proxy?.country, c.proxy?.datacenter ? 'датацентр' : c.proxy?.scheme].filter(Boolean).join(' · ')} />
                    <Row icon={KeyRound} label="Сессия Instagram" good={Boolean(c.session?.alive)}
                      detail={c.session?.error ?? (c.session?.alive ? 'жива' : 'не подтверждена')} />
                    {c.antidetect && (
                      <Row icon={ShieldCheck} label="Антидетект" good={c.antidetect.redCount === 0} warn={c.antidetect.redCount == null}
                        detail={c.antidetect.error ?? (c.antidetect.redCount === 0 ? `0 сигналов · ${c.antidetect.egressIp ?? ''}` : `${c.antidetect.redCount} сигн.: ${(c.antidetect.red || []).join('; ').slice(0, 60)}`)} />
                    )}
                    {c.followers && (
                      <Row icon={Minus} label="Подписчики" good={c.followers.count != null}
                        detail={c.followers.error ?? (c.followers.count != null ? String(c.followers.count) : '—')} />
                    )}

                    {c.actions && (
                      <div className="pt-2">
                        <div className="text-[11px] font-semibold text-subt/70 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                          <MousePointerClick className="w-3 h-3" /> Кнопки действий{data.target ? ` → @${data.target}` : ''}
                        </div>
                        {c.actions.error || c.actions.skipped ? (
                          <div className="text-[12px] text-subt bg-black/[0.03] rounded-lg px-3 py-2">{c.actions.error ?? c.actions.skipped}</div>
                        ) : (
                          <div className="space-y-1">
                            {Object.entries(c.actions).map(([k, v]: any) => {
                              const good = v.ok || v.already
                              const note = v.already ? 'уже выполнено' : v.closed ? 'закрыто/недоступно' : v.error ? String(v.error).slice(0, 40) : good ? 'кнопка найдена' : 'не достигнуто'
                              return (
                                <div key={k} className={cn('flex items-center gap-2 text-[12.5px] rounded-lg px-2.5 py-1.5', good ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>
                                  {good ? <Check className="w-3.5 h-3.5 shrink-0" /> : <Minus className="w-3.5 h-3.5 shrink-0" />}
                                  <span className="font-medium">{ACT_LABEL[k] ?? k}</span>
                                  <span className="text-subt ml-auto truncate">{note}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    {data.note && <p className="text-[11px] text-subt mt-2 leading-relaxed">{data.note}</p>}
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

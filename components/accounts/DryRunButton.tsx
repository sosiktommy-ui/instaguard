'use client'
import { useState } from 'react'
import { FlaskConical, X, Loader2, Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

// §10.3 «Сухой прогон» — кнопка на карточке аккаунта. Прогоняет реальный браузерный путь
// (сессия → навигация к цели → поиск кнопки действия) БЕЗ финального клика. Безопасно на живых
// аккаунтах: ничего не отправляется/не лайкается. Показывает, дошёл ли бот до каждой кнопки.
type DryRunResult = {
  ok?: boolean; account?: string; target?: string; targetSource?: string; note?: string; error?: string
  results?: Record<string, { ok: boolean; reached?: any; error?: string; closed?: boolean; already?: boolean }>
}
const LABELS: Record<string, string> = { dm: 'Директ', follow: 'Подписка', like: 'Лайк', story: 'Сторис' }

export function DryRunButton({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<DryRunResult | null>(null)
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

  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        title="Сухой прогон (тест без действий)"
        className="p-1.5 -m-1.5 rounded-lg text-subt hover:text-brand hover:bg-brand/[0.08] transition-colors shrink-0">
        <FlaskConical className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => { e.stopPropagation(); setOpen(false) }}>
          <div className="card w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-brand" />
                <h3 className="font-semibold text-[15px]">Сухой прогон</h3>
              </div>
              <button onClick={() => setOpen(false)} className="p-1 -m-1 text-subt hover:text-fg"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[12px] text-subt mb-4 leading-relaxed">
              Бот пройдёт реальный путь (вход → заход к цели → поиск кнопки действия), но <b>ничего не отправит и не нажмёт</b>.
              Проверяет, жива ли сессия, носит ли прокси трафик и находятся ли кнопки. Безопасно для аккаунта.
            </p>

            <label className="block text-[12px] font-medium mb-1.5">Цель (username) — необязательно</label>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="оставьте пустым — возьмём подписчика"
              className="w-full px-3 py-2 rounded-xl border bg-transparent text-[13px] mb-3 outline-none focus:border-brand" />

            <button onClick={run} disabled={loading}
              className="w-full py-2.5 rounded-xl bg-brand text-white font-medium text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Прогоняю…</> : 'Запустить сухой прогон'}
            </button>

            {data && (
              <div className="mt-4">
                {data.error ? (
                  <div className="text-[13px] text-bad bg-bad/10 rounded-xl p-3">{data.error}</div>
                ) : (
                  <>
                    <div className="text-[12px] text-subt mb-2">
                      @{data.account} → <b>@{data.target}</b> {data.targetSource ? `(${data.targetSource})` : ''}
                    </div>
                    <div className="space-y-1.5">
                      {Object.entries(data.results ?? {}).map(([k, v]) => {
                        const good = v.ok || v.already
                        const note = v.already ? 'уже выполнено' : v.closed ? 'закрыто/недоступно' : v.error ? v.error : (good ? 'кнопка найдена' : 'не достигнуто')
                        return (
                          <div key={k} className={cn('flex items-center gap-2 text-[12.5px] rounded-lg px-2.5 py-1.5',
                            good ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>
                            {good ? <Check className="w-3.5 h-3.5 shrink-0" /> : <Minus className="w-3.5 h-3.5 shrink-0" />}
                            <span className="font-medium">{LABELS[k] ?? k}</span>
                            <span className="text-subt ml-auto truncate">{note}</span>
                          </div>
                        )
                      })}
                    </div>
                    {data.note && <p className="text-[11px] text-subt mt-3 leading-relaxed">{data.note}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

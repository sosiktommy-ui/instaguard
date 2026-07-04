'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Статистика черновых аккаунтов + баннер «нет черновых» (план §G4).
 * Самодостаточен: сам грузит аккаунты и настройки. Ставится на «Аккаунты» и на главную.
 */
export function DraftsStatus() {
  const router = useRouter()
  const [total, setTotal] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const [allowNoDrafts, setAllowNoDrafts] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/settings').then((r) => (r.ok ? r.json() : {})),
    ]).then(([accs, s]: any[]) => {
      const drafts = (accs || []).filter((a: any) => a.role === 'HELPER')
      setTotal(drafts.length)
      setActive(drafts.filter((a: any) => a.status === 'ACTIVE').length)
      setAllowNoDrafts(Boolean(s?.allowNoDrafts))
    }).catch(() => setTotal(0))
  }, [])

  if (total === null) return null
  const showBanner = total === 0 && !allowNoDrafts && !dismissed

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[12.5px] text-subt">
        <Layers className="w-3.5 h-3.5" />
        Черновые аккаунты: <span className="font-semibold text-ink tabular-nums">{total}</span>
        {total > 0 && <>· активно <span className="font-semibold text-ok tabular-nums">{active}</span></>}
        {total > 0 && allowNoDrafts && <span className="text-subt">· «без черновых» включено</span>}
      </div>

      {showBanner && (
        <div className="card p-4 border border-warn/40 bg-warn/[0.06]">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[14px]">Нет черновых аккаунтов</div>
              <div className="text-[13px] text-subt mt-1 leading-relaxed">
                Без черновых парсинг подписчиков, комментариев и лайков не запускается — так основные аккаунты защищены от бана.
                Добавьте черновой аккаунт или разрешите основным работать без черновых.
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" onClick={() => router.push('/drafts')}>Добавить черновой</Button>
                <Button size="sm" variant="secondary" onClick={() => router.push('/settings')}>Всё равно использовать →</Button>
              </div>
              <label className="flex items-center gap-2 mt-3 text-[12px] text-subt cursor-pointer">
                <input type="checkbox" className="accent-brand" onChange={(e) => { if (e.target.checked) setDismissed(true) }} />
                Больше не показывать (до обновления страницы)
              </label>
            </div>
            <button onClick={() => setDismissed(true)} className="text-subt hover:text-ink p-1 shrink-0" title="Скрыть"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}
    </div>
  )
}

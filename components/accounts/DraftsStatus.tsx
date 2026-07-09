'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, AlertTriangle, X, Search, Send, Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Статистика черновых аккаунтов + баннер «нет черновых» (план §G4).
 * Самодостаточен: сам грузит аккаунты и настройки. Ставится на «Аккаунты» и на главную.
 */
export function DraftsStatus({ showBanner = true }: { showBanner?: boolean }) {
  const router = useRouter()
  const [total, setTotal] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const [allowNoDrafts, setAllowNoDrafts] = useState(false)
  const [parsingSource, setParsingSource] = useState<string>('api')
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
      setParsingSource(String(s?.parsingSource ?? 'api'))
    }).catch(() => setTotal(0))
  }, [])

  if (total === null) return null
  // По умолчанию парсинг идёт через скрейпер-API — черновые НЕ нужны, и их отсутствие
  // НИЧЕГО не ломает. Тревожный баннер уместен только в режиме «Только черновые» (parsingSource
  // === 'drafts'), где API не используется и без черновых событий действительно нет.
  const draftsRequired = parsingSource === 'drafts'
  const banner = showBanner && draftsRequired && total === 0 && !allowNoDrafts && !dismissed

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[12.5px] text-subt">
        <Layers className="w-3.5 h-3.5" />
        Черновые аккаунты: <span className="font-semibold text-ink tabular-nums">{total}</span>
        {total > 0 && <>· активно <span className="font-semibold text-ok tabular-nums">{active}</span></>}
        {total > 0 && allowNoDrafts && <span className="text-subt">· «без черновых» включено</span>}
        {total === 0 && !draftsRequired && <span className="text-subt">· не нужны (парсинг через API)</span>}
      </div>

      {banner && (
        <div className="card p-4 border border-warn/40 bg-warn/[0.06]">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[14px]">Нет черновых аккаунтов — автоматизация не работает</div>
              <div className="text-[13px] text-subt mt-1 leading-relaxed">
                Черновые аккаунты «разведывают» события (кто подписался, кто оставил комментарий или лайк), а основной
                аккаунт при этом не рискует баном. Пока нет ни одного чернового, <span className="text-ink font-medium">кампании не срабатывают вообще</span>:
              </div>
              <ul className="text-[12.5px] text-subt mt-2 space-y-1">
                <li className="flex items-start gap-2"><Search className="w-3.5 h-3.5 text-warn shrink-0 mt-0.5" /> не ищутся новые подписчики, комментарии и лайки — <span className="text-ink font-medium">триггеры не запускаются</span></li>
                <li className="flex items-start gap-2"><Send className="w-3.5 h-3.5 text-warn shrink-0 mt-0.5" /> действие «Директ» новым подписчикам <span className="text-ink font-medium">не отправляется</span> (некому — событий нет)</li>
                <li className="flex items-start gap-2"><Heart className="w-3.5 h-3.5 text-warn shrink-0 mt-0.5" /> действия «Лайк», «Подписка», «Ответ на сторис» <span className="text-ink font-medium">не выполняются</span></li>
              </ul>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" onClick={() => router.push('/drafts')}>Добавить черновой</Button>
                <Button size="sm" variant="secondary" onClick={() => router.push('/settings')}>Разрешить без черновых →</Button>
              </div>
              <div className="text-[11.5px] text-subt mt-2">
                «Разрешить без черновых» — основной аккаунт сам начнёт «разведку» (выше риск бана). Включается в «Настройках».
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

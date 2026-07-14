'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Bell, CheckCircle2, AlertCircle, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { humanizeLog } from '@/lib/logText'

// plan4 Фаза H — колокольчик срабатываний. Глобальный фид «Сработал триггер → @user»
// по всем аккаунтам владельца. Непрочитанное считаем по метке времени последнего
// просмотра в localStorage (rg-seen-activity-ts); открытие панели помечает всё прочитанным.
interface Item { id: string; level: 'SUCCESS' | 'WARN' | 'ERROR'; message: string; account: string | null; createdAt: string }

const SEEN_KEY = 'rg-seen-activity-ts'
const POLL_MS = 60_000

const META: Record<Item['level'], { Icon: any; color: string }> = {
  SUCCESS: { Icon: CheckCircle2,  color: '#34c759' },
  WARN:    { Icon: AlertTriangle, color: '#ff9500' },
  ERROR:   { Icon: AlertCircle,   color: '#ff3b30' },
}

function relTime(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs} ч назад`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

const readSeen = (): number => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0 } catch { return 0 } }

export function ActivityBell() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<number>(0)
  const initialised = useRef(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    fetch('/api/activity?limit=40')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        const list: Item[] = Array.isArray(d?.items) ? d.items : []
        setItems(list)
        // Первая загрузка: если метки просмотра ещё нет — считаем всю ИСТОРИЮ прочитанной
        // (не заваливаем новичка badge'ом), метку ставим на самый свежий элемент.
        if (!initialised.current) {
          initialised.current = true
          const stored = readSeen()
          if (!stored && list.length) {
            const newest = new Date(list[0].createdAt).getTime()
            try { localStorage.setItem(SEEN_KEY, String(newest)) } catch {}
            setSeen(newest)
          } else setSeen(stored)
        }
      })
      .catch(() => setItems((p) => p ?? []))
  }, [])

  useEffect(() => {
    setSeen(readSeen())
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  // Клик вне панели — закрыть
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const unread = (items ?? []).filter((i) => new Date(i.createdAt).getTime() > seen).length

  const openPanel = () => {
    setOpen((v) => !v)
    // Открыли — помечаем всё прочитанным (метка = самый свежий элемент или сейчас)
    if (!open) {
      const newest = items && items.length ? new Date(items[0].createdAt).getTime() : Date.now()
      try { localStorage.setItem(SEEN_KEY, String(newest)) } catch {}
      setSeen(newest)
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={openPanel}
        className="relative w-10 h-10 rounded-xl flex items-center justify-center text-subt hover:text-ink hover:bg-black/[0.05] transition-colors"
        title="Срабатывания триггеров"
        aria-label="Срабатывания"
      >
        <Bell className="w-[18px] h-[18px]" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center leading-none shadow-sm">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-w-[92vw] card overflow-hidden animate-scale-in z-50" style={{ transformOrigin: 'top right' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/[0.05]">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-brand" />
              <span className="font-semibold text-[14px]">Срабатывания</span>
            </div>
            <button onClick={() => setOpen(false)} className="p-1 text-subt hover:text-ink transition-colors" aria-label="Закрыть"><X className="w-4 h-4" /></button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items === null ? (
              <div className="py-12 text-center text-subt text-[13px]">Загрузка…</div>
            ) : items.length === 0 ? (
              <div className="py-12 flex flex-col items-center text-center gap-2.5 px-6">
                <div className="w-12 h-12 rounded-2xl bg-canvas flex items-center justify-center"><Bell className="w-5 h-5 text-subt" /></div>
                <div className="text-[13px] text-subt">Пока нет срабатываний.<br />Здесь появятся события, когда кампании поймают подписчика/лайк/коммент.</div>
              </div>
            ) : (
              <div className="py-1.5">
                {items.map((i) => {
                  const m = META[i.level] ?? META.SUCCESS
                  const fresh = new Date(i.createdAt).getTime() > seen
                  return (
                    <div key={i.id} className={cn('flex items-start gap-2.5 px-4 py-2.5 transition-colors', fresh ? 'bg-brand/[0.04]' : 'hover:bg-black/[0.02]')}>
                      <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${m.color}1f` }}>
                        <m.Icon className="w-3.5 h-3.5" style={{ color: m.color }} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-ink/85 leading-snug">{humanizeLog(i.message)}</div>
                        <div className="text-[11px] text-subt mt-0.5">{i.account ? `@${i.account} · ` : ''}{relTime(i.createdAt)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

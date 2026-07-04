'use client'

import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, Layers, Globe, GraduationCap, Play, ChevronDown, List, Users, BarChart3, Settings as SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ClientOnly from '@/components/common/ClientOnly'
import { ReactiveMascot } from '@/components/common/ReactiveMascot'
import { cn } from '@/lib/utils'

// Краткая справка по разделам приложения (раскрывается в «Настройках»)
const HELP: { icon: any; title: string; text: string }[] = [
  { icon: List, title: 'Рекламные кампании (главная)', text: 'Здесь создаются кампании: выбираете аккаунт → событие (новая подписка, комментарий, лайк, сторис) → действия (директ, лайк, подписка, сторис) и текст. Ниже — список аккаунтов, папки-разделы для фильтра и сводка.' },
  { icon: Users, title: 'Аккаунты', text: 'Подключённые Instagram-аккаунты: статус, дневная загрузка лимитов, «Индекс безопасности» (риск бана), смена раздела и прокси, детальная статистика по каждому.' },
  { icon: Layers, title: 'Черновые аккаунты', text: 'Аккаунты-«разведчики». Они парсят подписчиков, комментарии и лайки, чтобы основной аккаунт не рисковал баном. Без хотя бы одного чернового автоматизация не запускается.' },
  { icon: Globe, title: 'Прокси', text: 'Пуловые прокси (бот сам раздаёт их аккаунтам в режиме «Авто») и уникальные (закреплены за одним аккаунтом). Здесь же — лимит «аккаунтов на один прокси».' },
  { icon: BarChart3, title: 'Статистика', text: 'Сводные цифры по всем аккаунтам и кампаниям: срабатывания, выполненные действия, прирост подписчиков.' },
  { icon: SettingsIcon, title: 'Настройки', text: 'Тумблеры «работать без прокси» и «без черновых», лимит аккаунтов на прокси, а также запуск этого обучения.' },
]

interface Settings { accountsPerProxy: number; allowNoProxy: boolean; allowNoDrafts: boolean }

// Переключатель (тумблер)
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn('relative w-11 h-6 rounded-full transition-colors shrink-0', on ? 'bg-brand' : 'bg-black/15')}
      role="switch" aria-checked={on}
    >
      <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', on && 'translate-x-5')} />
    </button>
  )
}

function SettingsScreen() {
  const [s, setS] = useState<Settings>({ accountsPerProxy: 3, allowNoProxy: false, allowNoDrafts: false })
  const [capInput, setCapInput] = useState('3')
  const [msg, setMsg] = useState('')
  const [openHelp, setOpenHelp] = useState<number | null>(null)

  // Запустить интерактивное обучение заново (сброс флага + переход на главную)
  const startTour = () => {
    try { localStorage.removeItem('rg-onboarded') } catch {}
    window.location.assign('/triggers')
  }

  const load = useCallback(async () => {
    try { const r = await fetch('/api/settings'); if (r.ok) { const d = await r.json(); setS(d); setCapInput(String(d.accountsPerProxy ?? 3)) } } catch {}
  }, [])
  useEffect(() => { load() }, [load])

  const patch = async (data: Partial<Settings>) => {
    setS((p) => ({ ...p, ...data }))   // оптимистично
    try {
      const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (r.ok) { setMsg('Сохранено'); const d = await r.json(); setS((p) => ({ ...p, ...d })) }
      else setMsg('Не удалось сохранить')
    } catch { setMsg('Ошибка сети') }
  }

  const rowCls = 'card p-5 flex items-start gap-4'

  return (
    <div className="space-y-6 max-w-2xl" data-tour="page">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tighter leading-none">Настройки</h1>
        <p className="text-subt mt-1.5 text-[14px]">Правила безопасности и автоматизации аккаунтов</p>
      </div>

      {msg && <div className="text-[13px] text-subt bg-canvas rounded-2xl px-4 py-3">{msg}</div>}

      {/* Обучение и справка по разделам */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <ReactiveMascot size={64} className="shrink-0 -mt-1" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px]">Обучение и справка</div>
            <div className="text-[13px] text-subt mt-1 leading-relaxed">
              Пройдите интерактивный тур с Reactive — он проведёт по всем экранам и покажет, что где находится.
              Или раскройте краткое описание любого раздела ниже.
            </div>
            <Button className="mt-3" onClick={startTour}><Play className="w-4 h-4" /> Пройти обучение</Button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-black/[0.06] space-y-1.5">
          <div className="text-[12px] font-semibold text-subt uppercase tracking-wider mb-1">Что где находится</div>
          {HELP.map((h, idx) => {
            const open = openHelp === idx
            return (
              <div key={idx} className="rounded-2xl bg-canvas overflow-hidden">
                <button onClick={() => setOpenHelp(open ? null : idx)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-black/[0.02] transition-colors">
                  <span className="w-7 h-7 rounded-xl bg-brand/10 flex items-center justify-center shrink-0"><h.icon className="w-3.5 h-3.5 text-brand" /></span>
                  <span className="flex-1 text-[13.5px] font-medium">{h.title}</span>
                  <ChevronDown className={cn('w-4 h-4 text-subt shrink-0 transition-transform', open && 'rotate-180')} />
                </button>
                {open && <div className="px-3.5 pb-3 pl-[52px] text-[12.5px] text-subt leading-relaxed animate-fade-in">{h.text}</div>}
              </div>
            )
          })}
        </div>
      </div>

      <div className={rowCls}>
        <div className="w-10 h-10 rounded-2xl bg-warn/10 text-warn flex items-center justify-center shrink-0"><ShieldAlert className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px]">Работать без прокси</div>
          <div className="text-[13px] text-subt mt-1 leading-relaxed">
            Разрешить подключать и использовать аккаунты без прокси. Повышает риск ограничений и бана Instagram —
            рекомендуется держать выключенным и назначать прокси каждому аккаунту.
          </div>
        </div>
        <Toggle on={s.allowNoProxy} onChange={(v) => patch({ allowNoProxy: v })} />
      </div>

      <div className={rowCls}>
        <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center shrink-0"><Layers className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px]">Работать без черновых аккаунтов</div>
          <div className="text-[13px] text-subt mt-1 leading-relaxed">
            Когда черновых аккаунтов нет, разрешить основным делать «грязную» работу самим (парсинг подписчиков,
            комментариев и т.п.). По умолчанию выключено — чтобы беречь основные аккаунты от бана.
          </div>
        </div>
        <Toggle on={s.allowNoDrafts} onChange={(v) => patch({ allowNoDrafts: v })} />
      </div>

      <div className={rowCls}>
        <div className="w-10 h-10 rounded-2xl bg-ok/10 text-ok flex items-center justify-center shrink-0"><Globe className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px]">Аккаунтов на один прокси</div>
          <div className="text-[13px] text-subt mt-1 leading-relaxed">
            Сколько аккаунтов авто-режим вешает на один пуловый прокси, прежде чем взять следующий.
            Меньше — безопаснее. То же значение доступно на вкладке «Прокси».
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input type="number" min={1} max={100} value={capInput} onChange={(e) => setCapInput(e.target.value)}
            className="field w-20 py-2 text-[14px] text-center" />
          <Button variant="secondary" onClick={() => patch({ accountsPerProxy: Math.max(1, Math.min(100, Math.round(Number(capInput) || s.accountsPerProxy))) })}>Сохранить</Button>
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return <ClientOnly><SettingsScreen /></ClientOnly>
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, Layers, Globe, ChevronDown, List, Users, BarChart3, Settings as SettingsIcon, HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ClientOnly from '@/components/common/ClientOnly'
import { PageHeader } from '@/components/common/PageHeader'
import { IconTile } from '@/components/common/IconTile'
import { TONE } from '@/lib/colors'
import { cn } from '@/lib/utils'

// Краткая справка по разделам приложения (раскрывается в «Настройках»)
const HELP: { icon: any; color: string; title: string; text: string }[] = [
  { icon: List, color: TONE.brand, title: 'Рекламные кампании (главная)', text: 'Здесь создаются кампании: выбираете аккаунт → событие (новая подписка, комментарий, лайк, сторис) → действия (директ, лайк, подписка, сторис) и текст. Ниже — список аккаунтов, папки-разделы для фильтра и сводка.' },
  { icon: Users, color: TONE.alt, title: 'Аккаунты', text: 'Подключённые Instagram-аккаунты: статус, дневная загрузка лимитов, «Индекс безопасности» (риск бана), смена раздела и прокси, детальная статистика по каждому.' },
  { icon: Layers, color: TONE.pink, title: 'Черновые аккаунты', text: 'Аккаунты-«разведчики». Они парсят подписчиков, комментарии и лайки, чтобы основной аккаунт не рисковал баном. Без хотя бы одного чернового автоматизация не запускается.' },
  { icon: Globe, color: TONE.ok, title: 'Прокси', text: 'Пуловые прокси (бот сам раздаёт их аккаунтам в режиме «Авто») и уникальные (закреплены за одним аккаунтом). Здесь же — лимит «аккаунтов на один прокси».' },
  { icon: BarChart3, color: TONE.warn, title: 'Статистика', text: 'Сводные цифры по всем аккаунтам и кампаниям: срабатывания, выполненные действия, прирост подписчиков.' },
  { icon: SettingsIcon, color: TONE.brand, title: 'Настройки', text: 'Тумблеры «работать без прокси» и «без черновых», а также лимит аккаунтов на один прокси.' },
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
  const [showHelp, setShowHelp] = useState(false)   // весь блок «Что где находится» — свёрнут по умолчанию

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

  const rowCls = 'card card-3d gloss p-5 flex items-start gap-4'

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader icon={SettingsIcon} color={TONE.brand} title="Настройки" subtitle="Правила безопасности и автоматизации аккаунтов" tourId="page" />

      {msg && <div className="text-[13px] text-subt bg-canvas rounded-2xl px-4 py-3">{msg}</div>}

      <div className={rowCls}>
        <IconTile icon={ShieldAlert} color={TONE.warn} size={40} />
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
        <IconTile icon={Layers} color={TONE.brand} size={40} />
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
        <IconTile icon={Globe} color={TONE.ok} size={40} />
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

      {/* Справка по разделам — что где находится */}
      <div className="card card-3d gloss p-5">
        <button onClick={() => setShowHelp((v) => !v)}
          className="w-full flex items-center gap-3.5 text-left">
          <IconTile icon={HelpCircle} color={TONE.alt} size={40} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px]">Что где находится</div>
            <div className="text-[13px] text-subt mt-0.5">Краткое описание каждого раздела приложения</div>
          </div>
          <ChevronDown className={cn('w-5 h-5 text-subt shrink-0 transition-transform', showHelp && 'rotate-180')} />
        </button>
        {showHelp && (
          <div className="mt-4 pt-4 border-t border-black/[0.06] space-y-1.5 animate-fade-in">
            {HELP.map((h, idx) => {
              const open = openHelp === idx
              return (
                <div key={idx} className="rounded-2xl bg-canvas overflow-hidden">
                  <button onClick={() => setOpenHelp(open ? null : idx)}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-black/[0.02] transition-colors">
                    <IconTile icon={h.icon} color={h.color} size={30} />
                    <span className="flex-1 text-[13.5px] font-medium">{h.title}</span>
                    <ChevronDown className={cn('w-4 h-4 text-subt shrink-0 transition-transform', open && 'rotate-180')} />
                  </button>
                  {open && <div className="px-3.5 pb-3 pl-[54px] text-[12.5px] text-subt leading-relaxed animate-fade-in">{h.text}</div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Page() {
  return <ClientOnly><SettingsScreen /></ClientOnly>
}

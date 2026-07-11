'use client'

import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, Globe, ChevronDown, List, Users, BarChart3, Settings as SettingsIcon, HelpCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ClientOnly from '@/components/common/ClientOnly'
import { PageHeader } from '@/components/common/PageHeader'
import { IconTile } from '@/components/common/IconTile'
import { TONE } from '@/lib/colors'
import { cn } from '@/lib/utils'

// Справка по разделам приложения (раскрывается в «Настройках»).
// Для каждого раздела — что это + список конкретных функций/что можно сделать.
const HELP: { icon: any; color: string; title: string; text: string; features: string[] }[] = [
  {
    icon: List, color: TONE.brand, title: 'Рекламные кампании (главная)',
    text: 'Главный экран: создание кампаний и обзор аккаунтов с их кампаниями.',
    features: [
      'Создать кампанию: аккаунт(ы) → событие (новая подписка / комментарий / лайк / ответ на сторис) → действия и тексты.',
      'Действия: директ (с картинкой, ссылкой, проверкой подписки), ответ в комментариях, лайк, подписка в ответ, просмотр/лайк сторис.',
      'Провалиться в аккаунт → увидеть его кампании со счётчиками срабатываний по каждому действию.',
      'Сохранять и применять шаблоны кампаний.',
      'Папки-разделы для фильтра аккаунтов + сводка (аккаунты / кампании / срабатывания).',
    ],
  },
  {
    icon: Users, color: TONE.alt, title: 'Аккаунты',
    text: 'Подключённые основные Instagram-аккаунты — те, что выполняют действия.',
    features: [
      'Подключить аккаунт по логину/паролю или по куки (sessionid).',
      '«Проверить подписчиков» — ручной запуск проверки и постановка действий в очередь.',
      'Статус (активен / пауза / бан), «Индекс безопасности» (риск бана), дневная загрузка лимитов.',
      'Детали аккаунта: спарклайн прироста подписчиков, разбивка действий, кампании.',
      'Сменить прокси и раздел, поставить на паузу, сбросить снапшот, удалить.',
      'Разделы (папки): создать кнопкой «+ Раздел» и разложить аккаунты.',
    ],
  },
  {
    icon: Globe, color: TONE.ok, title: 'Прокси',
    text: 'Управление прокси и их привязкой к аккаунтам.',
    features: [
      'Пуловые прокси: добавить в общий пул — бот сам раздаёт их в режиме «Авто».',
      'Приватные прокси: добавить и привязать к ним конкретный аккаунт.',
      '«Привязать аккаунт» — прикрепить существующий аккаунт к приватному прокси; «Новый аккаунт» — сразу подключить аккаунт на этот прокси.',
      'Отвязать аккаунт от прокси, удалить прокси.',
      'Лимит «аккаунтов на один пуловый прокси» + сводка (пуловые / приватные / свободно).',
    ],
  },
  {
    icon: BarChart3, color: TONE.warn, title: 'Статистика',
    text: 'Сводные цифры и журнал по всем аккаунтам и кампаниям.',
    features: [
      'Метрики: аккаунты, подписчики, активные кампании, срабатывания, выполненные действия, ошибки.',
      'Срабатывания по типу кампании и топ аккаунтов по подписчикам.',
      'Журнал последних событий по аккаунтам.',
    ],
  },
  {
    icon: SettingsIcon, color: TONE.brand, title: 'Настройки',
    text: 'Правила безопасности и автоматизации.',
    features: [
      '«Работать без прокси» — разрешить аккаунты без прокси (повышает риск бана).',
      '«Аккаунтов на один прокси» — лимит авто-привязки к пуловому прокси.',
      'Эта справка «Что где находится».',
    ],
  },
]

interface Settings {
  accountsPerProxy: number; allowNoProxy: boolean; allowNoDrafts: boolean; likeByDraft: boolean; storyByDraft: boolean
  parsingSource: string; actionEngine: string; browserHeadful: boolean
}

// Радио-группа: список карточек-вариантов (заголовок + пояснение)
function Radio<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string; desc: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="space-y-2">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={cn('w-full text-left flex items-start gap-3 rounded-2xl border p-3 transition-colors',
            value === o.v ? 'border-brand bg-brand/[0.06]' : 'border-line/50 hover:bg-black/[0.02]')}>
          <span className={cn('mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center', value === o.v ? 'border-brand' : 'border-subt/40')}>
            {value === o.v && <span className="w-2 h-2 rounded-full bg-brand" />}
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium">{o.label}</span>
            <span className="block text-[12px] text-subt leading-snug mt-0.5">{o.desc}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

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
  const [s, setS] = useState<Settings>({ accountsPerProxy: 3, allowNoProxy: false, allowNoDrafts: false, likeByDraft: false, storyByDraft: false, parsingSource: 'api', actionEngine: 'browser', browserHeadful: false })
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

      {/* plan4: «Источник парсинга» (черновые/API) убран из UI — события берутся из СВОИХ
          уведомлений основного аккаунта (self-events). Переключатель скрыт; parsingSource
          остаётся в БД как no-op до полного перехода. */}

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
                  {open && (
                    <div className="px-3.5 pb-3.5 pl-[54px] animate-fade-in">
                      <div className="text-[12.5px] text-ink/70 leading-relaxed mb-2">{h.text}</div>
                      <ul className="space-y-1.5">
                        {h.features.map((f, fi) => (
                          <li key={fi} className="flex gap-2 text-[12.5px] text-subt leading-relaxed">
                            <span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: h.color }} />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
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

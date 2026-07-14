'use client'

import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, Globe, ChevronDown, List, Users, BarChart3, Settings as SettingsIcon, HelpCircle, Clock, RefreshCw } from 'lucide-react'
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
      'Проверка триггеров и запуск действий — автоматически по «Интервалу авто-проверки» (Настройки).',
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

interface DailyCaps { dm: number; follow: number; like: number; comment: number; story: number }
interface Settings {
  accountsPerProxy: number; allowNoProxy: boolean; allowNoDrafts: boolean; likeByDraft: boolean; storyByDraft: boolean
  parsingSource: string; actionEngine: string; browserHeadful: boolean; pollIntervalHours: number
  dailyCaps: DailyCaps
}

// Метаданные для редактора лимитов (подпись + потолок + пояснение риска)
const CAP_FIELDS: { key: keyof DailyCaps; label: string; max: number; hint: string }[] = [
  { key: 'dm', label: 'Директ', max: 60, hint: 'в основном тёплым подписчикам — низкий риск' },
  { key: 'follow', label: 'Подписка', max: 40, hint: 'подписки в ответ; масс-фолловинг рискованнее' },
  { key: 'like', label: 'Лайк', max: 120, hint: 'лайки постов' },
  { key: 'comment', label: 'Коммент', max: 30, hint: 'публичные комментарии — заметнее' },
  { key: 'story', label: 'Сторис', max: 150, hint: 'просмотры/лайки сторис — самое безопасное' },
]

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

function timeAgo(iso: string | null): string {
  if (!iso) return 'ещё не проверялось'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (sec < 60) return 'только что'
  const m = Math.floor(sec / 60); if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60); if (h < 24) return `${h} ч назад`
  const d = Math.floor(h / 24); return `${d} дн назад`
}

function SettingsScreen() {
  const [s, setS] = useState<Settings>({ accountsPerProxy: 3, allowNoProxy: false, allowNoDrafts: false, likeByDraft: false, storyByDraft: false, parsingSource: 'api', actionEngine: 'browser', browserHeadful: false, pollIntervalHours: 3, dailyCaps: { dm: 25, follow: 15, like: 40, comment: 10, story: 50 } })
  const [capsDraft, setCapsDraft] = useState<DailyCaps | null>(null)   // локальная правка перед «Сохранить»
  const [capInput, setCapInput] = useState('3')
  const [msg, setMsg] = useState('')
  const [openHelp, setOpenHelp] = useState<number | null>(null)
  const [showHelp, setShowHelp] = useState(false)   // весь блок «Что где находится» — свёрнут по умолчанию
  const [lastCheck, setLastCheck] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/settings'); if (r.ok) { const d = await r.json(); setS(d); setCapInput(String(d.accountsPerProxy ?? 3)); if (d.dailyCaps) setCapsDraft(d.dailyCaps) } } catch {}
  }, [])
  // Последняя проверка = самый свежий lastChecked среди аккаунтов владельца.
  const loadLastCheck = useCallback(async () => {
    try {
      const r = await fetch('/api/accounts')
      if (!r.ok) return
      const arr = await r.json()
      const times = (Array.isArray(arr) ? arr : [])
        .map((a: any) => a?.lastChecked).filter(Boolean)
        .map((x: string) => new Date(x).getTime()).filter((n: number) => Number.isFinite(n))
      setLastCheck(times.length ? new Date(Math.max(...times)).toISOString() : null)
    } catch {}
  }, [])
  useEffect(() => { load(); loadLastCheck() }, [load, loadLastCheck])

  // «Проверить сейчас» — ручной поллинг (isManual: игнорирует интервал/тихие часы, действия сразу).
  const runNow = useCallback(async () => {
    setChecking(true); setMsg('Запускаю проверку…')
    try {
      const r = await fetch('/api/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manual: true }) })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d?.busy) setMsg('Проверка уже выполняется — подождите завершения.')
      else if (r.ok) setMsg('Проверка выполнена.')
      else setMsg('Не удалось запустить проверку.')
    } catch { setMsg('Ошибка сети при запуске проверки.') }
    await loadLastCheck()
    setChecking(false)
  }, [loadLastCheck])

  const patch = async (data: Partial<Settings>) => {
    setS((p) => ({ ...p, ...data }))   // оптимистично
    try {
      const r = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      if (r.ok) { setMsg('Сохранено'); const d = await r.json(); setS((p) => ({ ...p, ...d })); if (d.dailyCaps) setCapsDraft(d.dailyCaps) }
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
        <IconTile icon={Clock} color={TONE.brand} size={40} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px]">Интервал авто-проверки</div>
          <div className="text-[13px] text-subt mt-1 leading-relaxed">
            Как часто бот сам проверяет аккаунты на срабатывания триггеров и запускает действия.
            Реже — безопаснее и естественнее (живой человек не проверяет ленту каждые 5 минут).
            Можно проверить и вручную кнопкой ниже — не дожидаясь интервала.
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span className="text-[12.5px] text-subt">
              Последняя проверка: <span className="text-ink font-medium">{timeAgo(lastCheck)}</span>
            </span>
            <Button size="sm" variant="secondary" onClick={runNow} disabled={checking}>
              <RefreshCw className={cn('w-3.5 h-3.5', checking && 'animate-spin')} />
              {checking ? 'Проверяю…' : 'Проверить сейчас'}
            </Button>
          </div>
        </div>
        <select value={s.pollIntervalHours} onChange={(e) => patch({ pollIntervalHours: Number(e.target.value) })}
          className="shrink-0 w-40 bg-canvas border border-line/70 rounded-2xl px-4 py-2.5 text-[14px] text-ink outline-none cursor-pointer focus:border-brand">
          {[1, 2, 3, 6, 12, 24, 48].map((h) => (
            <option key={h} value={h}>{h === 24 ? 'раз в сутки' : h === 48 ? 'раз в 2 суток' : `каждые ${h} ч`}</option>
          ))}
        </select>
      </div>

      {/* Дневные лимиты действий (защита от бана) */}
      <div className="card card-3d gloss p-5">
        <div className="flex items-start gap-4">
          <IconTile icon={ShieldAlert} color={TONE.pink} size={40} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px]">Дневные лимиты действий</div>
            <div className="text-[13px] text-subt mt-1 leading-relaxed">
              Сколько действий в сутки на аккаунт. Директ идёт в основном тёплым подписчикам (низкий риск),
              поэтому его потолок выше. Всё равно ужимается «прогревом»: у нового аккаунта лимиты стартуют
              с 15% и за 14 дней выходят на 100% (защита от бана). <b>0</b> — действие выключено.
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {CAP_FIELDS.map((f) => {
            const val = (capsDraft ?? s.dailyCaps)[f.key]
            return (
              <label key={f.key} className="flex flex-col gap-1.5" title={f.hint}>
                <span className="text-[12px] font-medium text-ink/80">{f.label}<span className="text-subt/60 font-normal"> /сут</span></span>
                <input type="number" min={0} max={f.max} value={val}
                  onChange={(e) => setCapsDraft((prev) => ({ ...(prev ?? s.dailyCaps), [f.key]: Math.max(0, Math.min(f.max, Math.round(Number(e.target.value) || 0))) }))}
                  className="field w-full py-2 text-[14px] text-center" />
                <span className="text-[10.5px] text-subt/70 leading-tight">{f.hint}</span>
              </label>
            )
          })}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={() => capsDraft && patch({ dailyCaps: capsDraft })}>Сохранить лимиты</Button>
          <Button variant="ghost" onClick={() => setCapsDraft({ dm: 25, follow: 15, like: 40, comment: 10, story: 50 })}>Сбросить к умолчанию</Button>
        </div>
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

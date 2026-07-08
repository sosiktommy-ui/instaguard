'use client'

import { useState, useEffect, useCallback } from 'react'
import { Radar, CheckCircle2, AlertTriangle, ExternalLink, RefreshCw, Users, MessageCircle, Heart, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ClientOnly from '@/components/common/ClientOnly'
import { PageHeader } from '@/components/common/PageHeader'
import { IconTile } from '@/components/common/IconTile'
import { TONE } from '@/lib/colors'

interface Health {
  configured: boolean
  ok?: boolean
  error?: string
  hint?: string
  userId?: string
}

function ParsingStatus() {
  const [health, setHealth] = useState<Health | null>(null)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async (test: boolean) => {
    try {
      const res = await fetch(`/api/scraper-health${test ? '?test=1' : ''}`, { cache: 'no-store' })
      if (res.ok) setHealth(await res.json())
    } catch {
      setHealth({ configured: false, error: 'Не удалось получить статус' })
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  const runTest = async () => {
    setTesting(true)
    await load(true)
    setTesting(false)
  }

  // Состояние: не задан ключ / задан но не проверен / проверен ок / проверен с ошибкой
  const configured = health?.configured === true
  const tested = configured && health?.ok !== undefined
  const working = tested && health?.ok === true

  const statusColor = !configured ? TONE.bad : working ? TONE.ok : tested ? TONE.bad : TONE.brand
  const StatusIcon = !configured ? AlertTriangle : working ? CheckCircle2 : tested ? AlertTriangle : Radar
  const statusTitle = !configured
    ? 'Скрейпер-API не подключён'
    : working
    ? 'Скрейпер-API работает'
    : tested
    ? 'Ключ задан, но запрос не прошёл'
    : 'Скрейпер-API подключён'
  const statusText = !configured
    ? (health?.hint ?? 'Не задан ключ HIKER_API_KEY.')
    : working
    ? 'Парсинг подписчиков, комментариев и лайков идёт через API. Черновые аккаунты и прокси для них не нужны.'
    : tested
    ? `Ключ задан, но тестовый запрос вернул ошибку: ${health?.error ?? 'неизвестно'}. Проверьте баланс на hikerapi.com.`
    : 'Ключ задан. Нажмите «Проверить связь», чтобы убедиться, что API отвечает.'

  return (
    <div className="space-y-6">
      <PageHeader icon={Radar} color={TONE.brand} title="Парсинг (API)" subtitle="Сбор подписчиков, комментариев и лайков — через скрейпер-API, без черновых аккаунтов" tourId="page" />

      {/* Главный статус */}
      <div className="card card-3d gloss p-6 sm:p-7 relative overflow-hidden">
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-20" style={{ background: statusColor }} />
        <div className="flex items-start gap-4 relative">
          <IconTile icon={StatusIcon} color={statusColor} size={52} className="rounded-2xl shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-[19px] font-semibold tracking-tight">{statusTitle}</h2>
              <span className="flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full"
                style={{ background: `${statusColor}1a`, color: statusColor }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
                {!configured ? 'не подключён' : working ? 'работает' : tested ? 'ошибка' : 'подключён'}
              </span>
            </div>
            <p className="text-subt text-[14px] mt-2 leading-relaxed">{statusText}</p>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              {configured && (
                <Button onClick={runTest} disabled={testing}>
                  <RefreshCw className={cn('w-4 h-4', testing && 'animate-spin')} />
                  {testing ? 'Проверяем…' : 'Проверить связь'}
                </Button>
              )}
              <a href="https://hikerapi.com" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
                <ExternalLink className="w-3.5 h-3.5" /> hikerapi.com — оформить / пополнить баланс
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Что это заменяет */}
      <div className="card card-3d gloss p-6">
        <h3 className="text-[15px] font-semibold tracking-tight mb-1">Как это работает</h3>
        <p className="text-subt text-[13px] leading-relaxed mb-4">
          Раньше подписчиков и комментарии парсили черновые аккаунты (их надо было покупать и давать им прокси —
          был риск бана). Теперь чтение публичных данных идёт через API. Черновые больше не нужны — купите
          хорошие прокси только для <b>основных</b> аккаунтов (директ/лайк/подписку делают они).
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { icon: Users, color: TONE.brand, t: 'Новые подписчики', d: 'Триггер «Подписка» — через API' },
            { icon: MessageCircle, color: TONE.ok, t: 'Новые комментарии', d: 'Триггер «Комментарий» — через API' },
            { icon: Heart, color: TONE.pink, t: 'Лайкнувшие посты', d: 'Триггер «Лайк» — через API' },
            { icon: Sparkles, color: TONE.warn, t: 'Ответы на сторис', d: 'Читает сам основной (его личка)' },
          ].map((x) => (
            <div key={x.t} className="flex items-center gap-3 bg-canvas rounded-2xl px-4 py-3">
              <IconTile icon={x.icon} color={x.color} size={38} className="rounded-xl shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-[14px]">{x.t}</div>
                <div className="text-subt text-[12px] truncate">{x.d}</div>
              </div>
              <CheckCircle2 className="w-4 h-4 text-ok ml-auto shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return <ClientOnly><ParsingStatus /></ClientOnly>
}

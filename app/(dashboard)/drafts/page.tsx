'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Radar, CheckCircle2, AlertTriangle, ExternalLink, RefreshCw, Users, MessageCircle, Heart, Sparkles,
  Plus, Trash2, Globe, Zap, RotateCcw, Pencil, Check, X, UsersRound, Cookie,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ClientOnly from '@/components/common/ClientOnly'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { PageHeader } from '@/components/common/PageHeader'
import { IconTile } from '@/components/common/IconTile'
import { AddAccountModal } from '@/components/accounts/AddAccountModal'
import { ImportCookiesModal } from '@/components/accounts/ImportCookiesModal'
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
          Подписчиков и комментарии читает внешний API — своих аккаунтов и прокси для парсинга не нужно.
          Купите хорошие прокси только для <b>основных</b> аккаунтов (директ/лайк/подписку делают они).
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

interface HelperAccount {
  id: string
  username: string
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE'
  lastChecked: string | null
  errorCount: number
  proxy: string | null
}

// Режимы drafts / drafts_then_api — черновые парсят браузером (workers/browser/lib/parse.js,
// ЭКСПЕРИМЕНТАЛЬНО, см. plan.md §5). В отличие от старой (до-API) версии черновые больше
// НЕ выполняют действий — только парсят, логинятся тем же браузерным /login, что основные.
function DraftsManager({ mode }: { mode: 'drafts' | 'drafts_then_api' }) {
  const [accounts, setAccounts] = useState<HelperAccount[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editProxyId, setEditProxyId] = useState<string | null>(null)
  const [editProxyVal, setEditProxyVal] = useState('')
  const [msg, setMsg] = useState('')
  const [pendingDel, setPendingDel] = useState<{ id: string; username: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts')
      if (res.ok) {
        const all = await res.json()
        setAccounts(all.filter((a: any) => a.role === 'HELPER'))
      }
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (id: string) => {
    await fetch(`/api/accounts/${id}`, { method: 'DELETE' }).catch(() => null)
    setAccounts((prev) => prev.filter((a) => a.id !== id))
  }

  const handleSaveProxy = async (id: string) => {
    const proxy = editProxyVal.trim()
    await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: proxy || null }),
    }).catch(() => null)
    setAccounts((prev) => prev.map((a) => a.id === id ? { ...a, proxy: proxy || null } : a))
    setEditProxyId(null)
    setMsg(`Прокси ${proxy ? 'обновлён' : 'удалён'}`)
  }

  const handleResetSnapshot = async (id: string) => {
    await fetch(`/api/accounts/${id}/reset-snapshot`, { method: 'DELETE' }).catch(() => null)
    setMsg('Снапшот сброшен')
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={UsersRound} color={TONE.alt} title="Черновые аккаунты" subtitle="Парсят подписчиков/комментарии браузером — основные только отправляют" tourId="page">
        <Button variant="secondary" onClick={() => setShowImport(true)}><Cookie className="w-4 h-4" /> Импорт списком</Button>
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Добавить</Button>
      </PageHeader>

      <div className="text-[12px] text-warn bg-warn/10 rounded-2xl px-4 py-3 leading-snug">
        ⚠️ Парсинг черновыми — экспериментальный (DOM-разбор модалок Instagram, вёрстка которых часто меняется).
        {mode === 'drafts_then_api' && ' Если у аккаунта нет живого чернового — автоматически используется скрейпер-API.'}
        {' '}Черновым, как и основным, нужны свои прокси — они логинятся тем же браузером.
      </div>

      {msg && <div className="text-[13px] text-subt bg-canvas rounded-2xl px-4 py-3">{msg}</div>}

      {accounts.length === 0 ? (
        <div className="card card-3d gloss p-14 text-center flex flex-col items-center">
          <IconTile icon={Zap} color={TONE.alt} size={56} className="mb-4 rounded-3xl" />
          <h3 className="text-[18px] font-semibold tracking-tight">Нет черновых аккаунтов</h3>
          <p className="text-subt text-[13px] mt-1.5 max-w-xs">
            Черновые аккаунты парсят подписчиков и комментарии — основные аккаунты остаются чистыми.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
            <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Добавить аккаунт</Button>
            <Button variant="secondary" onClick={() => setShowImport(true)}><Cookie className="w-4 h-4" /> Импорт списком</Button>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((a) => (
            <div key={a.id} className="card card-3d gloss p-5 relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-[#6a7df9]/10 blur-2xl pointer-events-none" />
              <div className="flex items-start justify-between relative">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-zinc-300 to-zinc-500 flex items-center justify-center text-white font-semibold text-lg shadow-md">
                    {a.username[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-[15px]">@{a.username}</div>
                    <div className="text-[11px] text-[#6a7df9] font-medium">черновой · парсер</div>
                  </div>
                </div>
                <span className={cn('flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full',
                  a.status === 'ACTIVE' ? 'bg-ok/10 text-ok' : a.status === 'BLOCKED' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>
                  <span className={cn('w-1.5 h-1.5 rounded-full',
                    a.status === 'ACTIVE' ? 'bg-ok' : a.status === 'BLOCKED' ? 'bg-bad' : 'bg-warn')} />
                  {a.status === 'ACTIVE' ? 'Активен' : a.status === 'BLOCKED' ? 'Заблокирован' : 'Пауза'}
                </span>
              </div>

              {a.lastChecked && (
                <div className="text-[11px] text-subt mt-3 relative">
                  Последний парсинг: {new Date(a.lastChecked).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}

              {/* Прокси */}
              <div className="mt-3 relative">
                {editProxyId === a.id ? (
                  <div className="flex gap-1.5">
                    <input autoFocus value={editProxyVal} onChange={(e) => setEditProxyVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveProxy(a.id); if (e.key === 'Escape') setEditProxyId(null) }}
                      className="field flex-1 font-mono text-[11px] py-1.5" placeholder="user:pass@host:port" />
                    <button onClick={() => handleSaveProxy(a.id)} className="px-2 rounded-xl bg-ok/10 text-ok hover:bg-ok/20 transition-colors">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setEditProxyId(null)} className="px-2 rounded-xl bg-canvas text-subt hover:text-ink transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setEditProxyId(a.id); setEditProxyVal(a.proxy ?? '') }}
                    className="w-full flex items-center gap-1.5 text-[11px] text-subt hover:text-ink transition-colors group">
                    <Globe className="w-3 h-3 shrink-0" />
                    <span className="truncate font-mono">{a.proxy ?? 'Без прокси — нажмите чтобы добавить'}</span>
                    <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 ml-auto" />
                  </button>
                )}
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t border-black/[0.05] relative">
                <button onClick={() => handleResetSnapshot(a.id)}
                  title="Сбросить снапшот — при следующем парсинге все подписчики/комментарии снова будут считаться новыми"
                  className="flex items-center gap-1.5 text-[12px] text-subt hover:text-ink transition-colors px-2">
                  <RotateCcw className="w-3.5 h-3.5" /> Сбросить
                </button>
                <div className="flex-1" />
                <Button variant="danger" size="icon" onClick={() => setPendingDel({ id: a.id, username: a.username })}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddAccountModal
          role="HELPER"
          title="Черновой аккаунт"
          subtitle="Для парсинга — не используется для отправки"
          defaultMode="cookies"
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); load(); setMsg('Черновой добавлен') }}
        />
      )}
      {showImport && (
        <ImportCookiesModal
          lockedRole="HELPER"
          onClose={() => setShowImport(false)}
          onDone={(n) => { setShowImport(false); load(); setMsg(`Импортировано: ${n}`) }}
        />
      )}
      {pendingDel && (
        <ConfirmDialog
          open
          title="Удалить чернового?"
          message={`@${pendingDel.username} перестанет использоваться для парсинга.`}
          confirmLabel="Удалить"
          danger
          onConfirm={() => { handleDelete(pendingDel.id); setPendingDel(null) }}
          onCancel={() => setPendingDel(null)}
        />
      )}
    </div>
  )
}

function Drafts() {
  const [parsingSource, setParsingSource] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => setParsingSource(d?.parsingSource ?? 'api')).catch(() => setParsingSource('api'))
  }, [])

  if (parsingSource === null) return null
  if (parsingSource === 'drafts' || parsingSource === 'drafts_then_api') return <DraftsManager mode={parsingSource} />
  return <ParsingStatus />
}

// plan4: раздел «Черновые/Парсинг» скрыт (переход на self-events). Прямой заход на /drafts
// редиректит на главную; компонент Drafts (и ParsingStatus/DraftsManager выше) СОХРАНЁН в
// коде на случай возврата — просто не роутится и не показывается в навигации.
export default function Page() {
  const router = useRouter()
  useEffect(() => { router.replace('/triggers') }, [router])
  return null
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _KeepDraftsInBundle = Drafts   // ссылка, чтобы сохранённый компонент не считался мёртвым

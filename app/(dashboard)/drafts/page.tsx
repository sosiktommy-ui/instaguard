'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Globe, Zap, RotateCcw, Pencil, Check, X, Layers, Cookie } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ClientOnly from '@/components/common/ClientOnly'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { PageHeader } from '@/components/common/PageHeader'
import { IconTile } from '@/components/common/IconTile'
import { AddAccountModal } from '@/components/accounts/AddAccountModal'
import { ImportCookiesModal } from '@/components/accounts/ImportCookiesModal'
import { TONE } from '@/lib/colors'

interface HelperAccount {
  id: string
  username: string
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE'
  lastChecked: string | null
  errorCount: number
  proxy: string | null
}

function Drafts() {
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
      <PageHeader icon={Layers} color={TONE.alt} title="Черновые аккаунты" subtitle="Парсят подписчиков — основные только отправляют" tourId="page">
        <Button variant="secondary" onClick={() => setShowImport(true)}><Cookie className="w-4 h-4" /> Импорт списком</Button>
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Добавить</Button>
      </PageHeader>

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

      <ConfirmDialog
        open={Boolean(pendingDel)}
        title="Удалить черновой аккаунт?"
        message={`@${pendingDel?.username ?? ''} будет удалён. Парсинг для основных аккаунтов может остановиться, если это последний черновой.`}
        confirmLabel="Удалить"
        onConfirm={() => { const p = pendingDel; setPendingDel(null); if (p) handleDelete(p.id) }}
        onCancel={() => setPendingDel(null)}
      />

      {showAdd && (
        <AddAccountModal
          role="HELPER"
          title="Черновой аккаунт"
          subtitle="Для парсинга — не используется для отправки"
          defaultMode="cookies"
          onClose={() => setShowAdd(false)}
          onAdded={() => load()}
        />
      )}

      {showImport && (
        <ImportCookiesModal lockedRole="HELPER" onClose={() => setShowImport(false)} onDone={() => load()} />
      )}
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Drafts /></ClientOnly>
}

'use client'

import { useState } from 'react'
import { Plus, Play, Pause, Trash2, X, AtSign, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore, formatFollowers } from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { cn } from '@/lib/utils'

function AddModal({ onClose }: { onClose: () => void }) {
  const addAccount = useStore((s) => s.addAccount)
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [followers, setFollowers] = useState('')

  const save = () => {
    const clean = username.replace(/^@/, '').trim()
    if (!clean) return
    addAccount({ username: clean, fullName: fullName.trim() || undefined, followers: parseInt(followers) || 0 })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-md p-7 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[22px] font-semibold tracking-tight">Новый аккаунт</h2>
          <button onClick={onClose} className="text-subt hover:text-ink"><X size={22} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-[13px] text-subt font-medium block mb-2">Имя пользователя</label>
            <div className="relative">
              <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus className="field pl-10" placeholder="premium.brand" />
            </div>
          </div>
          <div>
            <label className="text-[13px] text-subt font-medium block mb-2">Отображаемое имя (необязательно)</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="field" placeholder="Premium Brand" />
          </div>
          <div>
            <label className="text-[13px] text-subt font-medium block mb-2">Подписчиков</label>
            <input type="number" value={followers} onChange={(e) => setFollowers(e.target.value)} className="field" placeholder="184200" />
          </div>
        </div>
        <div className="flex gap-3 mt-7">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Отмена</Button>
          <Button className="flex-1" onClick={save} disabled={!username.trim()}>Добавить</Button>
        </div>
      </div>
    </div>
  )
}

function Accounts() {
  const accounts = useStore((s) => s.accounts)
  const removeAccount = useStore((s) => s.removeAccount)
  const toggleStatus = useStore((s) => s.toggleAccountStatus)
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tighter leading-none">Основные аккаунты</h1>
          <p className="text-subt mt-1.5 text-[14px]">Аккаунты, на которых работают триггеры</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Добавить</Button>
      </div>

      {accounts.length === 0 ? (
        <div className="card p-16 text-center">
          <p className="text-subt">Нет аккаунтов</p>
          <Button className="mt-5 mx-auto" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Подключить первый</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((acc) => (
            <div key={acc.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold text-lg">
                    {acc.username[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-[15px]">@{acc.username}</div>
                    {acc.fullName && <div className="text-[13px] text-subt">{acc.fullName}</div>}
                  </div>
                </div>
                <span className={cn('flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-full',
                  acc.status === 'ACTIVE' ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', acc.status === 'ACTIVE' ? 'bg-ok' : 'bg-warn')} />
                  {acc.status === 'ACTIVE' ? 'Активен' : 'Пауза'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 mt-4 text-[13px] text-subt">
                <Users className="w-4 h-4" /> {formatFollowers(acc.followers)} подписчиков
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t border-black/[0.05]">
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => toggleStatus(acc.id)}>
                  {acc.status === 'ACTIVE' ? <><Pause className="w-3.5 h-3.5" /> Пауза</> : <><Play className="w-3.5 h-3.5" /> Запустить</>}
                </Button>
                <Button variant="danger" size="icon" onClick={() => removeAccount(acc.id)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Accounts /></ClientOnly>
}

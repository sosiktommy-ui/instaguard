'use client'

import { useState } from 'react'
import { Plus, X, FolderTree, Check, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SectionItem { id: string; parentId: string | null; name: string; accountCount?: number }

/**
 * Панель разделов/подразделов (папки пользователя) + фильтр списка аккаунтов.
 * План §C2. Двухуровневая иерархия, свободные названия.
 *  - Верхний ряд: «Все» + корневые разделы + «+ Раздел».
 *  - Нижний ряд (если выбран раздел): «Все в разделе» + подразделы + «+ Подраздел».
 */
export function SectionBar({
  sections, selSection, selSub, onSelect, onReload,
}: {
  sections: SectionItem[]
  selSection: string
  selSub: string
  onSelect: (section: string, sub: string) => void
  onReload: () => void
}) {
  const roots = sections.filter((s) => !s.parentId)
  const subs = sections.filter((s) => s.parentId === selSection)

  // Создание раздела/подраздела: parentId=null → корневой; parentId=<id> → подраздел
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<SectionItem | null>(null)

  const create = async () => {
    if (!name.trim() || !creating) return
    setBusy(true)
    try {
      const res = await fetch('/api/sections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), parentId: creating.parentId }),
      })
      if (res.ok) { setName(''); setCreating(null); onReload() }
    } finally { setBusy(false) }
  }

  const remove = async (s: SectionItem) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/sections/${s.id}`, { method: 'DELETE' })
      if (res.ok) {
        // если удалили выбранный раздел/подраздел — сбрасываем фильтр
        if (s.id === selSection) onSelect('', '')
        else if (s.id === selSub) onSelect(selSection, '')
        onReload()
      }
    } finally { setBusy(false); setConfirmDel(null) }
  }

  const chip = (active: boolean, label: string, count: number | undefined, onClick: () => void, onDel?: () => void) => (
    <span className={cn('group inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-xl text-[12.5px] font-medium border transition-colors cursor-pointer',
      active ? 'bg-brand text-white border-brand' : 'bg-black/[0.03] text-ink border-transparent hover:bg-black/[0.06]')}
      onClick={onClick}>
      {label}
      {typeof count === 'number' && <span className={cn('text-[11px]', active ? 'text-white/70' : 'text-subt')}>{count}</span>}
      {onDel && (
        <button onClick={(e) => { e.stopPropagation(); onDel() }}
          className={cn('opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-0.5',
            active ? 'hover:bg-white/20' : 'hover:bg-black/10')} title="Удалить раздел">
          <X className="w-3 h-3" />
        </button>
      )}
    </span>
  )

  const addBtn = (parentId: string | null, label: string) => (
    <button onClick={() => { setCreating({ parentId }); setName('') }}
      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[12.5px] font-medium text-subt hover:text-brand hover:bg-brand/[0.06] border border-dashed border-line hover:border-brand/40 transition-colors">
      <Plus className="w-3.5 h-3.5" /> {label}
    </button>
  )

  const inlineCreate = (
    <span className="inline-flex items-center gap-1 bg-white border border-brand/40 rounded-xl pl-3 pr-1 py-1">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(null) }}
        placeholder="название" className="outline-none text-[12.5px] w-28 bg-transparent" />
      <button onClick={create} disabled={busy || !name.trim()} className="p-1 text-ok hover:bg-ok/10 rounded-md disabled:opacity-40">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      </button>
      <button onClick={() => setCreating(null)} className="p-1 text-subt hover:bg-black/5 rounded-md"><X className="w-3.5 h-3.5" /></button>
    </span>
  )

  return (
    <div className="space-y-2">
      {/* Корневые разделы */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-subt font-medium pr-1">
          <FolderTree className="w-3.5 h-3.5" /> Разделы:
        </span>
        {chip(!selSection, 'Все', undefined, () => onSelect('', ''))}
        {roots.map((s) => chip(selSection === s.id && !selSub, s.name, s.accountCount, () => onSelect(s.id, ''), () => setConfirmDel(s)))}
        {creating && creating.parentId === null ? inlineCreate : addBtn(null, 'Раздел')}
      </div>

      {/* Подразделы выбранного раздела */}
      {selSection && (
        <div className="flex flex-wrap items-center gap-2 pl-5">
          {chip(!selSub, 'Все в разделе', undefined, () => onSelect(selSection, ''))}
          {subs.map((s) => chip(selSub === s.id, s.name, s.accountCount, () => onSelect(selSection, s.id), () => setConfirmDel(s)))}
          {creating && creating.parentId === selSection ? inlineCreate : addBtn(selSection, 'Подраздел')}
        </div>
      )}

      {/* Подтверждение удаления (план §D2) */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmDel(null)}>
          <div className="card w-full max-w-sm p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-2xl bg-bad/10 flex items-center justify-center mb-4"><Trash2 className="w-6 h-6 text-bad" /></div>
            <h3 className="font-semibold text-[17px] tracking-tight mb-1.5">Удалить раздел «{confirmDel.name}»?</h3>
            <p className="text-[13px] text-subt leading-relaxed mb-5">
              {confirmDel.parentId
                ? 'Аккаунты из этого подраздела останутся, но потеряют папку.'
                : 'Подразделы будут удалены, а аккаунты из них останутся без папки. Сами аккаунты не удаляются.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDel(null)} className="flex-1 py-2.5 rounded-2xl bg-black/[0.05] text-ink hover:bg-black/[0.08] text-[14px] font-medium transition-colors">Отмена</button>
              <button onClick={() => remove(confirmDel)} disabled={busy}
                className="flex-1 py-2.5 rounded-2xl bg-bad text-white hover:brightness-95 text-[14px] font-medium transition-all disabled:opacity-50">
                {busy ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

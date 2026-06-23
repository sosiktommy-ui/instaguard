'use client'

import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Condition {
  type: 'KEYWORDS' | 'REGEX' | 'USERNAME_LIST' | 'MIN_FOLLOWERS' | 'TIME_WINDOW'
  value: string
}

interface Action {
  type: 'SEND_MESSAGE' | 'SEND_CHAIN' | 'DELAY'
  templates?: string[]
  delayMin?: number
  delayMax?: number
}

interface RuleBuilderModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (rule: any) => void
}

export default function RuleBuilderModal({ isOpen, onClose, onSave }: RuleBuilderModalProps) {
  const [ruleName, setRuleName]       = useState('')
  const [triggerType, setTriggerType] = useState('NEW_FOLLOWER')
  const [responderId, setResponderId] = useState('')
  const [helperId, setHelperId]       = useState('')
  const [conditions, setConditions]   = useState<Condition[]>([
    { type: 'KEYWORDS', value: 'привет, hello' },
  ])
  const [actions, setActions] = useState<Action[]>([
    { type: 'SEND_MESSAGE', templates: ['Привет, @{{username}}! Спасибо за подписку.'] },
  ])

  const updateCondition = (index: number, patch: Partial<Condition>) =>
    setConditions(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)))

  const updateAction = (index: number, patch: Partial<Action>) =>
    setActions(actions.map((a, i) => (i === index ? { ...a, ...patch } : a)))

  const handleSave = () => {
    if (!ruleName.trim()) return
    onSave({
      name: ruleName,
      triggerType,
      responderId,
      helperId: helperId || undefined,
      conditions,
      actions,
      isActive: true,
    })
    // reset
    setRuleName(''); setResponderId(''); setHelperId('')
    setConditions([{ type: 'KEYWORDS', value: '' }])
    setActions([{ type: 'SEND_MESSAGE', templates: [''] }])
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 w-full max-w-4xl rounded-3xl overflow-hidden max-h-[92vh] flex flex-col border border-zinc-800">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-10 py-6 shrink-0">
          <h2 className="text-3xl font-semibold tracking-tighter">Новое правило</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <X size={28} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-10 space-y-10">

          {/* Name */}
          <div>
            <label className="text-sm text-zinc-500 block mb-3">Название правила</label>
            <input
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-6 py-5 text-xl focus:outline-none focus:border-white/30 transition-colors"
              placeholder="Приветствие новым подписчикам"
            />
          </div>

          {/* Trigger + Accounts */}
          <div className="grid grid-cols-3 gap-6">
            <div>
              <label className="text-sm text-zinc-500 block mb-3">Триггер</label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-6 py-4 text-base focus:outline-none focus:border-white/30"
              >
                <option value="NEW_FOLLOWER">Новый подписчик</option>
                <option value="NEW_COMMENT">Новый комментарий</option>
                <option value="NEW_LIKE">Новый лайк</option>
                <option value="NEW_DIRECT_MESSAGE">Новое сообщение в Direct</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-zinc-500 block mb-3">Responder</label>
              <input
                value={responderId}
                onChange={(e) => setResponderId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-6 py-4 focus:outline-none focus:border-white/30"
                placeholder="@premium.brand"
              />
            </div>
            <div>
              <label className="text-sm text-zinc-500 block mb-3">Helper (опционально)</label>
              <input
                value={helperId}
                onChange={(e) => setHelperId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-6 py-4 focus:outline-none focus:border-white/30"
                placeholder="@helper_parse"
              />
            </div>
          </div>

          {/* Conditions */}
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-semibold">Условия</h3>
              <Button
                onClick={() => setConditions([...conditions, { type: 'KEYWORDS', value: '' }])}
                variant="secondary"
              >
                <Plus className="mr-2 w-4 h-4" /> Добавить условие
              </Button>
            </div>
            <div className="space-y-3">
              {conditions.map((cond, i) => (
                <div key={i} className="flex gap-3 items-center bg-zinc-950 border border-zinc-800 rounded-2xl p-5">
                  <select
                    value={cond.type}
                    onChange={(e) => updateCondition(i, { type: e.target.value as Condition['type'] })}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 shrink-0 focus:outline-none"
                  >
                    <option value="KEYWORDS">Ключевые слова</option>
                    <option value="REGEX">Regex</option>
                    <option value="USERNAME_LIST">Список username</option>
                    <option value="MIN_FOLLOWERS">Мин. подписчиков</option>
                    <option value="TIME_WINDOW">Временное окно</option>
                  </select>
                  <input
                    value={cond.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    placeholder="Значение..."
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-3 focus:outline-none focus:border-white/20"
                  />
                  <button
                    onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))}
                    className="text-red-500 hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-semibold">Действия</h3>
              <Button
                onClick={() => setActions([...actions, { type: 'SEND_MESSAGE', templates: [''] }])}
                variant="secondary"
              >
                <Plus className="mr-2 w-4 h-4" /> Добавить действие
              </Button>
            </div>
            <div className="space-y-4">
              {actions.map((action, i) => (
                <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <select
                      value={action.type}
                      onChange={(e) => updateAction(i, { type: e.target.value as Action['type'] })}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 focus:outline-none"
                    >
                      <option value="SEND_MESSAGE">Отправить сообщение</option>
                      <option value="SEND_CHAIN">Отправить цепочку</option>
                      <option value="DELAY">Задержка</option>
                    </select>
                    <button
                      onClick={() => setActions(actions.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-red-400 transition-colors p-1"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  {action.type === 'SEND_MESSAGE' && (
                    <textarea
                      value={action.templates?.[0] ?? ''}
                      onChange={(e) => updateAction(i, { templates: [e.target.value] })}
                      className="w-full h-28 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 font-mono text-sm resize-none focus:outline-none focus:border-white/20"
                      placeholder="Текст сообщения... Поддерживается {{username}}"
                    />
                  )}

                  {action.type === 'DELAY' && (
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="text-xs text-zinc-500 block mb-2">Мин. секунд</label>
                        <input
                          type="number"
                          value={action.delayMin ?? 30}
                          onChange={(e) => updateAction(i, { delayMin: +e.target.value })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 focus:outline-none"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-zinc-500 block mb-2">Макс. секунд</label>
                        <input
                          type="number"
                          value={action.delayMax ?? 120}
                          onChange={(e) => updateAction(i, { delayMax: +e.target.value })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-10 py-7 flex justify-end gap-4 shrink-0">
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} size="lg" disabled={!ruleName.trim()}>
            Создать правило
          </Button>
        </div>
      </div>
    </div>
  )
}

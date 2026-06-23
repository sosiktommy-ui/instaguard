'use client'

import { useState } from 'react'
import { Plus, Edit3, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import RuleBuilderModal from '@/components/triggers/RuleBuilderModal'

interface TriggerRule {
  id: string
  name: string
  triggerType: string
  responder: string
  helper?: string
  isActive: boolean
  conditionsCount: number
}

const INITIAL_RULES: TriggerRule[] = [
  {
    id: '1',
    name: 'Приветствие новым подписчикам',
    triggerType: 'NEW_FOLLOWER',
    responder: '@premium.brand',
    helper: '@helper_parse',
    isActive: true,
    conditionsCount: 3,
  },
  {
    id: '2',
    name: 'Ответ на комментарии с ключевыми словами',
    triggerType: 'NEW_COMMENT',
    responder: '@premium.brand',
    isActive: false,
    conditionsCount: 5,
  },
]

export default function TriggersPage() {
  const [rules, setRules]           = useState<TriggerRule[]>(INITIAL_RULES)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const toggleRule = (id: string) =>
    setRules(rules.map((r) => (r.id === id ? { ...r, isActive: !r.isActive } : r)))

  const deleteRule = (id: string) =>
    setRules(rules.filter((r) => r.id !== id))

  const handleSaveRule = (newRule: any) => {
    setRules([
      ...rules,
      {
        id: Date.now().toString(),
        name: newRule.name,
        triggerType: newRule.triggerType,
        responder: newRule.responderId || '—',
        helper: newRule.helperId,
        isActive: newRule.isActive,
        conditionsCount: newRule.conditions?.length ?? 0,
      },
    ])
  }

  return (
    <div className="space-y-10">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-semibold tracking-tighter">Триггеры</h1>
          <p className="text-zinc-500 mt-3 text-lg">Автоматические правила реагирования</p>
        </div>
        <Button size="lg" className="rounded-2xl px-6 flex items-center gap-2" onClick={() => setIsModalOpen(true)}>
          <Plus className="w-5 h-5" />
          Новое правило
        </Button>
      </div>

      <div className="grid gap-4">
        {rules.length === 0 && (
          <div className="glass rounded-3xl p-16 text-center text-zinc-600">
            Нет правил. Создайте первое.
          </div>
        )}
        {rules.map((rule) => (
          <div key={rule.id} className="glass rounded-3xl p-8 group hover:border-white/20 transition-all">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-4">
                  <h3 className="text-2xl font-semibold">{rule.name}</h3>
                  <span className="px-3 py-1 text-xs font-mono bg-zinc-800 rounded-full">
                    {rule.triggerType.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-6 text-sm text-zinc-500">
                  <div>Responder: <span className="text-white">{rule.responder}</span></div>
                  {rule.helper && <div>Helper: <span className="text-white">{rule.helper}</span></div>}
                  <div>{rule.conditionsCount} условий</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={() => toggleRule(rule.id)} className="transition-all hover:scale-110">
                  {rule.isActive
                    ? <ToggleRight className="w-8 h-8 text-emerald-500" />
                    : <ToggleLeft  className="w-8 h-8 text-zinc-600" />
                  }
                </button>
                <Button variant="ghost" size="icon">
                  <Edit3 className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-red-500 hover:bg-red-950"
                  onClick={() => deleteRule(rule.id)}
                >
                  <Trash2 className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <RuleBuilderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveRule}
      />
    </div>
  )
}

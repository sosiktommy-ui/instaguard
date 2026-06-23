'use client'

import { useState } from 'react'
import { Plus, Copy, Trash2, Edit3 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Template {
  id: string
  name: string
  content: string
  category: string
  usageCount: number
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([
    {
      id: '1',
      name: 'Приветствие новому подписчику',
      content: 'Привет, @{{username}}! Спасибо, что подписался. Чем могу помочь?',
      category: 'Приветствия',
      usageCount: 124,
    },
    {
      id: '2',
      name: 'Ответ на комментарий',
      content: 'Рад, что тебе понравилось! 🔥 Есть вопросы по продукту?',
      category: 'Комментарии',
      usageCount: 87,
    },
    {
      id: '3',
      name: 'Follow-up через 2 часа',
      content: 'Ещё раз привет! Хотел уточнить — интересует что-то конкретное?',
      category: 'Цепочки',
      usageCount: 45,
    },
  ])

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="space-y-10">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-semibold tracking-tighter">Шаблоны сообщений</h1>
          <p className="text-zinc-500 mt-3 text-lg">Библиотека готовых ответов</p>
        </div>
        <Button size="lg" className="rounded-2xl px-6">
          <Plus className="mr-2 h-5 w-5" />
          Новый шаблон
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {templates.map((template) => (
          <div key={template.id} className="glass rounded-3xl p-8 hover:border-white/10 transition-all group">
            <div className="flex justify-between items-start mb-6">
              <div>
                <div className="font-semibold text-xl">{template.name}</div>
                <div className="text-sm text-zinc-500 mt-1">{template.category}</div>
              </div>
              <div className="text-xs px-3 py-1 bg-zinc-800 rounded-full text-zinc-400">
                {template.usageCount} использований
              </div>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 font-mono text-sm leading-relaxed mb-8 text-zinc-300">
              {template.content}
            </div>

            <div className="flex gap-3 opacity-70 group-hover:opacity-100 transition-all">
              <Button variant="secondary" className="flex-1" onClick={() => copyToClipboard(template.content)}>
                <Copy className="mr-2 h-4 w-4" />
                Копировать
              </Button>
              <Button variant="ghost" size="icon">
                <Edit3 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="text-red-500">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

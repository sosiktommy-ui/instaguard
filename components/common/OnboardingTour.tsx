'use client'

import { useState, useEffect } from 'react'
import { Rocket, UserPlus, Zap, Layers, FolderTree, ShieldCheck, ChevronLeft, ChevronRight, X, Check } from 'lucide-react'

const KEY = 'rg-onboarded'

interface Step { icon: any; color: string; title: string; text: string }

const STEPS: Step[] = [
  {
    icon: Rocket, color: '#663af1',
    title: 'Добро пожаловать в ReactiveGram!',
    text: 'Это сервис автоматических ответов в Instagram: новый подписчик, комментарий, лайк или сторис — бот сам напишет в директ, лайкнет, подпишется. Пройдём за минуту, как всё устроено.',
  },
  {
    icon: UserPlus, color: '#6a7df9',
    title: 'Шаг 1 — подключите аккаунт',
    text: 'На главной под списком нажмите «+ Аккаунт» — откроется окно. Войдите по логину/паролю или через куки, при желании укажите прокси. Аккаунт появится в списке.',
  },
  {
    icon: Zap, color: '#9b66ff',
    title: 'Шаг 2 — создайте кампанию',
    text: 'Блок «Создать кампанию» вверху уже раскрыт. Выберите аккаунт → событие (новая подписка, комментарий, лайк, сторис) → действия (директ, лайк, подписка, сторис) и текст сообщения. Нажмите «Создать».',
  },
  {
    icon: Layers, color: '#ff9f0a',
    title: 'Черновые аккаунты берегут основной',
    text: '«Грязную» работу (парсинг подписчиков, комментариев, лайков) делают черновые аккаунты — так основной аккаунт под меньшим риском бана. Добавьте хотя бы один черновой на вкладке «Черновые аккаунты».',
  },
  {
    icon: FolderTree, color: '#34c759',
    title: 'Разделы — папки для аккаунтов',
    text: 'Группируйте аккаунты по разделам и подразделам (например, «Польша → Краков») и фильтруйте список одним кликом. Кнопки «+ Раздел» / «+ Подраздел» — на главной.',
  },
  {
    icon: ShieldCheck, color: '#663af1',
    title: 'Готово! Следите за безопасностью',
    text: 'У каждого аккаунта есть «Индекс безопасности» и дневная загрузка лимитов — они показывают, насколько аккаунт защищён прямо сейчас. Можно начинать!',
  },
]

/** Обучающий тур при первом входе (после регистрации). Показывается один раз. */
export function OnboardingTour() {
  const [show, setShow] = useState(false)
  const [i, setI] = useState(0)

  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setShow(true) } catch {}
  }, [])

  const finish = () => {
    try { localStorage.setItem(KEY, '1') } catch {}
    setShow(false)
  }

  if (!show) return null
  const step = STEPS[i]
  const first = i === 0
  const last = i === STEPS.length - 1
  const Icon = step.icon

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="card w-full max-w-lg p-7 animate-scale-in relative">
        <button onClick={finish} className="absolute top-4 right-4 text-subt hover:text-ink transition-colors" title="Пропустить">
          <X className="w-5 h-5" />
        </button>

        <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-5"
          style={{ background: `linear-gradient(145deg, ${step.color}, ${step.color}cc)`, boxShadow: `0 10px 26px ${step.color}55` }}>
          <Icon className="w-8 h-8 text-white" />
        </div>

        <h2 className="text-[22px] font-semibold tracking-tight mb-2">{step.title}</h2>
        <p className="text-[14px] text-subt leading-relaxed min-h-[84px]">{step.text}</p>

        {/* Точки-прогресс */}
        <div className="flex items-center gap-1.5 my-5">
          {STEPS.map((_, idx) => (
            <button key={idx} onClick={() => setI(idx)}
              className="h-1.5 rounded-full transition-all"
              style={{ width: idx === i ? 22 : 7, background: idx === i ? step.color : 'rgba(0,0,0,0.12)' }} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button onClick={finish} className="text-[13px] text-subt hover:text-ink transition-colors">Пропустить</button>
          <div className="flex items-center gap-2">
            {!first && (
              <button onClick={() => setI(i - 1)}
                className="flex items-center gap-1 px-4 py-2.5 rounded-2xl bg-black/[0.05] text-ink hover:bg-black/[0.08] text-[14px] font-medium transition-colors">
                <ChevronLeft className="w-4 h-4" /> Назад
              </button>
            )}
            {last ? (
              <button onClick={finish}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-brand text-white hover:bg-brand-hover text-[14px] font-medium transition-colors">
                <Check className="w-4 h-4" /> Начать
              </button>
            ) : (
              <button onClick={() => setI(i + 1)}
                className="flex items-center gap-1 px-5 py-2.5 rounded-2xl bg-brand text-white hover:bg-brand-hover text-[14px] font-medium transition-colors">
                Далее <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

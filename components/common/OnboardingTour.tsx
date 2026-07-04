'use client'

import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, X, Check, MousePointerClick, Sparkles } from 'lucide-react'
import { ReactiveMascot } from './ReactiveMascot'

const KEY = 'rg-onboarded'

interface Step {
  route?: string        // сначала перейти на эту страницу
  target?: string       // CSS-селектор элемента для подсветки; нет → центр экрана
  title: string
  text: string
  cta?: string          // подпись у стрелки, напр. «Нажмите сюда»
}

const STEPS: Step[] = [
  {
    title: 'Привет! Я Reactive ⚡',
    text: 'Я твой помощник по ReactiveGram. За минуту покажу прямо на экране, где что находится и как запустить автоответы в Instagram. Поехали!',
  },
  {
    route: '/triggers', target: '[data-tour="create"]', cta: 'Здесь создаём',
    title: 'Шаг 1 — Создание кампании',
    text: 'Это сердце сервиса. Схема простая: выбираешь аккаунт → событие (новая подписка, комментарий, лайк, сторис) → что бот сделает (директ, лайк, подписка). Панель уже раскрыта.',
  },
  {
    route: '/triggers', target: '[data-tour="add-account"]', cta: 'Нажми «+ Аккаунт»',
    title: 'Шаг 2 — Аккаунты',
    text: 'Здесь твои Instagram-аккаунты. Нажми «+ Аккаунт», чтобы подключить первый — по логину/паролю или через куки, при желании с прокси.',
  },
  {
    route: '/triggers', target: '[data-tour="sections"]',
    title: 'Папки и фильтр',
    text: 'Группируй аккаунты по разделам и подразделам (например, «Польша → Краков») и фильтруй список одним кликом. Кнопки «+ Раздел» / «+ Подраздел» — здесь.',
  },
  {
    route: '/drafts', target: '[data-tour="page"]',
    title: 'Черновые аккаунты',
    text: '«Грязную» работу — парсинг подписчиков и комментариев — делают черновые аккаунты. Так основной под меньшим риском бана. Добавь хотя бы один черновой.',
  },
  {
    route: '/proxy', target: '[data-tour="page"]',
    title: 'Прокси',
    text: 'Пуловые прокси бот сам раздаёт аккаунтам при подключении. Добавь их в блоке «Добавить прокси в пул» — и включится режим «Авто».',
  },
  {
    route: '/settings', target: '[data-tour="page"]',
    title: 'Настройки',
    text: 'Тумблеры: разрешить работу без прокси или без черновых, дневные лимиты. Загляни сюда, если что-то не запускается.',
  },
  {
    route: '/triggers',
    title: 'Готово! 🚀',
    text: 'Ты видел всё главное. Начни с подключения аккаунта и первой кампании — а я всегда рядом. Удачи!',
  },
]

const PAD = 8

export function OnboardingTour() {
  const router = useRouter()
  const pathname = usePathname()
  const [show, setShow] = useState(false)
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  useEffect(() => { try { if (!localStorage.getItem(KEY)) setShow(true) } catch {} }, [])

  const step = STEPS[i]
  const finish = useCallback(() => { try { localStorage.setItem(KEY, '1') } catch {}; setShow(false) }, [])

  // Навигация на нужную страницу перед показом шага
  useEffect(() => {
    if (!show || !step) return
    if (step.route && pathname !== step.route) router.push(step.route)
  }, [show, i, step, pathname, router])

  // Поиск и измерение цели (с ретраями — элемент может появиться после перехода)
  useEffect(() => {
    if (!show || !step) return
    if (step.route && pathname !== step.route) return   // ждём смены страницы
    if (!step.target) { setRect(null); return }

    let raf = 0, tries = 0, cancelled = false
    const tick = () => {
      if (cancelled) return
      const el = document.querySelector(step.target!) as HTMLElement | null
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setTimeout(() => { if (!cancelled) setRect(el.getBoundingClientRect()) }, 280)
        return
      }
      if (tries++ < 60) raf = requestAnimationFrame(tick)
      else setRect(null)
    }
    tick()
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [show, i, step, pathname])

  // Пересчёт при ресайзе/скролле
  useEffect(() => {
    if (!show) return
    const on = () => {
      if (!step?.target) return
      const el = document.querySelector(step.target) as HTMLElement | null
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', on)
    window.addEventListener('scroll', on, true)
    return () => { window.removeEventListener('resize', on); window.removeEventListener('scroll', on, true) }
  }, [show, step])

  if (!show || !step) return null

  const first = i === 0
  const last = i === STEPS.length - 1
  const total = STEPS.length

  const controls = (
    <>
      <div className="flex items-center gap-1.5 my-4">
        {STEPS.map((_, idx) => (
          <button key={idx} onClick={() => setI(idx)} className="h-1.5 rounded-full transition-all"
            style={{ width: idx === i ? 22 : 7, background: idx === i ? '#663af1' : 'rgba(0,0,0,0.14)' }} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <button onClick={finish} className="text-[13px] text-subt hover:text-ink transition-colors">Пропустить</button>
        <div className="flex items-center gap-2">
          {!first && (
            <button onClick={() => setI(i - 1)} className="flex items-center gap-1 px-3.5 py-2.5 rounded-2xl bg-black/[0.05] text-ink hover:bg-black/[0.08] text-[14px] font-medium transition-colors">
              <ChevronLeft className="w-4 h-4" /> Назад
            </button>
          )}
          {last ? (
            <button onClick={finish} className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-brand text-white hover:bg-brand-hover text-[14px] font-medium transition-colors">
              <Check className="w-4 h-4" /> Начать
            </button>
          ) : (
            <button onClick={() => setI(i + 1)} className="flex items-center gap-1 px-5 py-2.5 rounded-2xl bg-brand text-white hover:bg-brand-hover text-[14px] font-medium transition-colors">
              Далее <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </>
  )

  // Центрированная карточка (welcome / finish / цель не найдена)
  if (!rect) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(10,8,25,0.62)' }}>
        <div className="card w-full max-w-lg p-7 animate-scale-in relative">
          <button onClick={finish} className="absolute top-4 right-4 text-subt hover:text-ink" title="Пропустить"><X className="w-5 h-5" /></button>
          <div className="flex items-start gap-4">
            <ReactiveMascot size={104} className="shrink-0 -mt-1" />
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand bg-brand/10 rounded-full px-2 py-0.5 mb-2">
                <Sparkles className="w-3 h-3" /> Reactive · {i + 1}/{total}
              </div>
              <h2 className="text-[21px] font-semibold tracking-tight mb-2">{step.title}</h2>
              <p className="text-[14px] text-subt leading-relaxed">{step.text}</p>
            </div>
          </div>
          {controls}
        </div>
      </div>
    )
  }

  // Прожектор на цель: 4 затемняющих панели вокруг + рамка-подсветка
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const hole = { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }

  // Позиция пузыря: под целью, если снизу есть место, иначе над
  const BUBBLE_W = 380, BUBBLE_H = 250, GAP = 18
  const below = hole.top + hole.height + GAP
  const placeBelow = vh - (hole.top + hole.height) > BUBBLE_H + GAP || hole.top < BUBBLE_H
  const bubbleTop = placeBelow ? below : Math.max(12, hole.top - GAP - BUBBLE_H)
  const bubbleLeft = Math.min(Math.max(12, hole.left + hole.width / 2 - BUBBLE_W / 2), vw - BUBBLE_W - 12)

  const dim = 'rgba(10,8,25,0.62)'
  const panel = (style: CSSProperties) => <div style={{ position: 'fixed', background: dim, ...style }} />

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Затемнение вокруг цели (4 панели), цель остаётся кликабельной */}
      {panel({ top: 0, left: 0, width: vw, height: Math.max(0, hole.top) })}
      {panel({ top: hole.top + hole.height, left: 0, width: vw, height: Math.max(0, vh - hole.top - hole.height) })}
      {panel({ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height })}
      {panel({ top: hole.top, left: hole.left + hole.width, width: Math.max(0, vw - hole.left - hole.width), height: hole.height })}

      {/* Рамка-подсветка */}
      <div className="tour-spot rounded-2xl" style={{ position: 'fixed', top: hole.top, left: hole.left, width: hole.width, height: hole.height, pointerEvents: 'none', boxShadow: '0 0 0 3px rgba(155,102,255,0.9)' }} />

      {/* Стрелка «Нажмите сюда» */}
      {step.cta && (
        <div style={{ position: 'fixed', top: placeBelow ? hole.top + hole.height + 4 : hole.top - 34, left: Math.min(hole.left + 8, vw - 160) }}
          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-brand rounded-full px-3 py-1.5 shadow-lg animate-fade-in">
          <MousePointerClick className="w-3.5 h-3.5" /> {step.cta}
        </div>
      )}

      {/* Пузырь с Reactive */}
      <div ref={bubbleRef} className="card animate-scale-in" style={{ position: 'fixed', top: bubbleTop, left: bubbleLeft, width: BUBBLE_W, padding: 20 }}>
        <button onClick={finish} className="absolute top-3 right-3 text-subt hover:text-ink" title="Пропустить"><X className="w-4 h-4" /></button>
        <div className="flex items-start gap-3">
          <ReactiveMascot size={72} className="shrink-0 -mt-1" />
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand bg-brand/10 rounded-full px-2 py-0.5 mb-1.5">
              <Sparkles className="w-3 h-3" /> Reactive · {i + 1}/{total}
            </div>
            <h3 className="text-[16px] font-semibold tracking-tight mb-1">{step.title}</h3>
            <p className="text-[13px] text-subt leading-relaxed">{step.text}</p>
          </div>
        </div>
        {controls}
      </div>
    </div>
  )
}

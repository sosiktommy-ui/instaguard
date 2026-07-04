'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useRef, type CSSProperties } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, X, Check, MousePointerClick, Sparkles } from 'lucide-react'
import { ReactiveMascot } from './ReactiveMascot'

const KEY = 'rg-onboarded'

interface Step {
  route?: string        // сначала перейти сюда
  target?: string       // CSS-селектор для подсветки; нет → центр экрана
  title: string
  text: string
  cta?: string          // подпись у стрелки, напр. «Нажмите сюда»
}

const STEPS: Step[] = [
  {
    title: 'Привет! Я Reactive ⚡',
    text: 'Я помогу освоить ReactiveGram за минуту. Покажу прямо на экране, где что находится и как запустить автоответы в Instagram. Жми «Далее».',
  },
  {
    route: '/triggers', target: '[data-tour="create"]', cta: 'Здесь создаём',
    title: 'Создание кампании',
    text: 'Сердце сервиса. Схема: аккаунт → событие (новая подписка, комментарий, лайк, сторис) → действия (директ, лайк, подписка). Панель уже раскрыта — потом заполните её.',
  },
  {
    route: '/triggers', target: '[data-tour="add-account"]', cta: 'Нажмите «+ Аккаунт»',
    title: 'Подключение аккаунта',
    text: 'Сначала добавьте аккаунт: логин/пароль или куки, при желании прокси. Без аккаунта кампанию не запустить.',
  },
  {
    route: '/triggers', target: '[data-tour="sections"]',
    title: 'Папки и фильтр',
    text: 'Группируйте аккаунты по разделам и подразделам (например, «Польша → Краков») и фильтруйте список одним кликом.',
  },
  {
    route: '/drafts', target: '[data-tour="page"]',
    title: 'Черновые аккаунты',
    text: 'Черновые «разведывают» события (кто подписался, кто оставил коммент), а основной аккаунт при этом не рискует баном. Добавьте хотя бы один — иначе автоматизация не работает.',
  },
  {
    route: '/proxy', target: '[data-tour="page"]',
    title: 'Прокси',
    text: 'Пуловые прокси бот сам раздаёт аккаунтам. Добавьте их в блоке «Добавить прокси в пул» — включится режим «Авто».',
  },
  {
    route: '/stats', target: '[data-tour="page"]',
    title: 'Статистика',
    text: 'Здесь общие цифры: срабатывания триггеров, выполненные действия, прирост подписчиков по всем аккаунтам.',
  },
  {
    route: '/settings', target: '[data-tour="page"]',
    title: 'Настройки и справка',
    text: 'Тумблеры «работать без прокси / без черновых», лимиты и кнопка «Пройти обучение» с описанием каждого раздела. Загляните сюда, если что-то не запускается.',
  },
  {
    route: '/triggers',
    title: 'Готово! 🚀',
    text: 'Порядок такой: подключите аккаунт → (по желанию черновой и прокси) → создайте кампанию. Повторить обучение можно в «Настройках». Удачи!',
  },
]

const PAD = 8       // отступ подсветки вокруг цели
const GAP = 16      // зазор между целью и пузырём
const M = 14        // минимальный отступ пузыря от краёв экрана

export function OnboardingTour() {
  const router = useRouter()
  const pathname = usePathname()
  const [show, setShow] = useState(false)
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  useEffect(() => { try { if (!localStorage.getItem(KEY)) setShow(true) } catch {} }, [])

  const step = STEPS[i]
  const finish = useCallback(() => { try { localStorage.setItem(KEY, '1') } catch {}; setShow(false) }, [])

  // Переход на нужную страницу перед показом шага
  useEffect(() => {
    if (!show || !step) return
    if (step.route && pathname !== step.route) router.push(step.route)
  }, [show, i, step, pathname, router])

  // Поиск и измерение цели (с ретраями — элемент появляется после перехода)
  useEffect(() => {
    if (!show || !step) return
    if (step.route && pathname !== step.route) return
    if (!step.target) { setRect(null); return }

    let raf = 0, tries = 0, cancelled = false
    const tick = () => {
      if (cancelled) return
      const el = document.querySelector(step.target!) as HTMLElement | null
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setTimeout(() => { if (!cancelled) { const e2 = document.querySelector(step.target!) as HTMLElement | null; setRect(e2 ? e2.getBoundingClientRect() : null) } }, 300)
        return
      }
      if (tries++ < 60) raf = requestAnimationFrame(tick)
      else setRect(null)
    }
    tick()
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [show, i, step, pathname])

  // Пересчёт цели при ресайзе/скролле
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

  // Позиционирование пузыря: измеряем его размер и выбираем сторону, где он помещается ЦЕЛИКОМ
  useLayoutEffect(() => {
    if (!rect || !bubbleRef.current) { setPos(null); return }
    const vw = window.innerWidth, vh = window.innerHeight
    const b = bubbleRef.current.getBoundingClientRect()
    const bw = b.width, bh = b.height
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
    const clampL = (l: number) => Math.min(Math.max(M, l), vw - bw - M)
    const clampT = (t: number) => Math.min(Math.max(M, t), vh - bh - M)

    const spaceBelow = vh - (rect.bottom + PAD)
    const spaceAbove = rect.top - PAD
    const spaceRight = vw - (rect.right + PAD)
    const spaceLeft = rect.left - PAD

    let top: number, left: number
    if (spaceBelow >= bh + GAP) { top = rect.bottom + PAD + GAP; left = clampL(cx - bw / 2) }
    else if (spaceAbove >= bh + GAP) { top = rect.top - PAD - GAP - bh; left = clampL(cx - bw / 2) }
    else if (spaceRight >= bw + GAP) { left = rect.right + PAD + GAP; top = clampT(cy - bh / 2) }
    else if (spaceLeft >= bw + GAP) { left = rect.left - PAD - GAP - bw; top = clampT(cy - bh / 2) }
    else { top = vh - bh - M; left = clampL(cx - bw / 2) }   // не влезает — прижимаем к низу

    setPos({ top: clampT(top), left: clampL(left) })
  }, [rect, i])

  if (!show || !step) return null

  const first = i === 0
  const last = i === STEPS.length - 1
  const total = STEPS.length
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const BUBBLE_W = Math.min(380, vw - M * 2)

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

  const bubbleInner = (
    <>
      <button onClick={finish} className="absolute top-3 right-3 text-subt hover:text-ink" title="Пропустить"><X className="w-4 h-4" /></button>
      <div className="flex items-start gap-3">
        <ReactiveMascot size={68} className="shrink-0 -mt-1" />
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand bg-brand/10 rounded-full px-2 py-0.5 mb-1.5">
            <Sparkles className="w-3 h-3" /> Reactive · {i + 1}/{total}
          </div>
          <h3 className="text-[16px] font-semibold tracking-tight mb-1">{step.title}</h3>
          <p className="text-[13px] text-subt leading-relaxed">{step.text}</p>
        </div>
      </div>
      {controls}
    </>
  )

  // Центрированная карточка (welcome / finish / цель не найдена)
  if (!rect) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(10,8,25,0.6)' }}>
        <div className="card w-full max-w-lg p-7 animate-scale-in relative">{bubbleInner}</div>
      </div>
    )
  }

  // Прожектор на цель: 4 затемняющих панели (цель остаётся видимой/кликабельной)
  const hole = { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
  const dim = 'rgba(10,8,25,0.6)'
  const panel = (style: CSSProperties) => <div style={{ position: 'fixed', background: dim, ...style }} />

  // Позиция стрелки-чипа: над целью, если пузырь снизу; иначе под целью
  const bubbleBelow = pos ? pos.top > hole.top : true
  const ctaTop = bubbleBelow ? Math.max(M, hole.top - 34) : hole.top + hole.height + 6
  const ctaLeft = Math.min(Math.max(M, hole.left), vw - 190)

  return (
    <div className="fixed inset-0 z-[70]">
      {panel({ top: 0, left: 0, width: vw, height: Math.max(0, hole.top) })}
      {panel({ top: hole.top + hole.height, left: 0, width: vw, height: Math.max(0, vh - hole.top - hole.height) })}
      {panel({ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height })}
      {panel({ top: hole.top, left: hole.left + hole.width, width: Math.max(0, vw - hole.left - hole.width), height: hole.height })}

      {/* рамка-подсветка */}
      <div className="tour-spot rounded-2xl" style={{ position: 'fixed', top: hole.top, left: hole.left, width: hole.width, height: hole.height, pointerEvents: 'none' }} />

      {/* стрелка «Нажмите сюда» */}
      {step.cta && (
        <div style={{ position: 'fixed', top: ctaTop, left: ctaLeft }}
          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-brand rounded-full px-3 py-1.5 shadow-lg animate-fade-in">
          <MousePointerClick className="w-3.5 h-3.5" /> {step.cta}
        </div>
      )}

      {/* пузырь (позиция вычислена; до вычисления — прозрачный, чтобы не мигал) */}
      <div ref={bubbleRef} className="card"
        style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: BUBBLE_W, padding: 20, opacity: pos ? 1 : 0, transition: 'opacity .15s' }}>
        {bubbleInner}
      </div>
    </div>
  )
}

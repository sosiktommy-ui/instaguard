'use client'

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, X, Check, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react'
import { ReactiveMascot } from './ReactiveMascot'

const KEY = 'rg-onboarded'

interface Step {
  route?: string        // сначала перейти сюда
  target?: string       // CSS-селектор для подсветки; нет → по центру экрана
  title: string
  text: string
  cta?: string          // подпись у указателя, напр. «Нажмите сюда»
}

const STEPS: Step[] = [
  {
    title: 'Привет! Я Reactive ⚡',
    text: 'Твой помощник. За минуту покажу прямо на экране, где что находится и как включить автоответы в Instagram. Погнали — жми «Далее».',
  },
  {
    route: '/triggers', target: '[data-tour="create"]', cta: 'Тут создаём',
    title: 'Здесь рождается магия ✨',
    text: 'Собираем цепочку: аккаунт → событие (подписка, коммент, лайк, сторис) → действие (директ, лайк, подписка). Панель уже открыта — заполнишь потом.',
  },
  {
    route: '/triggers', target: '[data-tour="add-account"]', cta: 'Жми сюда',
    title: 'Сначала — аккаунт',
    text: 'Подключи Instagram: по логину/паролю или по куки, при желании через прокси. Без аккаунта запускать нечего.',
  },
  {
    route: '/triggers', target: '[data-tour="sections"]', cta: 'Разделы тут',
    title: 'Папки для порядка',
    text: 'Много аккаунтов? Разложи их по разделам (например «Польша → Краков») и фильтруй список одним кликом.',
  },
  {
    route: '/drafts', target: '[data-tour="page"]', cta: 'Смотри сюда',
    title: 'Разведка — через API 🛰️',
    text: 'Кто подписался, кто комментит и лайкает — это собирает внешний скрейпер-API. Отдельные аккаунты и прокси для разведки не нужны, а основной аккаунт не рискует баном. Черновые аккаунты — опция, по умолчанию не требуются.',
  },
  {
    route: '/proxy', target: '[data-tour="page"]', cta: 'Прокси здесь',
    title: 'Прокси',
    text: 'Прокси в пуле я сам раздаю аккаунтам. Просто закинь их в блок «Добавить прокси в пул» — включится режим «Авто».',
  },
  {
    route: '/stats', target: '[data-tour="page"]', cta: 'Цифры тут',
    title: 'Статистика',
    text: 'Здесь всё в цифрах: срабатывания триггеров, выполненные действия и прирост подписчиков по всем аккаунтам.',
  },
  {
    route: '/settings', target: '[data-tour="page"]', cta: 'Настройки тут',
    title: 'Настройки и справка',
    text: 'Лимиты, режимы «без прокси / без черновых» и повтор обучения. Загляни сюда, если что-то не запускается.',
  },
  {
    route: '/triggers',
    title: 'Готово! 🚀',
    text: 'Порядок такой: подключи аккаунт → (по желанию черновой + прокси) → создай кампанию. Позвать меня снова можно в «Настройках». Удачи!',
  },
]

const PAD = 8       // отступ подсветки вокруг цели
const GAP = 52      // зазор между целью и «репликой» маскота (место под указатель)
const M = 14        // минимальный отступ от краёв экрана

type Side = 'top' | 'bottom' | 'left' | 'right'

export function OnboardingTour() {
  const router = useRouter()
  const pathname = usePathname()
  const [show, setShow] = useState(false)
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; side: Side } | null>(null)
  const unitRef = useRef<HTMLDivElement>(null)

  useEffect(() => { try { if (!localStorage.getItem(KEY)) setShow(true) } catch {} }, [])

  const step = STEPS[i]
  const first = i === 0
  const last = i === STEPS.length - 1
  const total = STEPS.length

  const finish = useCallback(() => { try { localStorage.setItem(KEY, '1') } catch {}; setShow(false) }, [])
  const next = useCallback(() => setI((v) => Math.min(v + 1, STEPS.length - 1)), [])
  const prev = useCallback(() => setI((v) => Math.max(v - 1, 0)), [])

  // Клавиатура: → / Enter — далее, ← — назад, Esc — пропустить
  useEffect(() => {
    if (!show) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { last ? finish() : next() }
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, last, finish, next, prev])

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
        setTimeout(() => { if (!cancelled) { const e2 = document.querySelector(step.target!) as HTMLElement | null; setRect(e2 ? e2.getBoundingClientRect() : null) } }, 320)
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

  // Позиционирование «реплики» (маскот + пузырь): выбираем сторону, где она помещается ЦЕЛИКОМ
  useLayoutEffect(() => {
    if (!rect || !unitRef.current) { setPos(null); return }
    const vw = window.innerWidth, vh = window.innerHeight
    const b = unitRef.current.getBoundingClientRect()
    const bw = b.width, bh = b.height
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
    const clampL = (l: number) => Math.min(Math.max(M, l), vw - bw - M)
    const clampT = (t: number) => Math.min(Math.max(M, t), vh - bh - M)

    const spaceBelow = vh - (rect.bottom + PAD)
    const spaceAbove = rect.top - PAD
    const spaceRight = vw - (rect.right + PAD)
    const spaceLeft = rect.left - PAD

    let top: number, left: number, side: Side
    if (spaceBelow >= bh + GAP) { side = 'bottom'; top = rect.bottom + PAD + GAP; left = clampL(cx - bw / 2) }
    else if (spaceAbove >= bh + GAP) { side = 'top'; top = rect.top - PAD - GAP - bh; left = clampL(cx - bw / 2) }
    else if (spaceRight >= bw + GAP) { side = 'right'; left = rect.right + PAD + GAP; top = clampT(cy - bh / 2) }
    else if (spaceLeft >= bw + GAP) { side = 'left'; left = rect.left - PAD - GAP - bw; top = clampT(cy - bh / 2) }
    else { side = 'bottom'; top = vh - bh - M; left = clampL(cx - bw / 2) }

    setPos({ top: clampT(top), left: clampL(left), side })
  }, [rect, i])

  if (!show || !step) return null

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200

  // ── Сам блок «реплики»: маскот без рамки + пузырь с хвостиком ──
  const narrator = (
    <div className="flex items-end gap-0 tour-in" style={{ maxWidth: 'min(94vw, 430px)' }}>
      <ReactiveMascot size={112} className="mascot-glow shrink-0 relative z-10 translate-y-1" />
      <div
        className="relative -ml-3 bg-white rounded-3xl border border-black/[0.06] px-5 py-4"
        style={{ boxShadow: '0 10px 40px rgba(31,38,80,0.18), 0 2px 6px rgba(0,0,0,0.06)', minWidth: 220 }}
      >
        {/* хвостик пузыря к маскоту */}
        <span className="absolute left-[-6px] bottom-6 w-3.5 h-3.5 bg-white border-l border-b border-black/[0.06] rotate-45" />

        <button onClick={finish} className="absolute top-2.5 right-2.5 text-subt hover:text-ink transition-colors" title="Пропустить (Esc)">
          <X className="w-4 h-4" />
        </button>

        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand bg-brand/10 rounded-full px-2 py-0.5 mb-1.5">
          Reactive · {i + 1}/{total}
        </div>
        <h3 className="text-[16px] font-semibold tracking-tight mb-1 pr-4">{step.title}</h3>
        <p className="text-[13px] text-subt leading-relaxed">{step.text}</p>

        {/* прогресс */}
        <div className="flex items-center gap-1.5 my-3.5">
          {STEPS.map((_, idx) => (
            <button key={idx} onClick={() => setI(idx)} className="h-1.5 rounded-full transition-all"
              style={{ width: idx === i ? 22 : 7, background: idx === i ? '#663af1' : 'rgba(0,0,0,0.14)' }} />
          ))}
        </div>

        {/* кнопки */}
        <div className="flex items-center justify-between gap-3">
          <button onClick={finish} className="text-[13px] text-subt hover:text-ink transition-colors">Пропустить</button>
          <div className="flex items-center gap-2">
            {!first && (
              <button onClick={prev} className="flex items-center gap-1 px-3.5 py-2.5 rounded-2xl bg-black/[0.05] text-ink hover:bg-black/[0.08] text-[14px] font-medium transition-colors">
                <ChevronLeft className="w-4 h-4" /> Назад
              </button>
            )}
            {last ? (
              <button onClick={finish} className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-brand text-white hover:bg-brand-hover text-[14px] font-medium transition-colors">
                <Check className="w-4 h-4" /> Начать
              </button>
            ) : (
              <button onClick={next} className="flex items-center gap-1 px-5 py-2.5 rounded-2xl bg-brand text-white hover:bg-brand-hover text-[14px] font-medium transition-colors">
                Далее <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  // ── Приветствие / финал / цель не найдена: по центру, лёгкое затемнение ──
  if (!rect) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(14,11,34,0.46)' }}>
        {narrator}
      </div>
    )
  }

  // ── Указатель у цели: стрелка прыгает В СТОРОНУ цели с той стороны, где стоит маскот ──
  const hole = { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
  const side = pos?.side ?? 'bottom'
  // маскот стоит со стороны `side` → стрелка указывает НА цель (противоположно)
  const arrowMap = {
    bottom: { Icon: ArrowUp, cls: 'tp-up' },     // реплика снизу → стрелка вверх
    top: { Icon: ArrowDown, cls: 'tp-down' },
    right: { Icon: ArrowLeft, cls: 'tp-left' },
    left: { Icon: ArrowRight, cls: 'tp-right' },
  } as const
  const { Icon, cls } = arrowMap[side]

  // позиция чипа-указателя: между целью и репликой
  const CHIP_GAP = 8
  let chipStyle: { top?: number; left?: number; transform?: string } = {}
  if (side === 'bottom') chipStyle = { top: hole.top + hole.height + CHIP_GAP, left: hole.left + hole.width / 2, transform: 'translateX(-50%)' }
  else if (side === 'top') chipStyle = { top: Math.max(M, hole.top - 40), left: hole.left + hole.width / 2, transform: 'translateX(-50%)' }
  else if (side === 'right') chipStyle = { top: hole.top + hole.height / 2, left: hole.left + hole.width + CHIP_GAP, transform: 'translateY(-50%)' }
  else chipStyle = { top: hole.top + hole.height / 2, left: Math.max(M, hole.left - 150), transform: 'translateY(-50%)' }

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Кольцо-подсветка цели (тень-«прожектор» затемняет фон ЛЕГКО, цель кликабельна) */}
      <div className="tour-spot rounded-2xl" style={{ position: 'fixed', top: hole.top, left: hole.left, width: hole.width, height: hole.height, pointerEvents: 'none' }} />

      {/* Указатель «смотри сюда» */}
      {step.cta && (
        <div style={{ position: 'fixed', zIndex: 2, ...chipStyle }}
          className="flex items-center gap-1.5 text-[13px] font-semibold text-white bg-brand rounded-full pl-2.5 pr-3.5 py-1.5 shadow-lg pointer-events-none">
          <Icon className={`w-4 h-4 ${cls}`} /> {step.cta}
        </div>
      )}

      {/* Реплика маскота (позиция вычислена; до вычисления — прозрачная, чтобы не мигала) */}
      <div ref={unitRef}
        style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: Math.min(430, vw - M * 2), opacity: pos ? 1 : 0, transition: 'top .25s, left .25s, opacity .15s' }}>
        {narrator}
      </div>
    </div>
  )
}

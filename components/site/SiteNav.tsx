'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { SiteLogoMark } from './SiteLogo'

const NAV_LINKS = [
  { label: 'Возможности', href: '#features' },
  { label: 'Как работает', href: '#how' },
  { label: 'Тарифы', href: '#pricing' },
  { label: 'Демо', href: '/lp/demo' },
  { label: 'Вопросы', href: '#faq' },
]

export function SiteNav({ solid = false }: { solid?: boolean }) {
  const [open, setOpen] = useState(false)

  // Вошёл ли пользователь — от этого зависят кнопки справа: гость → «Войти/Начать»,
  // вошедший → «Кабинет» + «Перейти к функционалу» (в приложение). Лёгкая проверка /api/auth/me.
  const [authed, setAuthed] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { authed: false }))
      .then((d) => { if (alive) setAuthed(Boolean(d?.authed)) })
      .catch(() => { if (alive) setAuthed(false) })
    return () => { alive = false }
  }, [])

  // блокируем прокрутку body под открытым меню
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // scroll-spy: подсвечиваем раздел, в котором пользователь сейчас находится.
  // Считаем по позиции скролла (надёжнее IntersectionObserver в неактивной вкладке).
  const [active, setActive] = useState('')
  useEffect(() => {
    const hashLinks = NAV_LINKS.filter((l) => l.href.startsWith('#'))
    if (!hashLinks.length) return
    const onScroll = () => {
      const line = window.scrollY + window.innerHeight * 0.4
      let best = '', bestDist = Infinity
      for (const l of hashLinks) {
        const el = document.getElementById(l.href.slice(1))
        if (!el) continue
        const top = el.getBoundingClientRect().top + window.scrollY
        const bottom = top + el.offsetHeight
        if (line >= top && line < bottom) { best = l.href; bestDist = -1; break }
        const d = Math.min(Math.abs(line - top), Math.abs(line - bottom))
        if (d < bestDist) { bestDist = d; best = l.href }
      }
      setActive((prev) => (prev === best ? prev : best))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll) }
  }, [])

  return (
    <header className={`rg-nav${solid ? ' rg-nav-solid' : ''}`}>
      <div className="rg-container rg-nav-inner">
        <Link href="/lp" className="rg-logo" aria-label="ReactiveGram — на главную">
          <SiteLogoMark className="rg-logo-mark" />
          ReactiveGram
        </Link>

        <nav className="rg-nav-links" aria-label="Основная навигация">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`rg-nav-link${active === l.href ? ' active' : ''}`}
              aria-current={active === l.href ? 'true' : undefined}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="rg-nav-right">
          {authed ? (
            <>
              <Link href="/account" className="rg-btn rg-btn-light">Кабинет</Link>
              <Link href="/triggers" className="rg-btn rg-btn-primary">Перейти к функционалу</Link>
            </>
          ) : (
            <>
              <Link href="/login" className="rg-btn rg-btn-light">Войти</Link>
              <Link href="/register" className="rg-btn rg-btn-primary">Начать</Link>
            </>
          )}
        </div>

        <button className="rg-burger" onClick={() => setOpen(true)} aria-label="Открыть меню">
          <Menu size={20} />
        </button>
      </div>

      {open && (
        <>
          <div className="rg-sheet-backdrop" onClick={() => setOpen(false)} />
          <aside className="rg-sheet" role="dialog" aria-label="Меню">
            <div className="rg-sheet-head">
              <span className="rg-logo"><SiteLogoMark className="rg-logo-mark" />ReactiveGram</span>
              <button className="rg-burger" onClick={() => setOpen(false)} aria-label="Закрыть меню">
                <X size={20} />
              </button>
            </div>
            <nav className="rg-sheet-links">
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href} className="rg-sheet-link" onClick={() => setOpen(false)}>{l.label}</a>
              ))}
            </nav>
            <div className="rg-sheet-cta">
              {authed ? (
                <>
                  <Link href="/triggers" className="rg-btn rg-btn-primary rg-btn-lg" onClick={() => setOpen(false)}>Перейти к функционалу</Link>
                  <Link href="/account" className="rg-btn rg-btn-light rg-btn-lg" onClick={() => setOpen(false)}>Кабинет</Link>
                </>
              ) : (
                <>
                  <Link href="/register" className="rg-btn rg-btn-primary rg-btn-lg" onClick={() => setOpen(false)}>Начать</Link>
                  <Link href="/login" className="rg-btn rg-btn-light rg-btn-lg" onClick={() => setOpen(false)}>Войти</Link>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </header>
  )
}

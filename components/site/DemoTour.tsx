'use client'

import { useState, type ReactNode } from 'react'
import { Instagram, Check, MessageCircle, UserPlus, CircleDot, Heart } from 'lucide-react'

type Step = { t: string; d: string; screen: ReactNode }

const STEPS: Step[] = [
  {
    t: 'Подключите Instagram',
    d: 'Безопасно, за пару кликов',
    screen: (
      <>
        <h3>Подключение аккаунта</h3>
        <p className="sub">Аккаунт подключается один раз — дальше всё работает само.</p>
        <div className="rg-mock-item">
          <span className="rg-mock-ava" />
          <div className="grow"><div className="nm">@your.brand</div><div className="mt">Личный / бизнес-аккаунт</div></div>
          <span className="rg-mock-ok"><Check size={15} /> Подключён</span>
        </div>
        <span className="rg-mock-chip"><Instagram size={15} /> Доступ можно отозвать в любой момент</span>
      </>
    ),
  },
  {
    t: 'Выберите триггер',
    d: 'На что реагировать',
    screen: (
      <>
        <h3>Что запускает ответ</h3>
        <p className="sub">Выберите событие, на которое сервис будет реагировать автоматически.</p>
        <div>
          <span className="rg-mock-chip" style={{ background: 'var(--rg-accent)', color: '#fff', borderColor: 'transparent' }}><UserPlus size={15} /> Новая подписка</span>
          <span className="rg-mock-chip"><MessageCircle size={15} /> Комментарий</span>
          <span className="rg-mock-chip"><CircleDot size={15} /> Ответ на сторис</span>
          <span className="rg-mock-chip"><Heart size={15} /> Лайк</span>
        </div>
      </>
    ),
  },
  {
    t: 'Настройте сообщение',
    d: 'Что отправить в ответ',
    screen: (
      <>
        <h3>Сообщение в директ</h3>
        <p className="sub">Напишите текст или возьмите готовый шаблон. Обращение по имени — автоматически.</p>
        <p className="rg-mock-label">ТЕКСТ ОТВЕТА</p>
        <div className="rg-mock-input">Привет, {'{имя}'}! 💜 Спасибо за подписку — держите обещанный гайд, а если будут вопросы, пишите прямо сюда.</div>
        <span className="rg-mock-chip">{'{имя}'}</span>
        <span className="rg-mock-chip">{'{ссылка}'}</span>
      </>
    ),
  },
  {
    t: 'Смотрите результат',
    d: 'Ответы и заявки',
    screen: (
      <>
        <h3>Журнал: всё под контролем</h3>
        <p className="sub">Видно каждое действие — что и когда сработало.</p>
        <div className="rg-mock-bubble rg-mock-in">Новый подписчик @katya</div>
        <div className="rg-mock-bubble rg-mock-out">Приветствие отправлено в директ ✓</div>
        <div className="rg-mock-item">
          <span className="rg-mock-ava" />
          <div className="grow"><div className="nm">@maxim прокомментировал</div><div className="mt">«Хочу прайс 🔥» → ответ + сообщение в директ</div></div>
          <span className="rg-mock-ok"><Check size={15} /> Готово</span>
        </div>
      </>
    ),
  },
]

export function DemoTour() {
  const [active, setActive] = useState(0)
  return (
    <div className="rg-demo">
      <div className="rg-demo-steps">
        {STEPS.map((s, i) => (
          <button key={s.t} className={`rg-demo-step${active === i ? ' on' : ''}`} onClick={() => setActive(i)}>
            <span className="n">{i + 1}</span>
            <span><span className="t">{s.t}</span><span className="d">{s.d}</span></span>
          </button>
        ))}
      </div>
      <div className="rg-demo-screen">
        <span className="rg-demo-note">Демо-режим · без реальных действий</span>
        {STEPS[active].screen}
      </div>
    </div>
  )
}

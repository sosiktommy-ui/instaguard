import Link from 'next/link'
import {
  UserPlus, MessageCircle, CircleDot, Heart, UserCheck, BarChart3,
  Check, ShieldCheck, Zap, SlidersHorizontal, Clock, ArrowRightCircle,
} from 'lucide-react'

// ---------- полоса доверия (честные возможности, без выдуманных цифр) ----------
const TRUST = [
  { icon: ShieldCheck, text: 'Личные и бизнес-аккаунты' },
  { icon: Zap, text: 'Ответы за секунды' },
  { icon: SlidersHorizontal, text: 'Вы всё контролируете' },
  { icon: Clock, text: 'Работает 24/7' },
]

export function TrustBar() {
  return (
    <section className="rg-section" style={{ paddingTop: 0 }}>
      <div className="rg-container rg-trust">
        {TRUST.map((t) => (
          <span key={t.text} className="rg-trust-chip"><t.icon size={17} strokeWidth={2.4} /> {t.text}</span>
        ))}
      </div>
    </section>
  )
}

// ---------- возможности ----------
const FEATURES = [
  { icon: UserPlus, grad: 'linear-gradient(135deg,#8134af,#dd2a7b)', title: 'Приветствие новым подписчикам', text: 'Каждый новый подписчик сразу получает тёплое сообщение в директ — знакомство начинается за секунду.' },
  { icon: MessageCircle, grad: 'linear-gradient(135deg,#dd2a7b,#f58529)', title: 'Ответы на комментарии', text: 'Комментарий с ключевым словом → мгновенный ответ и личное сообщение в директ. Ни один запрос не теряется.' },
  { icon: CircleDot, grad: 'linear-gradient(135deg,#8134af,#515bd4)', title: 'Ответы на сторис', text: 'Реакции и ответы на ваши сторис не остаются без внимания — диалог продолжается автоматически.' },
  { icon: Heart, grad: 'linear-gradient(135deg,#f58529,#dd2a7b)', title: 'Лайки и подписки в ответ', text: 'Автоматическая забота о лояльности: аудитория чувствует внимание, вы не тратите время.' },
  { icon: UserCheck, grad: 'linear-gradient(135deg,#515bd4,#8134af)', title: 'Авто-приём заявок', text: 'Закрытый аккаунт? Заявки в подписчики принимаются сами — и сразу запускают приветствие.' },
  { icon: BarChart3, grad: 'linear-gradient(135deg,#dd2a7b,#8134af)', title: 'Журнал и статистика', text: 'Видно, что и когда сработало. Полный контроль над каждым действием — прозрачно и понятно.' },
]

export function Features() {
  return (
    <section id="features" className="rg-section">
      <div className="rg-container">
        <div className="rg-section-head">
          <span className="rg-eyebrow">Возможности</span>
          <h2 className="rg-h2">Всё, чтобы не терять клиентов в Instagram</h2>
          <p className="rg-lead">Подписки, комментарии, сторис и реакции превращаются в диалоги и заявки — на автопилоте.</p>
        </div>
        <div className="rg-grid-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rg-card">
              <div className="rg-card-ic" style={{ background: f.grad }}><f.icon size={24} strokeWidth={2.2} /></div>
              <h3 className="rg-card-title">{f.title}</h3>
              <p className="rg-card-text">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------- как это работает ----------
const STEPS = [
  { title: 'Регистрация', text: 'Создайте аккаунт за минуту — email или Google.' },
  { title: 'Подключите Instagram', text: 'Безопасно, в пару кликов. Доступ можно отозвать в любой момент.' },
  { title: 'Настройте ответ', text: 'Выберите триггер и напишите сообщение — или возьмите готовый шаблон.' },
  { title: 'Получайте клиентов', text: 'Ответы уходят автоматически, заявки собираются к вам.' },
]

export function HowItWorks() {
  return (
    <section id="how" className="rg-section rg-section-alt">
      <div className="rg-container">
        <div className="rg-section-head">
          <span className="rg-eyebrow">Как это работает</span>
          <h2 className="rg-h2">Запуск за 15 минут — без технических сложностей</h2>
          <p className="rg-lead">Никакого кода и настроек «для айтишников». Четыре простых шага.</p>
        </div>
        <div className="rg-steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rg-step">
              <div className="rg-step-num">{i + 1}</div>
              <h3 className="rg-step-title">{s.title}</h3>
              <p className="rg-step-text">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------- кому подходит ----------
const USE_CASES = [
  { tag: 'Блогерам и экспертам', h: 'Раздавайте гайды на автопилоте', items: ['«Гайд» в комментах → материал уходит в директ сам', 'Каждый новый подписчик получает приветствие', 'Больше вовлечённости без выгорания в директе'] },
  { tag: 'SMM и агентствам', h: 'Все аккаунты в одном месте', items: ['Несколько клиентских аккаунтов под одной панелью', 'Единые сценарии ответов и приветствий', 'Прозрачный журнал действий по каждому'] },
  { tag: 'Бизнесу', h: 'Отвечайте и собирайте заявки', items: ['Быстрые ответы на «сколько стоит?» и «есть в наличии?»', 'Сбор контактов, пока менеджер занят', 'Ни один клиент не остаётся без ответа'] },
]

export function UseCases() {
  return (
    <section className="rg-section">
      <div className="rg-container">
        <div className="rg-section-head">
          <span className="rg-eyebrow">Кому подходит</span>
          <h2 className="rg-h2">Работает под вашу задачу</h2>
        </div>
        <div className="rg-grid-3">
          {USE_CASES.map((u) => (
            <div key={u.tag} className="rg-uc">
              <span className="rg-uc-tag">{u.tag}</span>
              <h3>{u.h}</h3>
              <ul className="rg-uc-list">
                {u.items.map((it) => (<li key={it}><Check size={17} strokeWidth={2.5} /> {it}</li>))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------- финальный CTA ----------
export function FinalCta() {
  return (
    <section className="rg-section">
      <div className="rg-container">
        <div className="rg-final">
          <h2>Начните получать больше клиентов из Instagram уже сегодня</h2>
          <p>Подключение за 15 минут — первые ответы уходят в тот же день.</p>
          <div className="rg-final-cta">
            <Link href="/lp/pricing" className="rg-btn rg-btn-white">Начать сейчас <ArrowRightCircle size={20} /></Link>
            <Link href="/register" className="rg-btn rg-btn-white-ghost">Посмотреть демо</Link>
          </div>
          <div className="rg-final-note">Отмена в любой момент · Поможем с настройкой</div>
        </div>
      </div>
    </section>
  )
}

// ---------- футер ----------
export function SiteFooter() {
  return (
    <footer className="rg-footer">
      <div className="rg-container">
        <div className="rg-footer-top">
          <div className="rg-footer-brand">
            <span className="rg-logo">ReactiveGram</span>
            <p className="rg-footer-desc">Автоматические ответы и вовлечение в Instagram. Превращайте активность аудитории в клиентов — 24/7.</p>
          </div>
          <div className="rg-footer-col">
            <h4>Продукт</h4>
            <a href="#features">Возможности</a>
            <a href="#how">Как работает</a>
            <a href="#pricing">Тарифы</a>
            <Link href="/lp/demo">Демо</Link>
          </div>
          <div className="rg-footer-col">
            <h4>Аккаунт</h4>
            <Link href="/login">Войти</Link>
            <Link href="/register">Регистрация</Link>
          </div>
          <div className="rg-footer-col">
            <h4>Правовое</h4>
            <a href="#">Оферта</a>
            <a href="#">Политика конфиденциальности</a>
            <a href="#">Контакты</a>
          </div>
        </div>
        <div className="rg-footer-bottom">© {new Date().getFullYear()} ReactiveGram. Все права защищены.</div>
      </div>
    </footer>
  )
}

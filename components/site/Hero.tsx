import Link from 'next/link'
import { ArrowRightCircle, Check, Zap, MessageCircle, Clock } from 'lucide-react'

// Фоновое 3D-видео.
// ▸ ЧТОБЫ ПОСТАВИТЬ СВОЁ: положи файл в  public/video/hero.mp4  — он подхватится автоматически.
// ▸ Пока своего файла нет — играет временный ПЛЕЙСХОЛДЕР по URL ниже (тот же, что в промпте-референсе).
//   Содержимое видео (3D-фишки) кодом изменить нельзя — это видеомонтаж; заменяется целым файлом.
const PLACEHOLDER_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260518_003132_8b7edcb6-c64d-4a52-a9ca-879942e122ad.mp4'

const BULLETS = ['Не теряете ни одного клиента', 'Работает 24/7', 'Настройка за 15 минут']

export function Hero() {
  return (
    <section className="rg-hero">
      {/* фон: светлый градиент-запаска → видео поверх → осветляющий тинт для читаемости текста */}
      <div className="rg-video-fallback" />
      <video className="rg-video" autoPlay muted loop playsInline>
        {/* своё видео (если положишь public/video/hero.mp4) — приоритетно; иначе плейсхолдер */}
        <source src="/video/hero.mp4" type="video/mp4" />
        <source src={PLACEHOLDER_VIDEO} type="video/mp4" />
      </video>
      <div className="rg-video-tint" />

      <div className="rg-hero-body">
        <div className="rg-container">
          <div className="rg-hero-content">
            <div className="rg-badge rg-fadeup rg-d1">
              <span className="rg-dot" /> Автоматизация Instagram
            </div>

            <h1 className="rg-h1 rg-fadeup rg-d1">
              <span className="rg-hi"><Zap size={28} strokeWidth={2.5} /></span>
              Отвечайте каждому
              <span className="rg-hi"><MessageCircle size={26} strokeWidth={2.5} /></span>
              в Instagram — автоматически, 24/7
              <span className="rg-hi"><Clock size={26} strokeWidth={2.5} /></span>
            </h1>

            <p className="rg-sub rg-fadeup rg-d2">
              Ноль стресса, полный контроль. ReactiveGram мгновенно отвечает новым подписчикам,
              на комментарии и ответы на сторис — и превращает активность аудитории в клиентов,
              пока вы заняты своим делом.
            </p>

            <div className="rg-cta-row rg-fadeup rg-d3">
              <Link href="/lp/pricing" className="rg-btn rg-btn-primary rg-btn-lg rg-cta-primary">
                Начать сейчас <ArrowRightCircle size={20} />
              </Link>
              <Link href="/register" className="rg-btn rg-btn-light rg-btn-lg">
                Посмотреть демо
              </Link>
            </div>

            <ul className="rg-bullets rg-fadeup rg-d4">
              {BULLETS.map((b) => (
                <li key={b} className="rg-bullet"><Check size={17} strokeWidth={2.5} /> {b}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

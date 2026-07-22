import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'super-secret-jwt-key-change-in-production'
)
// Секрет для внутренних вызовов (авто-поллинг из instrumentation → /api/poll)
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'instaguard-internal-cron'

// Пути, доступные без входа.
// `/stats3d/index.html` — статический шаблон 3D-диаграммы статистики (§13.13),
// встраивается в /stats через iframe. Данных пользователя НЕ содержит: реальные
// числа приходят в него от родительской (уже авторизованной) страницы по postMessage.
// Публичен намеренно, чтобы iframe гарантированно рендерился (без завязки на куку).
// `/api/webhooks/stripe` — Stripe шлёт события БЕЗ куки; аутентификация там по ПОДПИСИ вебхука
// (STRIPE_WEBHOOK_SECRET), а не по сессии, поэтому путь публичный.
const PUBLIC_PATHS = new Set<string>(['/login', '/register', '/api/auth/login', '/api/auth/register', '/stats3d/index.html', '/api/webhooks/stripe'])

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Внутренний вызов авто-поллинга — по секрету в заголовке
  if (pathname === '/api/poll' && req.headers.get('x-internal-secret') === INTERNAL_SECRET) {
    return NextResponse.next()
  }

  const token = req.cookies.get('auth-token')?.value
  let valid = false
  if (token) {
    try { await jwtVerify(token, JWT_SECRET); valid = true } catch { valid = false }
  }

  if (valid) {
    // Уже вошёл — не пускаем обратно на страницы входа/регистрации
    if (pathname === '/login' || pathname === '/register') return NextResponse.redirect(new URL('/', req.url))
    return NextResponse.next()
  }

  // Не вошёл
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next()
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL('/login', req.url)
  return NextResponse.redirect(url)
}

// Пропускаем статику, картинки и служебные пути Next
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}

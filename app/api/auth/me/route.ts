import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

export const runtime = 'nodejs'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'super-secret-jwt-key-change-in-production',
)

// Лёгкая проверка «вошёл ли пользователь» для публичного сайта (SiteNav решает, что показать:
// «Войти/Начать» гостю или «Перейти к функционалу/Кабинет» вошедшему). Без БД, всегда 200.
export async function GET(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value
  if (!token) return NextResponse.json({ authed: false })
  try {
    await jwtVerify(token, JWT_SECRET)
    return NextResponse.json({ authed: true })
  } catch {
    return NextResponse.json({ authed: false })
  }
}

import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'super-secret-jwt-key-change-in-production'
)

export async function createSession(userId: string, email: string) {
  const token = await new SignJWT({ userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)

  const store = await cookies()
  store.set('auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return token
}

export async function getCurrentUser() {
  const store = await cookies()
  const token = store.get('auth-token')?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return { id: payload.userId as string, email: payload.email as string }
  } catch {
    return null
  }
}

/**
 * Возвращает текущего пользователя по JWT-сессии, а если её нет —
 * первого пользователя в БД. Приложение по факту однопользовательское
 * (см. /api/accounts и /api/accounts/auth), поэтому без валидного куки
 * не должно падать с Unauthorized.
 */
/**
 * Приложение однопользовательское: все данные принадлежат первому (владельцу) аккаунту.
 * Доступ к страницам/API закрывает middleware по сессии; здесь возвращаем владельца данных,
 * чтобы вход под демо-аккаунтом всё равно показывал те же триггеры/аккаунты.
 */
export async function getUserOrFirst() {
  const first = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, email: true } })
  return first ? { id: first.id, email: first.email } : null
}

export async function logout() {
  const store = await cookies()
  store.delete('auth-token')
}

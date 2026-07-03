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
 * Пользователь текущей сессии (мультитенант, план A). Раньше возвращал «первого в БД»
 * (однопользовательский режим) — теперь строго по JWT-куке, чтобы данные были
 * изолированы по userId. Имя оставлено прежним, чтобы не трогать все импорты в API.
 * Доступ к /api/* уже закрывает middleware, поэтому здесь просто отдаём юзера сессии.
 */
export async function getUserOrFirst() {
  return getCurrentUser()
}

export async function logout() {
  const store = await cookies()
  store.delete('auth-token')
}

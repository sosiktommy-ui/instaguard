import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashSync } from 'bcryptjs'
import { createSession } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/rateLimit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  try {
    // Анти-спам регистраций (§10.1): не более 5 новых аккаунтов с одного IP за час.
    const rl = rateLimit(`register:${clientIp(req)}`, 5, 60 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Слишком много регистраций. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    const { email, password, name } = await req.json().catch(() => ({}))
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''

    if (!cleanEmail || !password) {
      return NextResponse.json({ error: 'Email и пароль обязательны' }, { status: 400 })
    }
    if (!EMAIL_RE.test(cleanEmail)) {
      return NextResponse.json({ error: 'Неверный формат email' }, { status: 400 })
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: 'Пароль должен быть не короче 6 символов' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email: cleanEmail }, select: { id: true } })
    if (existing) {
      return NextResponse.json({ error: 'Пользователь с таким email уже существует' }, { status: 409 })
    }

    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        name: typeof name === 'string' && name.trim() ? name.trim() : null,
        password: hashSync(String(password), 10),
        plan: 'free',
      },
      select: { id: true, email: true },
    })

    await createSession(user.id, user.email)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

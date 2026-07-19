import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { compareSync } from 'bcryptjs'
import { createSession } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  try {
    // Анти-брутфорс (§10.1): не более 10 попыток входа с одного IP за 10 минут.
    const rl = rateLimit(`login:${clientIp(req)}`, 10, 10 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Слишком много попыток входа. Попробуйте позже.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }

    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email и пароль обязательны' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !compareSync(password, user.password)) {
      return NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })
    }

    await createSession(user.id, user.email)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 })
  }
}

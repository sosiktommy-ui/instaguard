import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { compareSync, hashSync } from 'bcryptjs'
import { rateLimit, clientIp } from '@/lib/rateLimit'

// Смена пароля из личного кабинета. Требует текущий пароль (защита от угона живой сессии),
// ограничена по частоте (анти-брутфорс), новый пароль хешируется bcrypt — как в register/login.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = rateLimit(`pwd:${clientIp(req)}`, 5, 15 * 60_000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Слишком много попыток. Попробуйте позже.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const { currentPassword, newPassword } = await req.json().catch(() => ({}))
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Заполните оба поля' }, { status: 400 })
  }
  if (String(newPassword).length < 6) {
    return NextResponse.json({ error: 'Новый пароль должен быть не короче 6 символов' }, { status: 400 })
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { password: true } })
  if (!dbUser || !compareSync(String(currentPassword), dbUser.password)) {
    return NextResponse.json({ error: 'Текущий пароль неверный' }, { status: 400 })
  }

  await prisma.user.update({ where: { id: user.id }, data: { password: hashSync(String(newPassword), 10) } })
  return NextResponse.json({ ok: true })
}

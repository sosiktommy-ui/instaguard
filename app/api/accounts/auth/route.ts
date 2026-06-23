import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loginByCredentials } from '@/lib/instagram/client'

export async function POST(req: NextRequest) {
  try {
    const { username, password, proxy } = await req.json()

    if (!username || !password) {
      return NextResponse.json({ error: 'Username и пароль обязательны' }, { status: 400 })
    }

    const clean = username.replace(/^@/, '').trim().toLowerCase()

    let sessionData: object
    try {
      const result = await loginByCredentials(clean, password, proxy || undefined)
      sessionData = result.sessionData
    } catch (e: any) {
      return NextResponse.json({
        error: `Ошибка Instagram: ${e.message ?? 'Неверный логин или пароль'}`,
      }, { status: 400 })
    }

    const user = await prisma.user.findFirst()
    if (!user) {
      return NextResponse.json({ error: 'Нет пользователя в БД. Запустите seed.' }, { status: 500 })
    }

    const existing = await prisma.instagramAccount.findFirst({ where: { username: clean } })

    const account = existing
      ? await prisma.instagramAccount.update({
          where: { id: existing.id },
          data: { sessionData, status: 'ACTIVE', lastChecked: new Date(), proxy: proxy || null },
        })
      : await prisma.instagramAccount.create({
          data: {
            userId: user.id,
            username: clean,
            role: 'RESPONDER',
            sessionData,
            proxy: proxy || null,
            status: 'ACTIVE',
          },
        })

    return NextResponse.json({ ok: true, account: { id: account.id, username: account.username, status: account.status } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Ошибка сервера' }, { status: 500 })
  }
}

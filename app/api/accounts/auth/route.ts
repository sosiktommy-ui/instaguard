import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loginByCredentials, loginByCookies } from '@/lib/instagram/client'

export async function POST(req: NextRequest) {
  try {
    const { username, password, proxy, authMethod, cookies } = await req.json()

    let sessionData: object
    let clean = ''

    if (authMethod === 'cookies') {
      if (!cookies) return NextResponse.json({ error: 'Куки обязательны' }, { status: 400 })

      let parsedCookies: object
      try {
        parsedCookies = typeof cookies === 'string' ? JSON.parse(cookies) : cookies
      } catch {
        // treat as raw sessionid string
        parsedCookies = { sessionid: (cookies as string).trim() }
      }

      try {
        const result = await loginByCookies(parsedCookies, proxy || undefined)
        sessionData = result.sessionData
        clean = result.username
      } catch (e: any) {
        return NextResponse.json({ error: e.message ?? 'Ошибка авторизации через куки' }, { status: 400 })
      }
    } else {
      if (!username || !password) {
        return NextResponse.json({ error: 'Username и пароль обязательны' }, { status: 400 })
      }
      clean = username.replace(/^@/, '').trim().toLowerCase()
      try {
        const result = await loginByCredentials(clean, password, proxy || undefined)
        if (result.needsChallenge || !result.sessionData) {
          return NextResponse.json({
            needsChallenge: true,
            stepName: result.stepName,
            username: result.username ?? clean,
            error: 'Instagram требует подтверждение (challenge). Введите код из письма/SMS.',
          }, { status: 202 })
        }
        sessionData = result.sessionData
      } catch (e: any) {
        return NextResponse.json({ error: e.message ?? 'Неверный логин или пароль' }, { status: 400 })
      }
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

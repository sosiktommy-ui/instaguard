import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loginByCredentials, loginByCookies } from '@/lib/instagram/client'
import { getCurrentUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { username, password, proxy, authMethod, cookies, role, sectionId, proxyMode } = await req.json()
    const accountRole: 'RESPONDER' | 'HELPER' | 'BOTH' = role === 'HELPER' ? 'HELPER' : 'RESPONDER'
    const section = typeof sectionId === 'string' && sectionId ? sectionId : null

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

    // Аккаунт принадлежит пользователю текущей сессии (мультитенант)
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
    }

    // Раздел должен принадлежать этому же пользователю, иначе не назначаем
    let validSection: string | null = null
    if (section) {
      const sec = await prisma.section.findFirst({ where: { id: section, userId: user.id }, select: { id: true } })
      validSection = sec ? sec.id : null
    }

    // Прокси: авто (взять из пула по свободной ёмкости) или уникальный (введён вручную).
    // Строковый account.proxy оставляем — им пользуются воркеры; proxyId — для управления/пула.
    let proxyUrl: string | null = typeof proxy === 'string' && proxy.trim() ? proxy.trim() : null
    let proxyId: string | null = null
    if (proxyMode === 'auto') {
      const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } })
      const cap = settings?.accountsPerProxy ?? 3
      const pool = await prisma.proxy.findMany({
        where: { userId: user.id, kind: 'pool' },
        select: { id: true, url: true, _count: { select: { accounts: true } } },
        orderBy: { createdAt: 'asc' },
      })
      const free = pool.filter((p) => p._count.accounts < cap).sort((a, b) => a._count.accounts - b._count.accounts)[0]
      if (!free) {
        return NextResponse.json({ error: 'В пуле нет свободных прокси. Добавьте на вкладке «Прокси» или выберите «Уникальный».' }, { status: 400 })
      }
      proxyUrl = free.url
      proxyId = free.id
    } else if (proxyUrl) {
      // Уникальный (ручной) — заводим/переиспользуем индивидуальный прокси
      const found = await prisma.proxy.findFirst({ where: { userId: user.id, url: proxyUrl } })
      const p = found ?? await prisma.proxy.create({ data: { userId: user.id, url: proxyUrl, kind: 'individual' } })
      proxyId = p.id
    }

    const existing = await prisma.instagramAccount.findFirst({ where: { username: clean, userId: user.id } })

    const account = existing
      ? await prisma.instagramAccount.update({
          where: { id: existing.id },
          data: { sessionData, status: 'ACTIVE', lastChecked: new Date(), proxy: proxyUrl, proxyId, role: accountRole, sectionId: validSection },
        })
      : await prisma.instagramAccount.create({
          data: {
            userId: user.id,
            username: clean,
            role: accountRole,
            sessionData,
            proxy: proxyUrl,
            proxyId,
            status: 'ACTIVE',
            sectionId: validSection,
          },
        })

    return NextResponse.json({ ok: true, account: { id: account.id, username: account.username, status: account.status } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Ошибка сервера' }, { status: 500 })
  }
}

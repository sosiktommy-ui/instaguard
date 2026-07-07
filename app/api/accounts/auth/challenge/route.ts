import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { submitChallengeCode, submitTwoFactorCode } from '@/lib/instagram/client'
import { getCurrentUser } from '@/lib/auth'
import { persistInstagramAccount, type AccountRole } from '@/lib/accountPersist'
import { isInstagramBlacklist, markProxyBlocked } from '@/lib/proxyPool'

/**
 * Шаг 2 входа по логину/паролю: пользователь ввёл код из письма/SMS (challenge).
 * Тело: { username, code, proxyId?, role?, sectionId? } — контекст пришёл из ответа 202
 * роута /api/accounts/auth. proxyId → URL прокси достаём из БД сами (клиенту логин:пароль
 * прокси не отдаём). Сам код challenge отправляет воркер сессией того же прокси, что и
 * при /login (он хранит challenge-сессию с прокси внутри).
 */
export async function POST(req: NextRequest) {
  try {
    const { username, code, proxyId, role, sectionId, mode } = await req.json()
    const is2fa = mode === '2fa'

    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

    const clean = String(username ?? '').replace(/^@/, '').trim().toLowerCase()
    const codeClean = String(code ?? '').replace(/\D/g, '').trim()
    if (!clean) return NextResponse.json({ error: 'Не указан аккаунт' }, { status: 400 })
    if (!codeClean) return NextResponse.json({ error: 'Введите код подтверждения' }, { status: 400 })

    // proxyId → URL из БД (только свой прокси). Аккаунт сохраним с тем же прокси, что и при входе.
    let proxyUrl: string | null = null
    let validProxyId: string | null = null
    if (typeof proxyId === 'string' && proxyId) {
      const p = await prisma.proxy.findFirst({ where: { id: proxyId, userId: user.id }, select: { id: true, url: true } })
      if (p) { proxyUrl = p.url; validProxyId = p.id }
    }

    // Раздел — только свой
    let validSection: string | null = null
    if (typeof sectionId === 'string' && sectionId) {
      const sec = await prisma.section.findFirst({ where: { id: sectionId, userId: user.id }, select: { id: true } })
      validSection = sec ? sec.id : null
    }

    const accountRole: AccountRole = role === 'HELPER' ? 'HELPER' : role === 'BOTH' ? 'BOTH' : 'RESPONDER'

    let sessionData: object
    try {
      const result = is2fa
        ? await submitTwoFactorCode(clean, codeClean)
        : await submitChallengeCode(clean, codeClean)
      sessionData = result.sessionData
    } catch (e: any) {
      const raw = String(e?.message ?? 'Не удалось подтвердить код')
      if (isInstagramBlacklist(raw) && validProxyId) await markProxyBlocked(validProxyId)
      return NextResponse.json({ error: raw }, { status: 400 })
    }

    const account = await persistInstagramAccount({
      userId: user.id,
      username: clean,
      sessionData,
      proxyUrl,
      proxyId: validProxyId,
      role: accountRole,
      sectionId: validSection,
    })

    return NextResponse.json({ ok: true, account: { id: account.id, username: account.username, status: account.status } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Ошибка сервера' }, { status: 500 })
  }
}

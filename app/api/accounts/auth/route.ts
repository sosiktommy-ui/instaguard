import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loginByCredentials, loginByCookies } from '@/lib/instagram/client'
import { getCurrentUser } from '@/lib/auth'
import { normalizeCookies } from '@/lib/cookies'
import { pickPoolProxy } from '@/lib/proxyPool'

// host:port прокси без логина/пароля — чтобы в ошибке было видно, ЧЕРЕЗ КАКОЙ IP шёл вход
// (сверить с вердиктом «Проверить IP»: датацентр этот адрес или резидентный).
function proxyHostLabel(url: string | null): string {
  if (!url) return 'без прокси (IP сервера)'
  let s = url.replace(/^\w+:\/\//, '')
  if (s.includes('@')) s = s.split('@').pop() as string
  return s.split(':').slice(0, 2).join(':')
}

export async function POST(req: NextRequest) {
  try {
    const { username, password, proxy, authMethod, cookies, role, sectionId, proxyMode, totpSecret } = await req.json()
    const accountRole: 'RESPONDER' | 'HELPER' | 'BOTH' = role === 'HELPER' ? 'HELPER' : 'RESPONDER'
    const section = typeof sectionId === 'string' && sectionId ? sectionId : null

    // Аккаунт принадлежит пользователю текущей сессии (мультитенант).
    // ВАЖНО: пользователя и прокси определяем ДО логина, чтобы самый первый вход
    // (самое палевное действие для свежего аккаунта) шёл уже через прокси, а не с IP сервера.
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

    // ── Прокси: определяем ДО логина ──────────────────────────────────────────
    // Строковый account.proxy используют воркеры; proxyId — для управления/пула.
    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } })
    const allowNoProxy = settings?.allowNoProxy ?? false
    const cap = settings?.accountsPerProxy ?? 3
    const manualProxy: string | null = typeof proxy === 'string' && proxy.trim() ? proxy.trim() : null

    let proxyUrl: string | null = manualProxy
    let proxyId: string | null = null

    // Нужно взять прокси из пула, если: явный «авто», ИЛИ прокси не задан вручную и
    // работа без прокси НЕ разрешена (тогда подключаем автоматически из пула — «первый вход через прокси»).
    const needPool = proxyMode === 'auto' || (!manualProxy && !allowNoProxy)

    if (needPool) {
      // Подбор: пропускаем мёртвые прокси, предпочитаем «чистые» (см. lib/proxyPool).
      const pick = await pickPoolProxy(user.id, cap)
      if (pick.ok) {
        proxyUrl = pick.url
        proxyId = pick.id
      } else if (proxyMode === 'auto' || !allowNoProxy) {
        // Прокси обязателен, но нет пригодного → НЕ входим без прокси (иначе риск мгновенного бана).
        return NextResponse.json({
          error: pick.reason === 'all-dead'
            ? 'Все свободные прокси в пуле не отвечают. Нажмите «Проверить все» на вкладке «Прокси» — годные (✅) подсветятся, мёртвые/датацентр отсеются.'
            : 'В пуле нет свободных прокси. Добавьте прокси на вкладке «Прокси», укажите уникальный вручную, либо включите «Работать без прокси» в Настройках.',
        }, { status: 400 })
      }
      // allowNoProxy=true и пригодного прокси нет → продолжаем без прокси (осознанно разрешено)
    } else if (manualProxy) {
      // Уникальный (ручной) — заводим/переиспользуем индивидуальный прокси
      const found = await prisma.proxy.findFirst({ where: { userId: user.id, url: manualProxy } })
      const p = found ?? await prisma.proxy.create({ data: { userId: user.id, url: manualProxy, kind: 'individual' } })
      proxyId = p.id
    }
    // ──────────────────────────────────────────────────────────────────────────

    let sessionData: object
    let clean = ''

    if (authMethod === 'cookies') {
      if (!cookies) return NextResponse.json({ error: 'Куки обязательны' }, { status: 400 })

      // Надёжный разбор: массив Cookie-Editor / JSON-объект / строка k=v / сырой sessionid / мобильная сессия.
      const norm = normalizeCookies(typeof cookies === 'string' ? cookies : JSON.stringify(cookies))
      if (norm.error) return NextResponse.json({ error: norm.error }, { status: 400 })

      try {
        const result = await loginByCookies(norm.cookies, proxyUrl || undefined)
        sessionData = result.sessionData
        clean = result.username
      } catch (e: any) {
        const msg = `${e.message ?? 'Ошибка авторизации через куки'}\n\n🌐 Вход шёл через прокси: ${proxyHostLabel(proxyUrl)}`
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    } else {
      if (!username || !password) {
        return NextResponse.json({ error: 'Username и пароль обязательны' }, { status: 400 })
      }
      clean = username.replace(/^@/, '').trim().toLowerCase()
      try {
        const result = await loginByCredentials(clean, password, proxyUrl || undefined, typeof totpSecret === 'string' && totpSecret.trim() ? totpSecret.trim() : undefined)
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
        const msg = `${e.message ?? 'Неверный логин или пароль'}\n\n🌐 Вход шёл через прокси: ${proxyHostLabel(proxyUrl)}`
        return NextResponse.json({ error: msg }, { status: 400 })
      }
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

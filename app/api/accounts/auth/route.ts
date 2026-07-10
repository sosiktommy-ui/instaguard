import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { browserLogin, browserLoginByCookies } from '@/lib/browser/client'
import { getCurrentUser } from '@/lib/auth'
import { pickPoolProxy, isInstagramBlacklist, isAccountNotFound, markProxyBlocked } from '@/lib/proxyPool'
import { persistInstagramAccount } from '@/lib/accountPersist'
import { localeForCountry } from '@/lib/browser/geo'

// Достать логин/пароль/2FA/почту из мобильной Android-сессии («логин:пароль[:2fa]|UA|…||почта:пароль»).
// Нужно для ФОЛБЭКА куки→пароль: если вставленная сессия отклонена Instagram, пробуем войти
// теми же логином/паролем, что зашиты в этой же строке.
function parseMobileSessionCreds(raw: string): { login?: string; password?: string; totp?: string; emailLogin?: string; emailPassword?: string } | null {
  if (typeof raw !== 'string' || !raw.includes('|')) return null
  const segs = raw.split('|')
  const cparts = (segs[0] ?? '').trim().split(':')
  const login = cparts[0]?.trim()
  const password = cparts[1]?.trim()
  if (!login || !password) return null
  const totp = cparts[2] && /^[A-Z2-7\s]{12,}$/i.test(cparts[2].trim()) ? cparts[2].trim().replace(/\s+/g, '') : undefined
  let emailLogin: string | undefined, emailPassword: string | undefined
  const mailSeg = segs.map((s) => s.trim()).find((s) => /\S+@\S+:\S+/.test(s))
  if (mailSeg) { const ai = mailSeg.indexOf(':'); emailLogin = mailSeg.slice(0, ai).trim(); emailPassword = mailSeg.slice(ai + 1).trim() }
  return { login, password, totp, emailLogin, emailPassword }
}

// host:port прокси без логина/пароля — чтобы в ошибке было видно, ЧЕРЕЗ КАКОЙ IP шёл вход.
function proxyHostLabel(url: string | null): string {
  if (!url) return 'без прокси (IP сервера)'
  let s = url.replace(/^\w+:\/\//, '')
  if (s.includes('@')) s = s.split('@').pop() as string
  return s.split(':').slice(0, 2).join(':')
}

export async function POST(req: NextRequest) {
  try {
    const { username, password, proxy, authMethod, cookies, role, sectionId, proxyMode, totpSecret, emailLogin, emailPassword } = await req.json()
    const accountRole: 'RESPONDER' | 'HELPER' | 'BOTH' = role === 'HELPER' ? 'HELPER' : 'RESPONDER'
    const section = typeof sectionId === 'string' && sectionId ? sectionId : null
    const emLogin = typeof emailLogin === 'string' && emailLogin.trim() ? emailLogin.trim() : null
    const emPass = typeof emailPassword === 'string' && emailPassword ? emailPassword : null

    // Пользователя и прокси определяем ДО логина — первый вход должен идти уже через прокси.
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

    let validSection: string | null = null
    if (section) {
      const sec = await prisma.section.findFirst({ where: { id: section, userId: user.id }, select: { id: true } })
      validSection = sec ? sec.id : null
    }

    // ── Прокси: определяем ДО логина ──────────────────────────────────────────
    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } })
    const allowNoProxy = settings?.allowNoProxy ?? false
    const cap = settings?.accountsPerProxy ?? 3
    const manualProxy: string | null = typeof proxy === 'string' && proxy.trim() ? proxy.trim() : null

    let proxyUrl: string | null = manualProxy
    let proxyId: string | null = null
    let proxyCountry: string | null = null
    const needPool = proxyMode === 'auto' || (!manualProxy && !allowNoProxy)

    if (needPool) {
      const pick = await pickPoolProxy(user.id, cap)
      if (pick.ok) { proxyUrl = pick.url; proxyId = pick.id; proxyCountry = pick.country }
      else if (proxyMode === 'auto' || !allowNoProxy) {
        return NextResponse.json({
          error: pick.reason === 'all-dead'
            ? 'Все свободные прокси в пуле не отвечают. Нажмите «Проверить все» на вкладке «Прокси» — годные (✅) подсветятся, мёртвые/датацентр отсеются.'
            : 'В пуле нет свободных прокси. Добавьте прокси на вкладке «Прокси», укажите уникальный вручную, либо включите «Работать без прокси» в Настройках.',
        }, { status: 400 })
      }
    } else if (manualProxy) {
      const found = await prisma.proxy.findFirst({ where: { userId: user.id, url: manualProxy } })
      const p = found ?? await prisma.proxy.create({ data: { userId: user.id, url: manualProxy, kind: 'individual' } })
      proxyId = p.id
      proxyCountry = p.country
    }
    // Гео отпечатка (locale/timezoneId) по стране прокси — plan.md §349. Страна прокси не
    // известна (ручной прокси без проверки/пул без сохранённой страны) → geo=null → воркер
    // сам возьмёт дефолт (en-US/America/New_York), как и раньше — регрессии нет.
    const geo = localeForCountry(proxyCountry)
    // ──────────────────────────────────────────────────────────────────────────

    let browserState: object | null = null
    let loginMethod: 'browser' | 'cookies' = 'browser'
    let clean = ''
    // Почта из мобильной строки (для persist, если в теле запроса её не передали).
    let mobileEmail: string | null = null
    let mobileEmailPass: string | null = null

    if (authMethod === 'cookies') {
      if (!cookies) return NextResponse.json({ error: 'Куки обязательны' }, { status: 400 })
      const cookieStr = typeof cookies === 'string' ? cookies : JSON.stringify(cookies)
      const creds = parseMobileSessionCreds(cookieStr)
      if (creds?.emailLogin) { mobileEmail = creds.emailLogin; mobileEmailPass = creds.emailPassword ?? null }
      try {
        // Браузер: принимаем storageState/куки как есть — воркер соберёт и проверит сессию.
        const result = await browserLoginByCookies(cookieStr, proxyUrl || undefined, geo?.locale, geo?.timezoneId)
        browserState = result.browserState
        clean = result.username
        loginMethod = 'cookies'
      } catch (cookieErr: any) {
        const cookieRaw = String(cookieErr?.message ?? 'Ошибка авторизации через куки')
        // ── ФОЛБЭК: куки отклонены → пробуем вход ЛОГИНОМ/ПАРОЛЕМ из той же строки ──
        // (по запросу пользователя). Работает только на браузерном движке и если в мобильной
        // сессии есть логин:пароль. Гео-проблему это не лечит (тот же прокси), но покрывает
        // случай «сессия устарела, а пароль живой».
        if (creds?.login && creds?.password) {
          try {
            const result = await browserLogin(creds.login, creds.password, proxyUrl || undefined, creds.totp, geo?.locale, geo?.timezoneId)
            if (result.needsCheckpoint || result.needs2fa || !result.browserState) {
              const is2fa = Boolean(result.needs2fa)
              return NextResponse.json({
                needsChallenge: is2fa ? undefined : true,
                needs2fa: is2fa || undefined,
                stepName: is2fa ? '2fa' : 'challenge',
                sentTo: result.channel ?? null,
                username: result.username ?? creds.login,
                proxyId, role: accountRole, sectionId: validSection,
                emailLogin: mobileEmail, emailPassword: mobileEmailPass,
                note: 'Куки не приняты — переключился на вход по логину/паролю из этой же строки.',
                error: is2fa
                  ? 'Куки отклонены. Пробую логин/пароль → Instagram запросил код 2FA.'
                  : 'Куки отклонены. Пробую логин/пароль → Instagram требует код подтверждения (письмо/SMS).',
              }, { status: 202 })
            }
            browserState = result.browserState
            clean = result.username || creds.login
            loginMethod = 'browser'
            // успех фолбэка → проваливаемся к persist ниже
          } catch (pwErr: any) {
            const pwRaw = String(pwErr?.message ?? 'вход по паролю не удался')
            if (isInstagramBlacklist(pwRaw) && proxyId) await markProxyBlocked(proxyId)
            const geoHint = '\n\n🌍 Оба способа отклонены на ЭТОМ IP. Если аккаунт из другой страны (напр. id_ID), а прокси US — это гео-несовпадение: нужен прокси В СТРАНЕ АККАУНТА.'
            const msg = `Куки отклонены: ${cookieRaw}\n\n↩️ Пробовал вход по логину/паролю: ${pwRaw}\n\n🌐 Прокси: ${proxyHostLabel(proxyUrl)}${geoHint}`
            return NextResponse.json({ error: msg, screenshot: pwErr?.diag?.screenshot ?? cookieErr?.diag?.screenshot }, { status: 400 })
          }
        } else {
          if (isInstagramBlacklist(cookieRaw) && proxyId) await markProxyBlocked(proxyId)
          const msg = `${cookieRaw}\n\n🌐 Вход шёл через прокси: ${proxyHostLabel(proxyUrl)}`
          return NextResponse.json({ error: msg, screenshot: cookieErr?.diag?.screenshot }, { status: 400 })
        }
      }
    } else {
      if (!username || !password) return NextResponse.json({ error: 'Username и пароль обязательны' }, { status: 400 })
      clean = username.replace(/^@/, '').trim().toLowerCase()
      const totp = typeof totpSecret === 'string' && totpSecret.trim() ? totpSecret.trim() : undefined
      try {
        const result = await browserLogin(clean, password, proxyUrl || undefined, totp, geo?.locale, geo?.timezoneId)
        if (result.needsCheckpoint || result.needs2fa || !result.browserState) {
          const is2fa = Boolean(result.needs2fa)
          return NextResponse.json({
            needsChallenge: is2fa ? undefined : true,
            needs2fa: is2fa || undefined,
            stepName: is2fa ? '2fa' : 'challenge',
            sentTo: result.channel ?? null,
            username: result.username ?? clean,
            proxyId,
            role: accountRole,
            sectionId: validSection,
            error: is2fa
              ? 'Instagram запросил код двухфакторной аутентификации (2FA).'
              : 'Instagram требует подтверждение (challenge). Введите код из письма/SMS.',
          }, { status: 202 })
        }
        browserState = result.browserState
        loginMethod = 'browser'
      } catch (e: any) {
        const raw = String(e?.message ?? 'Неверный логин или пароль')
        const notFound = isAccountNotFound(raw)
        const burned = !notFound && isInstagramBlacklist(raw)
        if (burned && proxyId) await markProxyBlocked(proxyId)
        const hint = notFound
          ? `\n\n⚠️ Instagram не находит аккаунт @${clean} — ПРОКСИ ТУТ НИ ПРИ ЧЁМ (его не помечаем). Обычно это значит: аккаунт отключён/удалён/переименован, ЛИБО Instagram временно так отвечает на анти-бот. Проверьте: откройте instagram.com/${clean} в браузере — если «страница недоступна», аккаунт мёртв и войти нельзя ничем. Прекратите перебор входа — он ускоряет блокировку.`
          : burned
          ? '\n\n♻️ Этот IP помечен как выжженный Instagram и больше не будет предлагаться. Нажмите «Авторизоваться» ещё раз — подберётся ДРУГОЙ IP. Если так по ВСЕМ прокси, а аккаунт точно живой — прокси не в стране аккаунта (гео) или выжжены перебором; попробуйте вход по «Куки».'
          : ''
        const msg = `${raw}\n\n🌐 Вход шёл через прокси: ${proxyHostLabel(proxyUrl)}${hint}`
        // e.diag.screenshot — снимок того, что реально увидел браузер (браузерный движок) — покажем в модалке.
        return NextResponse.json({ error: msg, screenshot: e?.diag?.screenshot }, { status: 400 })
      }
    }

    const account = await persistInstagramAccount({
      userId: user.id,
      username: clean,
      browserState,
      loginMethod,
      proxyUrl,
      proxyId,
      role: accountRole,
      sectionId: validSection,
      emailLogin: emLogin ?? mobileEmail,
      emailPassword: emPass ?? mobileEmailPass,
      locale: geo?.locale,
      timezoneId: geo?.timezoneId,
    })

    return NextResponse.json({ ok: true, account: { id: account.id, username: account.username, status: account.status } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Ошибка сервера' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loginByCookies, loginByCredentials } from '@/lib/instagram/client'
import { getCurrentUser } from '@/lib/auth'
import { normalizeCookies } from '@/lib/cookies'

/**
 * Массовый импорт аккаунтов. Одна строка — один аккаунт. Два режима (mode):
 *  • 'cookies'   — «логин|пароль|User-Agent|<куки>» ИЛИ просто <куки> (любой формат из lib/cookies).
 *  • 'password'  — «логин пароль почта почта-пароль [2FA-ключ]» (разделитель — пробел или |).
 *                  Почта/почта-пароль в аккаунт не сохраняются (нужны для ручного восстановления),
 *                  2FA-ключ (base32) используется, если у аккаунта включена 2FA.
 * Прокси подключается автоматически из пула, если не разрешена «работа без прокси» (защита от бана).
 */

interface RowResult { line: number; ok: boolean; username?: string; reason?: string }

// Похоже ли на 2FA-ключ (base32, ≥16 символов, без @) — для авто-распознавания в строке.
const looksLikeTotp = (s: string) => /^[A-Za-z2-7]{16,}$/.test(s.replace(/[\s-]/g, ''))

// Резолвим прокси ДО входа — как в одиночном добавлении. Возвращает { url, id } или причину отказа.
async function resolveProxy(userId: string, allowNoProxy: boolean, cap: number): Promise<{ url: string | null; id: string | null; error?: string }> {
  const pool = await prisma.proxy.findMany({
    where: { userId, kind: 'pool' },
    select: { id: true, url: true, _count: { select: { accounts: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const free = pool.filter((p) => p._count.accounts < cap).sort((a, b) => a._count.accounts - b._count.accounts)[0]
  if (free) return { url: free.url, id: free.id }
  if (!allowNoProxy) return { url: null, id: null, error: 'нет свободных прокси в пуле' }
  return { url: null, id: null }   // работа без прокси разрешена
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

    const { text, sectionId, mode, role } = await req.json().catch(() => ({}))
    const importMode: 'cookies' | 'password' = mode === 'password' ? 'password' : 'cookies'
    const accountRole: 'RESPONDER' | 'HELPER' = role === 'HELPER' ? 'HELPER' : 'RESPONDER'
    const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return NextResponse.json({ error: 'Пусто — вставьте хотя бы одну строку.' }, { status: 400 })

    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } })
    const allowNoProxy = settings?.allowNoProxy ?? false
    const cap = settings?.accountsPerProxy ?? 3

    let validSection: string | null = null
    if (typeof sectionId === 'string' && sectionId) {
      const sec = await prisma.section.findFirst({ where: { id: sectionId, userId: user.id }, select: { id: true } })
      validSection = sec ? sec.id : null
    }

    const results: RowResult[] = []
    let imported = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Прокси до входа (общий для обоих режимов)
      const px = await resolveProxy(user.id, allowNoProxy, cap)
      if (px.error) { results.push({ line: i + 1, ok: false, reason: px.error }); continue }

      try {
        let sessionData: object
        let clean = ''

        if (importMode === 'password') {
          // «логин пароль почта почта-пароль [2FA-ключ]» (разделитель — пробел или |)
          const parts = (line.includes('|') ? line.split('|') : line.split(/\s+/)).map((s) => s.trim()).filter(Boolean)
          const login = parts[0]
          const password = parts[1]
          if (!login || !password) { results.push({ line: i + 1, ok: false, reason: 'нет логина или пароля' }); continue }
          // 2FA-ключ — первый «похожий на base32» токен после пароля (почта/почта-пароль отсеются по @/#)
          const totp = parts.slice(2).find((p) => looksLikeTotp(p))
          const r = await loginByCredentials(login, password, px.url || undefined, totp)
          if (r.needsChallenge || !r.sessionData) {
            results.push({ line: i + 1, ok: false, reason: 'Instagram требует подтверждение (challenge) — добавьте вручную' })
            continue
          }
          sessionData = r.sessionData
          clean = login.replace(/^@/, '').trim().toLowerCase()
        } else {
          // Формат «логин|пароль|UA|куки»: куки — всё, начиная с 4-й части. Иначе вся строка = куки.
          const parts = line.split('|')
          const cookiesRaw = parts.length >= 4 ? parts.slice(3).join('|') : line
          const norm = normalizeCookies(cookiesRaw)
          if (norm.error) { results.push({ line: i + 1, ok: false, reason: norm.error }); continue }
          const res = await loginByCookies(norm.cookies, px.url || undefined)
          sessionData = res.sessionData
          clean = res.username.replace(/^@/, '').trim().toLowerCase()
        }

        const existing = await prisma.instagramAccount.findFirst({ where: { username: clean, userId: user.id } })
        if (existing) {
          await prisma.instagramAccount.update({
            where: { id: existing.id },
            data: { sessionData, status: 'ACTIVE', lastChecked: new Date(), proxy: px.url, proxyId: px.id, role: accountRole, sectionId: validSection },
          })
        } else {
          await prisma.instagramAccount.create({
            data: {
              userId: user.id, username: clean, role: accountRole,
              sessionData, proxy: px.url, proxyId: px.id, status: 'ACTIVE', sectionId: validSection,
            },
          })
        }
        imported++
        results.push({ line: i + 1, ok: true, username: clean })
      } catch (e: any) {
        results.push({ line: i + 1, ok: false, reason: e?.message ?? 'ошибка входа' })
      }
    }

    return NextResponse.json({ ok: true, imported, skipped: results.length - imported, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Ошибка сервера' }, { status: 500 })
  }
}

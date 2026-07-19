import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { browserRereadUsername } from '@/lib/browser/client'

// ВРЕМЕННО (удалить вместе с /session/username в воркере, rereadUsername в login.js и кнопкой
// в UI, когда починка накопившихся username=unknown закончится). Перечитывает username УЖЕ
// залогиненной сессии (по сохранённому browserState) БЕЗ повторного входа — только DOM,
// той же логикой, что и обычный вход (см. CLAUDE.md).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const acc = await prisma.instagramAccount.findFirst({ where: { id, userId: user.id } })
  if (!acc) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
  if (!acc.browserState) return NextResponse.json({ error: 'У аккаунта нет сохранённой сессии (browserState) — сначала войдите' }, { status: 400 })

  try {
    const result = await browserRereadUsername(
      acc.browserState as object,
      acc.proxy ?? undefined,
      acc.username,
      acc.locale ?? undefined,
      acc.timezoneId ?? undefined,
    )
    if (!result.username) {
      return NextResponse.json({
        ok: false,
        error: result.error ?? 'Ник снова не прочитался',
        sessionAlive: result.sessionAlive,
        url: result.url,
        screenshot: result.diag?.screenshot ?? null,
        pageTitle: result.diag?.title ?? null,
        dom: result.dom,
        needsCaptcha: result.needsCaptcha ?? false,
        captchaImage: result.captchaImage ?? null,
      })
    }
    // Ник реально прочитан = сессия ЖИВА (DOM-навигация дошла до конца). Если аккаунт был
    // ложно помечен CHALLENGE («Требует входа») из-за устаревшего снапшота (см. запись
    // 2026-07-19 (18) в CLAUDE.md), это перечитывание — прямое доказательство обратного:
    // снимаем ложный статус, не заставляя пользователя рисково перелогинивать живой аккаунт.
    const wasFalseChallenge = acc.status === 'CHALLENGE'
    const statusFix = wasFalseChallenge ? { status: 'ACTIVE' as const } : {}

    const clean = result.username.replace(/^@/, '').trim().toLowerCase()
    if (clean === acc.username) {
      if (wasFalseChallenge) {
        await prisma.instagramAccount.update({ where: { id: acc.id }, data: statusFix }).catch(() => null)
      }
      return NextResponse.json({
        ok: true, changed: false, username: clean,
        message: wasFalseChallenge
          ? 'Ник совпадает с уже сохранённым. Сессия подтверждена живой — статус «Требует входа» снят.'
          : 'Ник совпадает с уже сохранённым',
        statusFixed: wasFalseChallenge,
      })
    }
    try {
      await prisma.instagramAccount.update({
        where: { id: acc.id },
        data: { username: clean, browserState: result.browserState ?? acc.browserState, ...statusFix },
      })
      return NextResponse.json({ ok: true, changed: true, username: clean, statusFixed: wasFalseChallenge })
    } catch (e: any) {
      // Уникальный (userId, username) — если запись с таким ником уже есть у пользователя.
      return NextResponse.json({ ok: false, username: clean, error: `Прочитан ник @${clean}, но сохранить не удалось (возможно, уже есть аккаунт с таким ником): ${e?.message ?? e}` })
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? 'Ошибка воркера' }, { status: 400 })
  }
}

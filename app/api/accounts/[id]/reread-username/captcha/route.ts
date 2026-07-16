import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { browserSubmitCaptcha } from '@/lib/browser/client'

// ВРЕМЕННО (удалить вместе с /api/accounts/[id]/reread-username, /session/captcha в воркере и
// кнопкой в UI — см. CLAUDE.md). Продолжение reread-username: когда Instagram во время
// перечитывания ника показал image-капчу (needsCaptcha:true в ответе reread-username) и
// 2captcha сам не решил — человек вводит текст с картинки сюда, довершая ЖИВОЙ контекст воркера.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const acc = await prisma.instagramAccount.findFirst({ where: { id, userId: user.id } })
  if (!acc) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })

  const { code } = await req.json().catch(() => ({}) as { code?: string })
  if (!code || !String(code).trim()) return NextResponse.json({ ok: false, error: 'Введите текст с картинки' }, { status: 400 })

  try {
    const result = await browserSubmitCaptcha(acc.username, String(code).trim())
    const clean = result.username.replace(/^@/, '').trim().toLowerCase()
    if (clean === acc.username) {
      await prisma.instagramAccount.update({ where: { id: acc.id }, data: { browserState: result.browserState } })
      return NextResponse.json({ ok: true, changed: false, username: clean, message: 'Ник совпадает с уже сохранённым' })
    }
    try {
      await prisma.instagramAccount.update({ where: { id: acc.id }, data: { username: clean, browserState: result.browserState } })
      return NextResponse.json({ ok: true, changed: true, username: clean })
    } catch (e: any) {
      return NextResponse.json({ ok: false, username: clean, error: `Прочитан ник @${clean}, но сохранить не удалось (возможно, уже есть аккаунт с таким ником): ${e?.message ?? e}` })
    }
  } catch (e: any) {
    // e.diag.screenshot — свежий скрин экрана В МОМЕНТ провала (напр. поле капчи не нашлось
    // новыми селекторами / код не принят) — контекст воркера НЕ закрывается при ошибке
    // (см. server.js /session/captcha), можно смотреть скрин и пробовать снова.
    return NextResponse.json({ ok: false, error: e?.message ?? 'Ошибка воркера', screenshot: e?.diag?.screenshot ?? null }, { status: 400 })
  }
}

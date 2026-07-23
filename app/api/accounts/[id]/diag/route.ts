import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { browserDiag } from '@/lib/browser/client'

// §0.1 Пошаговая диагностика аккаунта: находит ТОЧНУЮ стадию сбоя действий
// (egress-IP/датацентр → прогрев instagram.com → состояние домашней → sessionid →
// навигация на профиль → кнопки) + вердикт с вероятной причиной. Owner-scoped, read-only
// (в БД НИЧЕГО не пишет — только диагностирует, чтобы не отравить сессию/статус).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const acc = await prisma.instagramAccount.findFirst({ where: { id, userId: user.id } })
  if (!acc) return NextResponse.json({ error: 'Не найдено' }, { status: 404 })
  if (!acc.browserState) {
    return NextResponse.json({ error: 'У аккаунта нет сохранённой сессии (browserState) — сначала войдите' }, { status: 400 })
  }

  let target: string | undefined
  try { const b = await req.json(); target = typeof b?.target === 'string' && b.target.trim() ? b.target.trim() : undefined } catch { /* тело необязательно */ }

  try {
    const result = await browserDiag(
      {
        storageState: acc.browserState as object,
        proxy: acc.proxy ?? undefined,
        username: acc.username,
        locale: acc.locale ?? undefined,
        timezoneId: acc.timezoneId ?? undefined,
      },
      target,
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Ошибка диагностики' }, { status: 500 })
  }
}

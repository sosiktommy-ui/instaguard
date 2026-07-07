import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { checkProxy } from '@/lib/instagram/client'

/**
 * Проверка прокси: показывает исходящий IP, страну и провайдера (как их видит Instagram).
 * Помогает понять, используется ли прокси при входе и не дата-центровый/чёрносписочный ли IP.
 * Тело: { proxyId } (проверить сохранённый прокси пользователя) ИЛИ { url } (проверить строку).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { proxyId, url } = await req.json().catch(() => ({}))

  let proxyUrl: string | undefined
  if (typeof proxyId === 'string' && proxyId) {
    const p = await prisma.proxy.findFirst({ where: { id: proxyId, userId: user.id }, select: { url: true } })
    if (!p) return NextResponse.json({ error: 'Прокси не найден' }, { status: 404 })
    proxyUrl = p.url
  } else if (typeof url === 'string' && url.trim()) {
    proxyUrl = url.trim()
  }

  try {
    const res = await checkProxy(proxyUrl)
    return NextResponse.json(res)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Не удалось проверить прокси' }, { status: 400 })
  }
}

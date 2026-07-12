import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'

// plan4 Фаза H — глобальный фид СРАБАТЫВАНИЙ (колокольчик). Данные уже есть в Log:
// каждое срабатывание пишется как «Сработал триггер «…» → @user» (SUCCESS/WARN) или
// «Триггер «…» → @user: действия не выполнены» (ERROR). Оба содержат подстроку «риггер «»
// (Триггер/триггер) — по ней фильтруем только записи ДЕЙСТВИЙ, отсекая прочие логи
// (парсинг/прогрев/сессия). Скоуп строго по владельцу сессии.
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ items: [] }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 40))

    const logs = await prisma.log.findMany({
      where: {
        account: { userId: user.id },
        level: { in: ['SUCCESS', 'WARN', 'ERROR'] },
        message: { contains: 'риггер «' },   // «Сработал триггер «…»» и «Триггер «…»: не выполнены»
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { account: { select: { username: true } } },
    })

    const items = logs.map((l) => ({
      id: l.id,
      level: l.level as 'SUCCESS' | 'WARN' | 'ERROR',
      message: l.message,
      account: l.account?.username ?? null,
      createdAt: l.createdAt,
    }))
    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ items: [] })
  }
}

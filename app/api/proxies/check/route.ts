import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { browserCheckProxy } from '@/lib/browser/client'

/**
 * Проверка прокси: показывает исходящий IP, страну и провайдера (как их видит Instagram).
 * Помогает понять, используется ли прокси при входе и не дата-центровый/чёрносписочный ли IP.
 * Тело: { proxyId } (проверить сохранённый прокси пользователя — РЕЗУЛЬТАТ СОХРАНЯЕТСЯ в БД,
 *        чтобы подбор при входе потом сразу пропускал мёртвые/датацентр)
 *       ИЛИ { url } (проверить произвольную строку — без сохранения).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { proxyId, url } = await req.json().catch(() => ({}))

  let proxyUrl: string | undefined
  let savedId: string | undefined
  if (typeof proxyId === 'string' && proxyId) {
    const p = await prisma.proxy.findFirst({ where: { id: proxyId, userId: user.id }, select: { id: true, url: true } })
    if (!p) return NextResponse.json({ error: 'Прокси не найден' }, { status: 404 })
    proxyUrl = p.url
    savedId = p.id
  } else if (typeof url === 'string' && url.trim()) {
    proxyUrl = url.trim()
  }

  try {
    const res = await browserCheckProxy(proxyUrl)
    if (savedId) {
      const alive = res.ok !== false
      const flagged = Boolean(res.datacenter || res.vpn || res.proxy)
      await prisma.proxy.update({
        where: { id: savedId },
        data: alive
          ? {
              status: 'alive', lastCheckedAt: new Date(),
              ip: res.ip ?? null, country: res.country ?? null, isp: res.isp ?? null, scheme: res.scheme ?? null,
              datacenter: res.datacenter ?? null, vpn: res.vpn ?? null, mobile: res.mobile ?? null, flagged,
              // Ручная перепроверка = «дать прокси второй шанс»: снимаем метку выжженного
              // Instagram (её могли поставить ошибочно на ошибке аккаунта, а не IP).
              igBlocked: false,
            }
          : { status: 'dead', lastCheckedAt: new Date(), flagged: null },
      }).catch(() => null)
    }
    return NextResponse.json(res)
  } catch (e: any) {
    // Сюда попадаем, ТОЛЬКО если не ответил САМ браузерный воркер (down/таймаут/HTTP-ошибка),
    // а не прокси: мёртвый прокси воркер отдаёт как {ok:false} (обработано выше). Поэтому НЕ
    // метим прокси мёртвым — иначе временный сбой воркера гасил бы здоровые прокси (жалоба
    // «все прокси стали мёртвыми»). Статус в БД оставляем прежним, сообщаем о сбое воркера.
    return NextResponse.json({
      error: `Браузерный воркер не ответил — статус прокси не изменён (${e?.message ?? 'нет связи'}).`,
      workerError: true,
    }, { status: 502 })
  }
}

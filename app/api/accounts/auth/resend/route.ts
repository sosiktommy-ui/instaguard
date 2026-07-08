import { NextRequest, NextResponse } from 'next/server'
import { resendChallengeCode } from '@/lib/instagram/client'
import { resendBrowserCode } from '@/lib/browser/client'
import { resolveEngine } from '@/lib/browser/engine'
import { getCurrentUser } from '@/lib/auth'

/**
 * Повторно отправить код challenge (или сменить канал: 'email' | 'sms').
 * Тело: { username, method }. Challenge-сессия хранится в воркере (с прокси/контекстом внутри),
 * поэтому тут только проксируем запрос — аккаунт ещё не сохраняем.
 */
export async function POST(req: NextRequest) {
  try {
    const { username, method } = await req.json()
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

    const engine = await resolveEngine(user.id)
    const clean = String(username ?? '').replace(/^@/, '').trim().toLowerCase()
    if (!clean) return NextResponse.json({ error: 'Не указан аккаунт' }, { status: 400 })
    const m: 'email' | 'sms' = method === 'sms' ? 'sms' : 'email'

    try {
      if (engine === 'browser') {
        // Браузер: воркер кликает «Отправить снова» на живой странице; канал определяется страницей.
        await resendBrowserCode(clean, m)
        return NextResponse.json({ ok: true, sentTo: m })
      }
      const res = await resendChallengeCode(clean, m)
      return NextResponse.json({ ok: true, sentTo: res.sentTo })
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message ?? 'Не удалось отправить код повторно') }, { status: 400 })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Ошибка сервера' }, { status: 500 })
  }
}

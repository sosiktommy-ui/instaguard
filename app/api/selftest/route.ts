import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { browserSelfTest, browserConfigured } from '@/lib/browser/client'
import { pickPoolProxy } from '@/lib/proxyPool'

/**
 * Антидетект self-test (§10.2/§11.2) — «0 сигналов бота».
 * Поднимает БОЕВОЙ контекст воркера (тот же отпечаток, что у реальных аккаунтов) через прокси,
 * ходит на нейтральный сайт (НЕ Instagram), считает red-сигналы (webdriver/UA-CH/WebGL/WebRTC/…).
 * Прокси: из тела `{proxy}` ИЛИ автоподбор рабочего из пула пользователя. Instagram НЕ трогается —
 * запускать безопасно и часто.
 */
function proxyHostLabel(url: string | null): string {
  if (!url) return '—'
  let s = url.replace(/^\w+:\/\//, '')
  if (s.includes('@')) s = s.split('@').pop() as string
  return s.split(':').slice(0, 2).join(':')
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  if (!browserConfigured()) {
    return NextResponse.json({ error: 'Браузерный воркер не настроен (нет BROWSER_WORKER_URL).' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({} as any))
  let proxy: string | null = typeof body?.proxy === 'string' && body.proxy.trim() ? body.proxy.trim() : null
  let picked = false

  if (!proxy) {
    // cap высокий — нам не важна ёмкость, нужен просто РАБОЧИЙ (живой, не датацентр/не выжженный) прокси.
    const pick = await pickPoolProxy(user.id, 999)
    if (pick.ok) { proxy = pick.url; picked = true }
  }
  if (!proxy) {
    return NextResponse.json({
      error: 'Нет доступного прокси. Добавьте рабочий резидентный/мобильный прокси на вкладке «Прокси» (или вставьте вручную), затем повторите.',
    }, { status: 400 })
  }

  try {
    const r = await browserSelfTest(proxy)
    return NextResponse.json({ ...r, proxyUsed: proxyHostLabel(proxy), proxyAuto: picked })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Ошибка self-test', proxyUsed: proxyHostLabel(proxy) }, { status: 400 })
  }
}

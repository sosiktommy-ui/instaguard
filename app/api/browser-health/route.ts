import { NextRequest, NextResponse } from 'next/server'
import { browserConfigured, browserHealth } from '@/lib/browser/client'

/**
 * Статус браузерного воркера (эмуль). ?test=1 — живой запрос к /health воркера
 * (поднимает Chromium, чтобы вернуть версию — не дёргать без надобности).
 */
export async function GET(req: NextRequest) {
  const configured = browserConfigured()
  if (!configured) {
    return NextResponse.json({ configured: false, hint: 'Не задан BROWSER_WORKER_URL — вход идёт через legacy instagrapi.' })
  }
  const test = req.nextUrl.searchParams.get('test') === '1'
  if (!test) return NextResponse.json({ configured: true })

  try {
    const h = await browserHealth()
    return NextResponse.json({ configured: true, ok: h.ok, build: h.build, chromium: h.chromium, concurrency: h.concurrency, active: h.active, pending: h.pending })
  } catch (e: any) {
    return NextResponse.json({ configured: true, ok: false, error: e?.message ?? 'нет связи с воркером' })
  }
}

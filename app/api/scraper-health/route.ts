import { NextResponse } from 'next/server'
import { scraperConfigured, scraperTest } from '@/lib/scraper/hiker'
import { getCurrentUser } from '@/lib/auth'

/**
 * Статус скрейпер-API (HikerAPI) — источник парсинга подписчиков/комментариев/лайков
 * вместо черновых аккаунтов. Показывается на вкладке «Парсинг (API)».
 *  - configured: задан ли ключ HIKER_API_KEY.
 *  - ok: реальный тестовый запрос к API прошёл (ключ валиден, баланс есть).
 * Тест стоит ~1 запрос HikerAPI, поэтому делается только по явному ?test=1.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const configured = scraperConfigured()
  const wantTest = new URL(req.url).searchParams.get('test') === '1'

  if (!configured) {
    return NextResponse.json({
      configured: false, ok: false,
      hint: 'Ключ HIKER_API_KEY не задан. Оформите на hikerapi.com, пополните баланс и добавьте ключ в переменные окружения Next.js-сервиса.',
    })
  }
  if (!wantTest) return NextResponse.json({ configured: true })

  const res = await scraperTest()
  return NextResponse.json({ configured: true, ...res })
}

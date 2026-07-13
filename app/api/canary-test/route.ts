// Канареечный сквозной тест (Фаза E / §10.4): ОДИН ваш аккаунт («канарейка») РЕАЛЬНО подписывается,
// комментирует и лайкает ДРУГОЙ аккаунт (обычно основной-под-тестом), чтобы у того сработали
// триггеры «Новая подписка»/«Новый комментарий» и мы проверили весь путь детект→действие вживую.
// ⚠️ ВЫПОЛНЯЕТ РЕАЛЬНЫЕ действия (не dry-run) — вызывать осознанно на СВОИХ тестовых аккаунтах.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { browserConfigured, browserFollow, browserLike, browserCommentLatest } from '@/lib/browser/client'

type Ctx = { storageState: object; proxy?: string; username?: string; locale?: string; timezoneId?: string }

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!browserConfigured()) return NextResponse.json({ error: 'Браузерный воркер не настроен (BROWSER_WORKER_URL)' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { canaryId?: string; canaryUsername?: string; target?: string; text?: string; actions?: string[] }
  const target = String(body.target || '').replace(/^@/, '').trim()
  if (!target) return NextResponse.json({ error: 'нужен target — username аккаунта, на который действуем' }, { status: 400 })

  // Канареечный аккаунт — строго среди аккаунтов ВЛАДЕЛЬЦА сессии (изоляция тенанта).
  const canary = await prisma.instagramAccount.findFirst({
    where: { userId: user.id, ...(body.canaryId ? { id: body.canaryId } : { username: (body.canaryUsername || '').replace(/^@/, '') }) },
    select: { id: true, username: true, browserState: true, proxy: true, locale: true, timezoneId: true },
  })
  if (!canary) return NextResponse.json({ error: 'канареечный аккаунт не найден среди ваших' }, { status: 404 })
  if (canary.username.toLowerCase() === target.toLowerCase()) return NextResponse.json({ error: 'канарейка и цель — один аккаунт; выберите разные' }, { status: 400 })
  if (!canary.browserState) return NextResponse.json({ error: 'у канареечного аккаунта нет браузерной сессии — сначала вход' }, { status: 400 })

  const base: Ctx = {
    storageState: canary.browserState as object,
    proxy: canary.proxy ?? undefined,
    username: canary.username,
    locale: canary.locale ?? undefined,
    timezoneId: canary.timezoneId ?? undefined,
  }
  const want = new Set(body.actions?.length ? body.actions : ['follow', 'comment', 'like'])
  const text = String(body.text || 'Огонь! 🔥 Как попасть на мероприятие?')
  const report: any = { canary: canary.username, target, results: {} }
  let state: object = base.storageState
  const ctx = (): Ctx => ({ ...base, storageState: state })

  // Порядок: подписка → комментарий → лайк (как «настоящий человек заметил и отреагировал»).
  if (want.has('follow')) {
    try { const r = await browserFollow(ctx(), target); if (r.browserState) state = r.browserState; report.results.follow = { ok: Boolean(r.ok), already: r.already, error: r.error } }
    catch (e: any) { report.results.follow = { ok: false, error: String(e?.message ?? e).slice(0, 160) } }
  }
  if (want.has('comment')) {
    try { const r = await browserCommentLatest(ctx(), target, text); if (r.browserState) state = r.browserState; report.results.comment = { ok: Boolean(r.ok), impossible: (r as any).impossible, error: r.error } }
    catch (e: any) { report.results.comment = { ok: false, error: String(e?.message ?? e).slice(0, 160) } }
  }
  if (want.has('like')) {
    try { const r = await browserLike(ctx(), target, 1); if (r.browserState) state = r.browserState; report.results.like = { ok: Boolean(r.ok), liked: (r as any).liked, impossible: (r as any).impossible, error: r.error } }
    catch (e: any) { report.results.like = { ok: false, error: String(e?.message ?? e).slice(0, 160) } }
  }

  // Сессия канарейки «дозрела» — сохраняем обновлённый storageState.
  if (state !== base.storageState) await prisma.instagramAccount.update({ where: { id: canary.id }, data: { browserState: state as any } }).catch(() => null)

  report.ok = Object.values(report.results).some((r: any) => r?.ok)
  report.hint = `Теперь на аккаунте @${target} нажмите «Проверить» (или дождитесь авто-цикла): должны сработать триггеры «Новая подписка»/«Новый комментарий». Если @${target} приватный и включён «Авто-приём заявок» — заявка примется и директ пройдёт.`
  return NextResponse.json(report)
}

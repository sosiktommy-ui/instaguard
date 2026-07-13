// §10.3/§10.4 ПОЛНЫЙ ТЕСТ аккаунта — безопасная сквозная проверка готовности БЕЗ реальных действий.
// Прогоняет по порядку: (1) прокси жив + IP/гео, (2) сессия Instagram жива, (3) антидетект
// (fingerprint self-test → «0 сигналов бота»), (4) доступность кнопок действий (dry-run: доходим
// до кнопки, НЕ кликаем). Ничего не отправляется/не лайкается/не подписывается — ban-safe.
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import {
  browserConfigured, browserCheckProxy, browserTestSession, browserSelfTest,
  browserDM, browserFollow, browserLike, browserStories, type ActionResult,
} from '@/lib/browser/client'
import { scrapeFollowers, scrapeUserInfo, scraperConfigured } from '@/lib/scraper/hiker'

type Ctx = { storageState: object; proxy?: string; username?: string; locale?: string; timezoneId?: string }
const ACTIONS = ['dm', 'follow', 'like', 'story'] as const
type ActionType = typeof ACTIONS[number]

export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!browserConfigured()) return NextResponse.json({ error: 'Браузерный воркер не настроен (BROWSER_WORKER_URL)' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { accountId?: string; targetUsername?: string; actions?: string[] }
  if (!body.accountId) return NextResponse.json({ error: 'нужен accountId' }, { status: 400 })

  const account = await prisma.instagramAccount.findFirst({
    where: { id: body.accountId, userId: user.id },
    select: { id: true, username: true, browserState: true, proxy: true, locale: true, timezoneId: true, followers: true },
  })
  if (!account) return NextResponse.json({ error: 'аккаунт не найден' }, { status: 404 })

  const ctx: Ctx = {
    storageState: account.browserState as object,
    proxy: account.proxy ?? undefined,
    username: account.username,
    locale: account.locale ?? undefined,
    timezoneId: account.timezoneId ?? undefined,
  }
  const report: any = { ok: true, account: account.username, checks: {} }

  // ── (1) Прокси: жив ли, какой IP/страна, не датацентр ли ────────────────────
  if (account.proxy) {
    try {
      const p = await browserCheckProxy(account.proxy)
      report.checks.proxy = { ok: Boolean(p.ok), ip: p.ip ?? null, country: p.country ?? null, datacenter: p.datacenter ?? null, scheme: p.scheme ?? null }
    } catch (e: any) { report.checks.proxy = { ok: false, error: String(e?.message ?? e).slice(0, 160) } }
  } else {
    report.checks.proxy = { ok: false, error: 'у аккаунта не назначен прокси' }
  }

  // ── (2) Число подписчиков (публично, HikerAPI) ──────────────────────────────
  if (scraperConfigured()) {
    try { report.checks.followers = { count: (await scrapeUserInfo(account.username)).follower_count } }
    catch (e: any) { report.checks.followers = { error: String(e?.message ?? e).slice(0, 120) } }
  } else {
    report.checks.followers = { count: account.followers ?? null, note: 'HikerAPI не настроен' }
  }

  // ── (3) Сессия Instagram жива? (без неё действия невозможны) ─────────────────
  let sessionAlive = false
  if (account.browserState) {
    try { sessionAlive = await browserTestSession(account.browserState as object, account.proxy ?? undefined, account.username, account.locale ?? undefined, account.timezoneId ?? undefined) }
    catch { sessionAlive = false }
    report.checks.session = { alive: sessionAlive }
  } else {
    report.checks.session = { alive: false, error: 'нет браузерной сессии — нужен вход' }
  }

  // ── (4) Антидетект: fingerprint self-test через прокси аккаунта («0 сигналов бота») ──
  if (account.proxy) {
    try {
      const st = await browserSelfTest(account.proxy, account.username, account.locale ?? undefined, account.timezoneId ?? undefined)
      report.checks.antidetect = st.ok
        ? { redCount: st.redCount ?? null, red: st.red ?? [], webrtcLeaks: st.webrtcLeaks ?? [], egressIp: st.signals?.egressIp ?? null }
        : { error: st.error ?? 'self-test не выполнен' }
    } catch (e: any) { report.checks.antidetect = { error: String(e?.message ?? e).slice(0, 160) } }
  }

  // ── (5) Доступность кнопок действий (dry-run — доходим до кнопки, НЕ кликаем) ──
  // Только если сессия жива (иначе воркер вернёт login_required на каждое). Цель — реальный
  // подписчик (HikerAPI) или переданный вручную; на своём профиле кнопок действий нет.
  report.checks.actions = {}
  if (sessionAlive) {
    let target = String(body.targetUsername || '').replace(/^@/, '').trim().toLowerCase()
    if (!target && scraperConfigured()) {
      try { target = (await scrapeFollowers(account.username, 5)).followers.find((f) => f.username)?.username?.toLowerCase() || '' } catch {}
    }
    if (!target) {
      report.checks.actions = { error: 'не удалось подобрать цель (укажите targetUsername или задайте HikerAPI)' }
    } else {
      report.target = target
      const want: ActionType[] = (Array.isArray(body.actions) && body.actions.length
        ? body.actions.filter((a): a is ActionType => (ACTIONS as readonly string[]).includes(a)) : [...ACTIONS])
      const run = async (t: ActionType, call: () => Promise<ActionResult>) => {
        try { const r = await call(); report.checks.actions[t] = { ok: Boolean(r.ok), reached: r.reached, closed: r.closed, already: r.already, error: r.error } }
        catch (e: any) { report.checks.actions[t] = { ok: false, error: String(e?.message ?? e).slice(0, 160) } }
      }
      if (want.includes('dm')) await run('dm', () => browserDM(ctx, target, '', undefined, true))
      if (want.includes('follow')) await run('follow', () => browserFollow(ctx, target, true))
      if (want.includes('like')) await run('like', () => browserLike(ctx, target, 1, true))
      if (want.includes('story')) await run('story', () => browserStories(ctx, target, false, 4, true))
    }
  } else {
    report.checks.actions = { skipped: 'сессия не жива — сначала вход' }
  }

  // Итог: всё ли зелёное для боевой работы.
  const a = report.checks
  report.ready = Boolean(a.proxy?.ok && a.session?.alive && (a.antidetect?.redCount === 0 || a.antidetect === undefined))
  report.note = 'Полный тест без реальных действий: ничего не отправлено/не лайкнуто/не подписано. Проверены прокси, сессия, антидетект и доступность кнопок.'

  await prisma.log.create({
    data: {
      accountId: account.id, level: report.ready ? 'SUCCESS' : 'WARN',
      message: `🧪 Полный тест @${account.username}: прокси ${a.proxy?.ok ? '✓' : '✗'} · сессия ${a.session?.alive ? '✓' : '✗'} · антидетект ${a.antidetect?.redCount === 0 ? '✓ 0 сигналов' : (a.antidetect?.error ? '✗' : '—')} · кнопки [${Object.entries(a.actions || {}).filter(([k]) => ACTIONS.includes(k as any)).map(([k, v]: any) => `${k}:${v.ok ? '✓' : v.closed ? 'закрыто' : v.already ? 'уже' : '✗'}`).join(' ')}]`,
    },
  }).catch(() => null)

  return NextResponse.json(report)
}

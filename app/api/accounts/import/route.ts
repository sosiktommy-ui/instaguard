import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { browserLogin, browserLoginByCookies } from '@/lib/browser/client'
import { getCurrentUser } from '@/lib/auth'
import { pickPoolProxy, markProxyBlocked } from '@/lib/proxyPool'
import { persistInstagramAccount } from '@/lib/accountPersist'
import { localeForCountry } from '@/lib/browser/geo'

/**
 * Массовый импорт аккаунтов. Одна строка — один аккаунт. Два режима (mode):
 *  • 'cookies'   — «логин|пароль|User-Agent|<куки>» ИЛИ просто <куки> (любой формат из lib/cookies).
 *  • 'password'  — «логин пароль почта почта-пароль [2FA-ключ]» (разделитель — пробел или |).
 *                  Почта/почта-пароль в аккаунт не сохраняются (нужны для ручного восстановления),
 *                  2FA-ключ (base32) используется, если у аккаунта включена 2FA.
 * Прокси подключается автоматически из пула, если не разрешена «работа без прокси» (защита от бана).
 */

interface RowResult {
  line: number; ok: boolean; username?: string; reason?: string
  // Аккаунт валиден, но Instagram запросил код (challenge/2FA). Воркер УЖЕ отправил код и
  // сохранил сессию по username — строку можно «дожать», введя код (см. модалку импорта).
  needsCode?: boolean
  codeMode?: 'challenge' | '2fa'
  proxyId?: string | null
  role?: 'RESPONDER' | 'HELPER'
  sentTo?: string | null      // куда ушёл код challenge: 'email' | 'sms'
  method?: string | null      // для 2FA: 'sms' | 'app'
}

// 2FA-ключ из хвоста строки (токены после пароля): либо ХВОСТ из групп base32 по 4 символа
// (OJDU 3SXQ HPJG …), либо один длинный base32-токен. Почта/почта-пароль (с @/#/точками)
// не мешают — они не base32-группы. Та же логика, что в ручной вставке (AddAccountModal).
function extractTotpKey(tail: string[]): string | undefined {
  const isGroup = (t: string) => /^[A-Za-z2-7]{4}$/.test(t)
  const isLong = (t: string) => /^[A-Za-z2-7]{16,}$/.test(t.replace(/[\s-]/g, ''))
  const groups: string[] = []
  let end = tail.length
  while (end > 0 && isGroup(tail[end - 1])) { groups.unshift(tail[end - 1]); end-- }
  if (groups.length >= 2) return groups.join('')
  const last = tail[tail.length - 1]
  if (last && isLong(last)) return last.replace(/[\s-]/g, '')
  return undefined
}

// host:port прокси без логина/пароля — чтобы в причине отказа было видно, через какой IP шёл вход.
function proxyHostLabel(url: string | null): string {
  if (!url) return 'без прокси (IP сервера)'
  let s = url.replace(/^\w+:\/\//, '')
  if (s.includes('@')) s = s.split('@').pop() as string
  return s.split(':').slice(0, 2).join(':')
}

// Резолвим прокси ДО входа — пропуская мёртвые, предпочитая рабочие (см. lib/proxyPool).
// excludeIds — прокси, которые уже пробовали в ЭТОЙ строке (ретрай на другом IP).
async function resolveProxy(userId: string, allowNoProxy: boolean, cap: number, excludeIds: string[] = []): Promise<{ url: string | null; id: string | null; country: string | null; error?: string }> {
  const pick = await pickPoolProxy(userId, cap, excludeIds)
  if (pick.ok) return { url: pick.url, id: pick.id, country: pick.country }
  if (!allowNoProxy) {
    return { url: null, id: null, country: null, error: pick.reason === 'all-dead' ? 'все свободные прокси в пуле не отвечают' : 'нет свободных прокси в пуле' }
  }
  return { url: null, id: null, country: null }   // работа без прокси разрешена
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const randMs = (minMs: number, maxMs: number) => Math.round(minMs + Math.random() * (maxMs - minMs))

// §4.7 — пер-строчный таймаут-БЭКСТОП. Клиенты входа уже имеют свои таймауты (браузер 180с,
// legacy 75с), но если fetch/воркер зависнет мимо них, одна строка заморозит ВЕСЬ импорт.
// Ставим выше клиентских (210с), чтобы не обрывать легитимно медленный вход, но гарантировать
// разрешение строки. Таймаут → строка падает с понятной причиной, батч продолжается (без ретрая).
const LOGIN_TIMEOUT_MS = Number(process.env.IMPORT_LOGIN_TIMEOUT_MS) || 210_000
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Таймаут ${Math.round(ms / 1000)}с: ${label} завис — строка пропущена`)), ms)),
  ])
}

// «Instagram просит сменить IP» — сигнал по конкретному IP, а не по паролю/куки.
// Стоит попробовать ЭТУ ЖЕ строку ещё раз с другим прокси, прежде чем сдаться.
const isIpBlacklistError = (msg: string) => /чёрном списке|blacklist|change your ip/i.test(msg)

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

    const { text, sectionId, mode, role } = await req.json().catch(() => ({}))
    const importMode: 'cookies' | 'password' = mode === 'password' ? 'password' : 'cookies'
    const accountRole: 'RESPONDER' | 'HELPER' = role === 'HELPER' ? 'HELPER' : 'RESPONDER'
    const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return NextResponse.json({ error: 'Пусто — вставьте хотя бы одну строку.' }, { status: 400 })

    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } })
    const allowNoProxy = settings?.allowNoProxy ?? false
    const cap = settings?.accountsPerProxy ?? 3

    let validSection: string | null = null
    if (typeof sectionId === 'string' && sectionId) {
      const sec = await prisma.section.findFirst({ where: { id: sectionId, userId: user.id }, select: { id: true } })
      validSection = sec ? sec.id : null
    }

    const results: RowResult[] = []
    let imported = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Пауза между строками. Много НОВЫХ логинов подряд с одного IP — для Instagram
      // отдельный сигнал фермы аккаунтов, не менее весомый, чем качество самого прокси
      // (наблюдение из антибан-аудита похожего бота: стабильность важнее скорости).
      // Куки — не событие входа (ниже риск), пауза короче.
      if (i > 0) await sleep(importMode === 'password' ? randMs(20_000, 45_000) : randMs(5_000, 15_000))

      const triedProxyIds: string[] = []
      let rowDone = false

      // До 3 попыток: если Instagram жалуется на IP (блэклист), помечаем этот IP выжженным
      // и пробуем ДРУГОЙ прокси из пула — часто дело именно в конкретном IP, а не в аккаунте.
      for (let attempt = 0; attempt < 3 && !rowDone; attempt++) {
        if (attempt > 0) await sleep(randMs(3_000, 7_000))

        const px = await resolveProxy(user.id, allowNoProxy, cap, triedProxyIds)
        if (px.error) { results.push({ line: i + 1, ok: false, reason: px.error }); break }
        if (px.id) triedProxyIds.push(px.id)
        // Гео отпечатка по стране прокси (plan.md §349) — известной страны нет → воркер берёт дефолт.
        const geo = localeForCountry(px.country)

        try {
          let browserState: object | null = null
          let loginMethod: 'browser' | 'cookies' = 'browser'
          let clean = ''
          let emLogin: string | null = null
          let emPass: string | null = null

          if (importMode === 'password') {
            // Защита от перепутанного режима: куки-строку (мобильная сессия с Bearer/UA)
            // нельзя парсить как «логин пароль» — иначе «логин:пароль:2fa» уходит в username.
            if (/Authorization=Bearer/i.test(line) || /\|\s*Instagram\s[\d.]+\s+Android/i.test(line)) {
              results.push({ line: i + 1, ok: false, reason: 'Это строка КУКИ (мобильная сессия), а не логин/пароль — переключите режим на «🍪 Куки».' })
              break
            }
            // «логин пароль почта почта-пароль [2FA-ключ]» (разделитель — пробел или |)
            const parts = (line.includes('|') ? line.split('|') : line.split(/\s+/)).map((s) => s.trim()).filter(Boolean)
            const login = parts[0]
            const password = parts[1]
            if (!login || !password) { results.push({ line: i + 1, ok: false, reason: 'нет логина или пароля' }); break }
            // 2FA-ключ (в т.ч. разбитый на группы «OJDU 3SXQ …») — из токенов после пароля.
            const totp = extractTotpKey(parts.slice(2))
            // Почта аккаунта — для авточтения кода checkpoint по IMAP (plan §4.5): «…почта почта-пароль…».
            if (parts[2] && parts[2].includes('@')) {
              emLogin = parts[2]
              if (parts[3] && !/^[A-Za-z2-7]{16,}$/.test(parts[3])) emPass = parts[3]
            }
            clean = login.replace(/^@/, '').trim().toLowerCase()

            const r = await withTimeout(browserLogin(login, password, px.url || undefined, totp, geo?.locale, geo?.timezoneId), LOGIN_TIMEOUT_MS, 'вход браузером')
            // Код (checkpoint «новое устройство» или 2FA без ключа) — строку дожмёт модалка (роут /auth/challenge).
            if (r.needsCheckpoint || r.needs2fa) {
              results.push({
                line: i + 1, ok: false, needsCode: true, username: clean,
                codeMode: r.needs2fa ? '2fa' : 'challenge',
                proxyId: px.id, role: accountRole,
                sentTo: r.channel ?? null, method: null,
                reason: r.needs2fa
                  ? 'Instagram запросил код 2FA — введите код ниже'
                  : `Instagram отправил код подтверждения ${r.channel === 'sms' ? 'по SMS' : 'на почту'} — введите код ниже`,
              })
              break
            }
            if (!r.browserState) {
              results.push({ line: i + 1, ok: false, reason: 'Вход не завершён (браузер не вернул сессию) — попробуйте добавить вручную' })
              break
            }
            browserState = r.browserState
            loginMethod = 'browser'
          } else {
            // Куки/сессия. Формат «логин|пароль|UA|куки»: куки — с 4-й части; иначе вся строка = куки.
            // Полная мобильная сессия с Bearer — передаём ВСЮ строку как есть.
            let cookiesRaw: string
            if (line.includes('Authorization=Bearer')) {
              cookiesRaw = line
            } else {
              const parts = line.split('|')
              cookiesRaw = parts.length >= 4 ? parts.slice(3).join('|') : line
            }
            // Браузер: отдаём строку как есть — воркер соберёт storageState/куки и проверит сессию.
            const res = await withTimeout(browserLoginByCookies(cookiesRaw, px.url || undefined, geo?.locale, geo?.timezoneId), LOGIN_TIMEOUT_MS, 'вход по кукам (браузер)')
            browserState = res.browserState
            clean = res.username.replace(/^@/, '').trim().toLowerCase()
            loginMethod = 'cookies'
          }

          await persistInstagramAccount({
            userId: user.id, username: clean,
            browserState, loginMethod,
            proxyUrl: px.url, proxyId: px.id, role: accountRole, sectionId: validSection,
            emailLogin: emLogin, emailPassword: emPass,
            locale: geo?.locale, timezoneId: geo?.timezoneId,
          })
          imported++
          results.push({ line: i + 1, ok: true, username: clean })
          rowDone = true
        } catch (e: any) {
          const msg = String(e?.message ?? 'ошибка входа')
          // IP выжжен Instagram — помечаем, чтобы подбор его больше не давал (ни этой строке, ни следующим).
          if (isIpBlacklistError(msg) && px.id) await markProxyBlocked(px.id)
          const canRetry = attempt < 2 && Boolean(px.url) && isIpBlacklistError(msg)
          if (!canRetry) {
            results.push({ line: i + 1, ok: false, reason: `${msg} · 🌐 через прокси: ${proxyHostLabel(px.url)}` })
          }
          // canRetry=true — молча идём на следующую попытку с ДРУГИМ прокси (excludeIds уже обновлён)
        }
      }
    }

    return NextResponse.json({ ok: true, imported, skipped: results.length - imported, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Ошибка сервера' }, { status: 500 })
  }
}

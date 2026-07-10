import { prisma } from '@/lib/prisma'
import { encrypt, encryptionConfigured } from '@/lib/crypto'

export type AccountRole = 'RESPONDER' | 'HELPER' | 'BOTH'

/**
 * Сохранить/обновить Instagram-аккаунт после успешного входа.
 * Единая точка для ВСЕХ путей входа (браузер/куки/ввод кода) —
 * чтобы поля проставлялись одинаково и не разъезжались.
 *
 * Сессия аккаунта — всегда browserState (Playwright «эмуль», loginMethod 'browser'/'cookies').
 */
export async function persistInstagramAccount(opts: {
  userId: string
  username: string
  browserState?: object | null
  loginMethod?: 'browser' | 'cookies'
  proxyUrl: string | null
  proxyId: string | null
  role: AccountRole
  sectionId: string | null
  emailLogin?: string | null
  emailPassword?: string | null
  locale?: string | null      // гео отпечатка по стране прокси (plan.md §349, lib/browser/geo.ts)
  timezoneId?: string | null
}) {
  const {
    userId, username, browserState, loginMethod,
    proxyUrl, proxyId, role, sectionId, emailLogin, emailPassword, locale, timezoneId,
  } = opts

  // Формируем набор изменяемых полей: не затираем существующую сессию null-ом.
  const sessionFields: Record<string, unknown> = {}
  if (browserState !== undefined && browserState !== null) sessionFields.browserState = browserState
  if (loginMethod) sessionFields.loginMethod = loginMethod
  if (emailLogin !== undefined) sessionFields.emailLogin = emailLogin
  // Пароль почты — только для будущего IMAP-автокода (plan.md §337), наружу в API не отдаётся,
  // но лежал в БД plaintext-строкой (комментарий в схеме обещал шифрование, кода не было —
  // см. plan.md §12). Шифруем at-rest, если ENCRYPTION_KEY настроен; иначе (не настроен на
  // окружении) сохраняем как раньше, чтобы вход не падал из-за отсутствующей переменной.
  if (emailPassword !== undefined) {
    sessionFields.emailPassword = emailPassword && encryptionConfigured() ? encrypt(emailPassword) : emailPassword
  }
  // Не затираем уже сохранённый отпечаток, если этот вход геолокацию не определил
  // (напр. ручной прокси без известной страны) — ЧТОБЫ действия не «прыгали» на дефолт.
  if (locale) sessionFields.locale = locale
  if (timezoneId) sessionFields.timezoneId = timezoneId

  const existing = await prisma.instagramAccount.findFirst({ where: { username, userId } })
  return existing
    ? prisma.instagramAccount.update({
        where: { id: existing.id },
        data: { status: 'ACTIVE', lastChecked: new Date(), proxy: proxyUrl, proxyId, role, sectionId, ...sessionFields },
      })
    : prisma.instagramAccount.create({
        data: {
          userId, username, role, proxy: proxyUrl, proxyId, status: 'ACTIVE', sectionId,
          loginMethod: loginMethod ?? 'browser',
          ...sessionFields,
        },
      })
}

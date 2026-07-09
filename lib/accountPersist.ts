import { prisma } from '@/lib/prisma'

export type AccountRole = 'RESPONDER' | 'HELPER' | 'BOTH'

/**
 * Сохранить/обновить Instagram-аккаунт после успешного входа.
 * Единая точка для ВСЕХ путей входа (браузер/логин-пароль legacy/куки/ввод кода) —
 * чтобы поля проставлялись одинаково и не разъезжались.
 *
 * Сессия аккаунта может быть либо browserState (Playwright «эмуль», loginMethod 'browser'/'cookies'),
 * либо sessionData (legacy instagrapi). Передавайте то, что получили от воркера.
 */
export async function persistInstagramAccount(opts: {
  userId: string
  username: string
  sessionData?: object | null
  browserState?: object | null
  loginMethod?: 'browser' | 'cookies' | 'legacy'
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
    userId, username, sessionData, browserState, loginMethod,
    proxyUrl, proxyId, role, sectionId, emailLogin, emailPassword, locale, timezoneId,
  } = opts

  // Формируем набор изменяемых полей: не затираем существующую сессию null-ом,
  // если передан только один тип (браузер ИЛИ legacy).
  const sessionFields: Record<string, unknown> = {}
  if (sessionData !== undefined && sessionData !== null) sessionFields.sessionData = sessionData
  if (browserState !== undefined && browserState !== null) sessionFields.browserState = browserState
  if (loginMethod) sessionFields.loginMethod = loginMethod
  if (emailLogin !== undefined) sessionFields.emailLogin = emailLogin
  if (emailPassword !== undefined) sessionFields.emailPassword = emailPassword
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
          loginMethod: loginMethod ?? 'legacy',
          ...sessionFields,
        },
      })
}

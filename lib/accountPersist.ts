import { prisma } from '@/lib/prisma'

export type AccountRole = 'RESPONDER' | 'HELPER' | 'BOTH'

/**
 * Сохранить/обновить Instagram-аккаунт после успешного входа.
 * Единая точка для ВСЕХ путей входа (логин/пароль, куки, ввод кода challenge) —
 * чтобы поля (sessionData, proxy, role, раздел) проставлялись одинаково и не разъезжались.
 */
export async function persistInstagramAccount(opts: {
  userId: string
  username: string
  sessionData: object
  proxyUrl: string | null
  proxyId: string | null
  role: AccountRole
  sectionId: string | null
}) {
  const { userId, username, sessionData, proxyUrl, proxyId, role, sectionId } = opts
  const existing = await prisma.instagramAccount.findFirst({ where: { username, userId } })
  return existing
    ? prisma.instagramAccount.update({
        where: { id: existing.id },
        data: { sessionData, status: 'ACTIVE', lastChecked: new Date(), proxy: proxyUrl, proxyId, role, sectionId },
      })
    : prisma.instagramAccount.create({
        data: { userId, username, role, sessionData, proxy: proxyUrl, proxyId, status: 'ACTIVE', sectionId },
      })
}

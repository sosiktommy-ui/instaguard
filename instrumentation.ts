export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { PrismaClient } = await import('@prisma/client')
    const { hashSync } = await import('bcryptjs')

    const prisma = new PrismaClient()

    const existing = await prisma.user.findFirst()
    if (!existing) {
      await prisma.user.create({
        data: {
          email: 'admin@instaguard.com',
          name: 'Admin',
          password: hashSync('admin1234', 10),
        },
      })
      console.log('[seed] Created default user: admin@instaguard.com / admin1234')
    }

    await prisma.$disconnect()
  } catch (e) {
    console.error('[seed] Auto-seed failed:', e)
  }
}

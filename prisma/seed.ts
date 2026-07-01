import { PrismaClient } from '@prisma/client'
import { hashSync } from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'sosiktommy@gmail.com' },
    update: {},
    create: {
      email: 'sosiktommy@gmail.com',
      name: 'Owner',
      password: hashSync('Qwerty123!@#', 10),
    },
  })

  await prisma.template.createMany({
    skipDuplicates: true,
    data: [
      {
        userId: user.id,
        name: 'Приветствие новому подписчику',
        content: 'Привет, @{{username}}! Спасибо, что подписался. Чем могу помочь?',
        category: 'Приветствия',
      },
      {
        userId: user.id,
        name: 'Ответ на комментарий',
        content: 'Рад, что тебе понравилось! 🔥 Есть вопросы по продукту?',
        category: 'Комментарии',
      },
      {
        userId: user.id,
        name: 'Follow-up через 2 часа',
        content: 'Ещё раз привет! Хотел уточнить — интересует что-то конкретное?',
        category: 'Цепочки',
      },
    ],
  })

  console.log('✅ Seed data created — sosiktommy@gmail.com')
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1) })

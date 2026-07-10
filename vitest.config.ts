import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Юнит-тесты чистых функций (§10.1 PLAN-IDEAL) — без сети/prisma/браузера.
// Алиас @/* → корень проекта (как в tsconfig paths).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})

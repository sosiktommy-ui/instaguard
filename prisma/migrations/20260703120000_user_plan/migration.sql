-- Тариф пользователя (задел под биллинг). По умолчанию free.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'free';

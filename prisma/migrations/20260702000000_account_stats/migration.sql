-- Реальное число подписчиков аккаунта + счётчики действий по триггеру
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "followers" INTEGER;
ALTER TABLE "TriggerRule" ADD COLUMN IF NOT EXISTS "stats" JSONB;

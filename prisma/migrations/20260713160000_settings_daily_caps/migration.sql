-- Пользовательские дневные лимиты действий (override DAILY_CAPS). Аддитивно, nullable.
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "dailyCaps" JSONB;

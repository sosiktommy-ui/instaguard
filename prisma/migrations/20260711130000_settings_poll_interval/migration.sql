-- §10: настраиваемый интервал авто-проверки триггеров (раз в N часов на аккаунт).
-- Аддитивно/nullable-safe: дефолт 3 часа; существующие строки получают значение по умолчанию.
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "pollIntervalHours" INTEGER NOT NULL DEFAULT 3;

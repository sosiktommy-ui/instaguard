-- Тумблеры настроек: работать без прокси / без черновых аккаунтов

ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "allowNoProxy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "allowNoDrafts" BOOLEAN NOT NULL DEFAULT false;

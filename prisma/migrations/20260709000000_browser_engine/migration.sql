-- Переход на браузерную автоматизацию («эмуль»). См. plan.md §3.
-- Сессия аккаунта теперь может быть Playwright storageState (browserState), а не только
-- instagrapi-сессия (sessionData, legacy). Всё идемпотентно — можно применять повторно.

ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "browserState" JSONB;
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "loginMethod" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "emailLogin" TEXT;
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "emailPassword" TEXT;

-- Настройки владельца: источник парсинга и движок действий (на время перехода).
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "parsingSource" TEXT NOT NULL DEFAULT 'api';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "actionEngine" TEXT NOT NULL DEFAULT 'browser';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "browserHeadful" BOOLEAN NOT NULL DEFAULT false;

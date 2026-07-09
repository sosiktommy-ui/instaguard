-- Стабильная гео-локаль/таймзона отпечатка аккаунта (plan.md §349) — выводится из страны
-- прокси при входе, хранится, чтобы вход и последующие действия использовали ОДИН и тот же
-- отпечаток браузера (не только UA/viewport, но и locale/timezone).

ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "locale" TEXT;
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "timezoneId" TEXT;

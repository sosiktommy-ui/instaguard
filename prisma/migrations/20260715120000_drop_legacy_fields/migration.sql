-- Удаление LEGACY-полей (Фаза V завершена): instagrapi-сессия и настройки черновых/движка больше
-- НЕ используются кодом (детект — self-events, действия — браузерный воркер). Идемпотентно (IF EXISTS).
ALTER TABLE "InstagramAccount" DROP COLUMN IF EXISTS "sessionData";
ALTER TABLE "UserSettings" DROP COLUMN IF EXISTS "allowNoDrafts";
ALTER TABLE "UserSettings" DROP COLUMN IF EXISTS "likeByDraft";
ALTER TABLE "UserSettings" DROP COLUMN IF EXISTS "storyByDraft";
ALTER TABLE "UserSettings" DROP COLUMN IF EXISTS "actionEngine";

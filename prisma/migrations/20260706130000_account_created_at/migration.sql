-- Задел под «прогрев»: возраст аккаунта в системе (рампа дневных лимитов по возрасту).

ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Уже существующие аккаунты считаем прогретыми (иначе после деплоя они на 2 недели уйдут
-- на сниженные лимиты). Прогрев должен касаться только реально НОВЫХ аккаунтов, добавленных
-- после этой миграции (им проставится DEFAULT now()).
UPDATE "InstagramAccount" SET "createdAt" = TIMESTAMP '2020-01-01 00:00:00';

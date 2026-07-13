-- §13.11 — приватный аккаунт авто-подтверждает входящие заявки на подписку
-- (иначе новый «подписчик» остаётся заявкой и триггер «Новая подписка» не срабатывает).
-- Аддитивно и идемпотентно; существующие строки получают false.
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "autoAcceptFollowers" BOOLEAN NOT NULL DEFAULT false;

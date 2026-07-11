-- Признак «список подписчиков скрыт от третьих сторон» (проверенный/приватный аккаунт).
-- Аддитивно и идемпотентно; существующие строки получают false.
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "parseBlocked" BOOLEAN NOT NULL DEFAULT false;

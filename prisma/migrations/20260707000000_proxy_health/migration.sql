-- Здоровье прокси: результат последней проверки («Проверить все прокси»).
-- Хранится, чтобы подбор при входе сразу пропускал мёртвые/датацентр без повторной
-- live-проверки всего пула на каждом логине (иначе таймаут → тихий фолбэк на плохой прокси).

ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3);
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "ip" TEXT;
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "isp" TEXT;
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "scheme" TEXT;
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "datacenter" BOOLEAN;
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "vpn" BOOLEAN;
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "mobile" BOOLEAN;
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "flagged" BOOLEAN;

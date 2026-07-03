-- Прокси (пул + индивидуальные) + настройка «аккаунтов на прокси» + связь аккаунта с прокси

CREATE TABLE IF NOT EXISTS "Proxy" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'pool',
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Proxy_userId_idx" ON "Proxy"("userId");

CREATE TABLE IF NOT EXISTS "UserSettings" (
    "userId" TEXT NOT NULL,
    "accountsPerProxy" INTEGER NOT NULL DEFAULT 3,
    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "proxyId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_proxyId_fkey"
    FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Разделы/подразделы (папки пользователя) + привязка аккаунта к папке

CREATE TABLE IF NOT EXISTS "Section" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Section_userId_idx" ON "Section"("userId");
CREATE INDEX IF NOT EXISTS "Section_parentId_idx" ON "Section"("parentId");

ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "sectionId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Section" ADD CONSTRAINT "Section_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Section" ADD CONSTRAINT "Section_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "InstagramAccount" ADD CONSTRAINT "InstagramAccount_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

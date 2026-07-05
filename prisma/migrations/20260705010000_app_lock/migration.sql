-- Лок от параллельного запуска фоновых задач (аренда с истечением)
CREATE TABLE IF NOT EXISTS "AppLock" (
  "key"         TEXT NOT NULL,
  "lockedUntil" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppLock_pkey" PRIMARY KEY ("key")
);

-- Индексы для ускорения выборок логов и снапшотов (защита от полного скана при росте таблиц)
CREATE INDEX IF NOT EXISTS "Log_createdAt_idx" ON "Log"("createdAt");
CREATE INDEX IF NOT EXISTS "Log_accountId_createdAt_idx" ON "Log"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "Snapshot_accountId_type_createdAt_idx" ON "Snapshot"("accountId", "type", "createdAt");

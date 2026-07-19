-- PLAN-MASTER §7.1 D.4: IANA-таймзона конкретного IP прокси (ipapi.is location.timezone),
-- точнее общей таблицы «страна→таймзона» для крупных многочасовых стран.
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "timezone" TEXT;

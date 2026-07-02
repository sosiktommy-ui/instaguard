-- История числа подписчиков для спарклайна прироста
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "followersHistory" JSONB;

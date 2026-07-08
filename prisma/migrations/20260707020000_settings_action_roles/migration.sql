-- Распределение действий основной/черновой (защита основного от бана).
-- true → «палевное» действие (лайк / сторис) выполняет ЧЕРНОВОЙ аккаунт, если есть живой,
-- сохраняя основной. Директ, ответ в комментариях и «подписка в ответ» ВСЕГДА выполняет
-- основной (иначе теряется смысл действия). По умолчанию false — сохраняем прежнее поведение.

ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "likeByDraft" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "storyByDraft" BOOLEAN NOT NULL DEFAULT false;

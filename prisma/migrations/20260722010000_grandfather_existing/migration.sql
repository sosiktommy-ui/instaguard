-- Фаза 0 (grandfathering, Вариант А): пользователи, заведённые ДО биллинга, НЕ должны пострадать,
-- когда включатся серверные гейты прав (Фаза 4). Каждому юзеру БЕЗ подписки выдаём active-подписку-comp
-- (без Stripe) с БЕЗЛИМИТОМ (agency) и quantity с запасом ≥ текущего числа аккаунтов → ничего не блокируется.
-- Идемпотентно (WHERE NOT EXISTS) — безопасно при повторном применении. Владелец может позже понизить
-- конкретных юзеров через grantPlan() (lib/entitlements.ts).

INSERT INTO "Subscription" ("id","userId","plan","status","quantity","createdAt","updatedAt")
SELECT 'grandfather_' || u."id",
       u."id", 'agency', 'active',
       GREATEST(COALESCE(a.cnt, 0), 16),
       NOW(), NOW()
FROM "User" u
LEFT JOIN (
  SELECT "userId", COUNT(*)::int AS cnt FROM "InstagramAccount" GROUP BY "userId"
) a ON a."userId" = u."id"
WHERE NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."userId" = u."id");

-- Денормализованный кэш User.plan привести в соответствие для grandfathered-пользователей.
UPDATE "User" u SET "plan" = 'agency'
FROM "Subscription" s
WHERE s."userId" = u."id" AND s."id" = 'grandfather_' || u."id" AND u."plan" <> 'agency';

-- Признак «прокси выжжен на стороне Instagram»: при входе IG вернул blacklist/
-- UserInvalidCredentials через этот IP. Это сильнее репутации ipapi.is (резидентный по
-- ISP, но забанен Instagram). Подбор прокси такие IP избегает и не наступает на них снова.

ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "igBlocked" BOOLEAN;

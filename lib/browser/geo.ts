// Гео-локаль/таймзона отпечатка браузера по стране прокси (plan.md §349, аналог Python
// _locale_for_proxy у legacy-воркера). Страна приходит из Proxy.country — тот же текст,
// что кладёт ipapi.is при проверке прокси (workers/browser/lib/proxy.js `location.country`,
// полное английское имя страны, не ISO-код). Несовпадение локали устройства и страны
// exit-IP — отдельный антибан-сигнал для Instagram (см. CLAUDE.md 2026-07-07 (9)).
//
// Список НЕ исчерпывающий — покрывает страны, реально встречавшиеся в проекте (аккаунты
// id_ID/pt_BR/en_PH, прокси Польша и т.п.) плюс крупные рынки. Незнакомая/пустая страна →
// null → вызывающий код падает на дефолт fingerprint.js (en-US/America/New_York), как было
// раньше — регрессии нет.
const COUNTRY_LOCALE: Record<string, { locale: string; timezoneId: string }> = {
  'united states': { locale: 'en-US', timezoneId: 'America/New_York' },
  'united kingdom': { locale: 'en-GB', timezoneId: 'Europe/London' },
  canada: { locale: 'en-CA', timezoneId: 'America/Toronto' },
  poland: { locale: 'pl-PL', timezoneId: 'Europe/Warsaw' },
  germany: { locale: 'de-DE', timezoneId: 'Europe/Berlin' },
  france: { locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  netherlands: { locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' },
  spain: { locale: 'es-ES', timezoneId: 'Europe/Madrid' },
  italy: { locale: 'it-IT', timezoneId: 'Europe/Rome' },
  portugal: { locale: 'pt-PT', timezoneId: 'Europe/Lisbon' },
  ukraine: { locale: 'uk-UA', timezoneId: 'Europe/Kyiv' },
  russia: { locale: 'ru-RU', timezoneId: 'Europe/Moscow' },
  romania: { locale: 'ro-RO', timezoneId: 'Europe/Bucharest' },
  czechia: { locale: 'cs-CZ', timezoneId: 'Europe/Prague' },
  'czech republic': { locale: 'cs-CZ', timezoneId: 'Europe/Prague' },
  sweden: { locale: 'sv-SE', timezoneId: 'Europe/Stockholm' },
  turkey: { locale: 'tr-TR', timezoneId: 'Europe/Istanbul' },
  indonesia: { locale: 'id-ID', timezoneId: 'Asia/Jakarta' },
  brazil: { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  philippines: { locale: 'en-PH', timezoneId: 'Asia/Manila' },
  india: { locale: 'en-IN', timezoneId: 'Asia/Kolkata' },
  vietnam: { locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' },
  thailand: { locale: 'th-TH', timezoneId: 'Asia/Bangkok' },
  malaysia: { locale: 'ms-MY', timezoneId: 'Asia/Kuala_Lumpur' },
  mexico: { locale: 'es-MX', timezoneId: 'America/Mexico_City' },
  argentina: { locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires' },
  colombia: { locale: 'es-CO', timezoneId: 'America/Bogota' },
  japan: { locale: 'ja-JP', timezoneId: 'Asia/Tokyo' },
  'south korea': { locale: 'ko-KR', timezoneId: 'Asia/Seoul' },
  australia: { locale: 'en-AU', timezoneId: 'Australia/Sydney' },
  'united arab emirates': { locale: 'ar-AE', timezoneId: 'Asia/Dubai' },
  'saudi arabia': { locale: 'ar-SA', timezoneId: 'Asia/Riyadh' },
  egypt: { locale: 'ar-EG', timezoneId: 'Africa/Cairo' },
  nigeria: { locale: 'en-NG', timezoneId: 'Africa/Lagos' },
  'south africa': { locale: 'en-ZA', timezoneId: 'Africa/Johannesburg' },
}

/** Страна (ipapi.is-стиль, полное имя) → локаль/таймзона отпечатка. null, если не распознана. */
export function localeForCountry(country: string | null | undefined): { locale: string; timezoneId: string } | null {
  if (!country) return null
  return COUNTRY_LOCALE[country.trim().toLowerCase()] ?? null
}

// ISO 3166-1 alpha-2 → ключ COUNTRY_LOCALE (полное имя). Только страны, которые есть в COUNTRY_LOCALE.
const ISO_TO_COUNTRY: Record<string, string> = {
  us: 'united states', gb: 'united kingdom', uk: 'united kingdom', ca: 'canada', pl: 'poland',
  de: 'germany', fr: 'france', nl: 'netherlands', es: 'spain', it: 'italy', pt: 'portugal',
  ua: 'ukraine', ru: 'russia', ro: 'romania', cz: 'czechia', se: 'sweden', tr: 'turkey',
  id: 'indonesia', br: 'brazil', ph: 'philippines', in: 'india', vn: 'vietnam', th: 'thailand',
  my: 'malaysia', mx: 'mexico', ar: 'argentina', co: 'colombia', jp: 'japan', kr: 'south korea',
  au: 'australia', ae: 'united arab emirates', sa: 'saudi arabia', eg: 'egypt', ng: 'nigeria', za: 'south africa',
}

/**
 * Гео-локаль/таймзона из САМОЙ СТРОКИ прокси, если провайдер зашил в неё гео-хинт
 * (напр. rp.proxxxymiron.cc: `…_country-PL_city-warsaw`). Нужно как ФОЛБЭК, когда `Proxy.country`
 * ещё не заполнен (прокси добавлен вручную и не проверен «Проверить IP») — иначе отпечаток дефолтит
 * на en-US поверх не-US IP (лишний антибан-сигнал: браузер «американский», а exit-IP — нет).
 * Распознаём ТОЛЬКО явные гео-хинты `country-XX`/`cc-XX`/`region-XX`/`geo-XX` (XX — ISO-код), чтобы
 * не ловить ложные совпадения из случайных подстрок хоста/пароля. Не нашли → null (дефолт как раньше).
 */
export function localeFromProxyString(proxy: string | null | undefined): { locale: string; timezoneId: string } | null {
  if (!proxy || typeof proxy !== 'string') return null
  const m = proxy.toLowerCase().match(/(?:country|region|geo|cc)[-_=]([a-z]{2})(?![a-z])/)
  if (!m) return null
  const name = ISO_TO_COUNTRY[m[1]]
  return name ? (COUNTRY_LOCALE[name] ?? null) : null
}

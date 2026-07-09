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

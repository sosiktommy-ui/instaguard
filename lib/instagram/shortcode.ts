// Конвертация numeric media pk (Instagram) в shortcode для ссылки на пост.
// Тот же алгоритм, что использует instagrapi (Media.pk2code) — Instagram кодирует pk
// собственным base64-алфавитом. HikerAPI иногда отдаёт id составным ("pk_ownerPk") —
// берём часть до "_". Нужно, чтобы браузерный воркер мог открыть /p/{shortcode}/
// для ответа на комментарий (без этого — Фаза 4 «отложено», см. plan.md §4.6).
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function mediaPkToShortcode(mediaId: string): string {
  const pk = String(mediaId).split('_')[0]
  const zero = BigInt(0)
  const base = BigInt(64)
  let num = BigInt(pk)
  if (num === zero) return ALPHABET[0]
  let code = ''
  while (num > zero) {
    code = ALPHABET[Number(num % base)] + code
    num /= base
  }
  return code
}

export function mediaPostUrl(mediaId: string): string {
  return `https://www.instagram.com/p/${mediaPkToShortcode(mediaId)}/`
}

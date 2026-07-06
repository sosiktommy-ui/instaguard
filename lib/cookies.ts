/**
 * Надёжный разбор куки для входа в Instagram. Пользователи вставляют куки в самых
 * разных форматах — этот модуль приводит их к единому словарю { name: value },
 * который понимает воркер (instagrapi), и честно сообщает, если куки не подходят.
 *
 * Поддерживаемые форматы ввода:
 *  1) Экспорт Cookie-Editor — JSON-массив [{ "name": "...", "value": "...", ... }]
 *  2) JSON-объект { "sessionid": "...", "csrftoken": "...", ... }
 *  3) Cookie-заголовок / строка вида "sessionid=abc; csrftoken=xyz; ds_user_id=1"
 *  4) Просто сырой sessionid (один токен)
 *  5) Мобильная Android-сессия (pipe-формат с "Authorization=Bearer …") — уходит воркеру как есть
 *  6) «Грязная» строка, где JSON-массив/объект куки просто где-то внутри текста
 */

export type CookieKind = 'instagram' | 'facebook' | 'mobile' | 'unknown'

export interface NormalizedCookies {
  cookies: Record<string, string>
  kind: CookieKind
  error?: string   // если задано — использовать нельзя, показать пользователю
}

const isMobileSession = (s: string) => s.includes('|') && s.includes('Authorization=Bearer')

/** Пытается распарсить JSON — сначала строку целиком, потом первый «похожий на JSON» кусок внутри текста. */
function tryParseJson(s: string): unknown | undefined {
  try { return JSON.parse(s) } catch { /* пробуем извлечь подстроку */ }
  // Ищем сбалансированный JSON-массив или объект внутри мусорной строки
  for (const [open, close] of [['[', ']'], ['{', '}']] as const) {
    const start = s.indexOf(open)
    const end = s.lastIndexOf(close)
    if (start !== -1 && end > start) {
      try { return JSON.parse(s.slice(start, end + 1)) } catch { /* дальше */ }
    }
  }
  return undefined
}

/** Массив Cookie-Editor [{name,value}] → { name: value } */
function fromCookieArray(arr: any[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of arr) {
    if (item && typeof item === 'object' && typeof item.name === 'string' && item.value != null) {
      out[item.name] = String(item.value)
    }
  }
  return out
}

/** Строка "k=v; k=v" (или с переводами строк) → { k: v } */
function fromCookieHeader(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of s.split(/[;\n\r]+/)) {
    const t = pair.trim()
    if (!t) continue
    const eq = t.indexOf('=')
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}

/** Регистронезависимый поиск значения куки по имени. */
function pick(dict: Record<string, string>, name: string): string {
  const lower = name.toLowerCase()
  for (const k of Object.keys(dict)) if (k.toLowerCase() === lower) return dict[k]
  return ''
}

export function normalizeCookies(raw: string): NormalizedCookies {
  const s = (raw ?? '').trim()
  if (!s) return { cookies: {}, kind: 'unknown', error: 'Пусто — вставьте куки Instagram.' }

  // 5) Мобильная сессия — воркер сам её разберёт (ожидает { sessionid: "<raw>" })
  if (isMobileSession(s)) return { cookies: { sessionid: s }, kind: 'mobile' }

  let dict: Record<string, string> = {}
  const parsed = tryParseJson(s)

  if (Array.isArray(parsed)) {
    dict = fromCookieArray(parsed)
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, any>
    // Может быть одиночный cookie-объект {name,value} или готовый словарь
    if (typeof obj.name === 'string' && obj.value != null) {
      dict = { [obj.name]: String(obj.value) }
    } else {
      for (const [k, v] of Object.entries(obj)) if (v != null && typeof v !== 'object') dict[k] = String(v)
    }
  } else if (s.includes('=')) {
    // 3) cookie-заголовок / строка k=v
    dict = fromCookieHeader(s)
  } else {
    // 4) один сырой токен → это sessionid
    dict = { sessionid: s }
  }

  const sessionid = pick(dict, 'sessionid')
  if (sessionid) {
    // нормализуем ключевые имена к нижнему регистру, которые ждёт instagrapi
    const norm: Record<string, string> = { ...dict, sessionid }
    const dsu = pick(dict, 'ds_user_id'); if (dsu) norm.ds_user_id = dsu
    const csrf = pick(dict, 'csrftoken'); if (csrf) norm.csrftoken = csrf
    return { cookies: norm, kind: 'instagram' }
  }

  // Facebook-куки (c_user/xs) без sessionid — частая ошибка: это НЕ куки Instagram
  if (pick(dict, 'c_user') || pick(dict, 'xs') || pick(dict, 'fr')) {
    return {
      cookies: {}, kind: 'facebook',
      error: 'Это куки Facebook (c_user/xs), а для входа нужны куки Instagram. Экспортируйте куки на instagram.com — нужен как минимум sessionid.',
    }
  }

  return { cookies: {}, kind: 'unknown', error: 'Не найден sessionid — не удалось распознать куки Instagram.' }
}

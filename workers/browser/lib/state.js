// Мобильная Android-сессия купленных аккаунтов: "логин:пароль[:2fa] | UA | device-ids |
// headers-с-Bearer | ... || почта:пароль-почты". До сих пор это понимал ТОЛЬКО legacy
// Python-воркер (_parse_mobile_session) — у браузерного эмуля парсера не было вообще:
// toStorageState() ниже (до этого фикса) сваливал ВСЮ строку в один мусорный cookie
// "sessionid" (т.к. строка содержит и "=", и пробелы из UA — не проходила ни одну ветку
// нормального разбора). Кука с мусорным значением всё равно ПРИСУТСТВУЕТ в contexte →
// hasSessionCookie() наивно считал сессию живой → ложный "успешный" вход без реальной
// авторизации (см. login.js loginByState — там же добавлена доп. проверка на этот случай).
// Bearer-токен реально несёт JSON {ds_user_id, sessionid} — тот же sessionid, что и
// веб-кука instagram.com (тот же формат "<uid>:<rand>:<ver>:<hash>"), просто
// URL-кодированный — поэтому его МОЖНО подставить как настоящую веб-сессию.
function parseMobileSessionCookies(raw) {
  const headerSeg = raw.split('|').find((p) => /Authorization\s*=\s*Bearer/i.test(p))
  if (!headerSeg) return null
  const headers = {}
  for (const pair of headerSeg.split(';')) {
    const i = pair.indexOf('=')
    if (i > 0) headers[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
  }
  const auth = headers['Authorization'] || ''
  // Токен обычно "Bearer IGT:2:<base64>", но встречается и без префикса IGT:2, и в base64url
  // (-/_ вместо +//). Префикс необязателен, набор символов расширен.
  const m = auth.match(/Bearer\s+(?:IGT:2:)?([A-Za-z0-9+/=_-]+)/i)
  if (!m) return null
  let payload
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
    payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  } catch { return null }
  if (!payload || !payload.sessionid) return null
  let sessionid = String(payload.sessionid)
  try { sessionid = decodeURIComponent(sessionid) } catch {}
  const cookies = { sessionid }
  const dsUserId = payload.ds_user_id || headers['IG-U-DS-USER-ID'] || headers['IG-INTENDED-USER-ID']
  if (dsUserId) cookies.ds_user_id = String(dsUserId)
  return cookies
}

// Привести произвольный ввод куки к Playwright storageState.
// Понимает: готовый storageState ({cookies:[...]}), массив Cookie-Editor [{name,value,...}],
// объект-карту {sessionid,ds_user_id,...}, строку JSON, мобильную Android-сессию (см. выше)
// или сырой sessionid.
export function toStorageState(input) {
  let data = input
  if (typeof input === 'string') {
    const s = input.trim()
    if (s.includes('|') && /Authorization\s*=\s*Bearer/i.test(s)) {
      // Мобильная сессия — НЕ пытаться разобрать как обычные куки (там пробелы из UA
      // сломают все ветки ниже и дадут мусорный "успех", см. комментарий выше).
      data = parseMobileSessionCookies(s) || {}
    } else {
      try { data = JSON.parse(s) }
      catch {
        // сырой sessionid или "k=v; k=v"
        if (s.includes('=') && !s.includes(' ')) {
          const map = {}
          for (const pair of s.split(';')) {
            const i = pair.indexOf('=')
            if (i > 0) map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
          }
          data = map
        } else {
          data = { sessionid: s }
        }
      }
    }
  }

  // Уже storageState
  if (data && Array.isArray(data.cookies)) {
    return { cookies: normalizeCookies(data.cookies), origins: Array.isArray(data.origins) ? data.origins : [] }
  }
  // Массив Cookie-Editor
  if (Array.isArray(data)) {
    return { cookies: normalizeCookies(data), origins: [] }
  }
  // Объект-карта name→value
  if (data && typeof data === 'object') {
    const cookies = Object.entries(data)
      .filter(([, v]) => v != null && typeof v !== 'object')
      .map(([name, value]) => baseCookie(name, String(value)))
    return { cookies, origins: [] }
  }
  return { cookies: [], origins: [] }
}

function baseCookie(name, value) {
  return { name, value, domain: '.instagram.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax', expires: -1 }
}

function normalizeCookies(arr) {
  return arr
    .filter((c) => c && c.name)
    .map((c) => ({
      name: c.name,
      value: String(c.value ?? ''),
      domain: c.domain || '.instagram.com',
      path: c.path || '/',
      httpOnly: Boolean(c.httpOnly),
      secure: c.secure !== undefined ? Boolean(c.secure) : true,
      sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
      expires: typeof c.expires === 'number' ? c.expires : -1,
    }))
}

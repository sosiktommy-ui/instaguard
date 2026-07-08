// Привести произвольный ввод куки к Playwright storageState.
// Понимает: готовый storageState ({cookies:[...]}), массив Cookie-Editor [{name,value,...}],
// объект-карту {sessionid,ds_user_id,...}, строку JSON или сырой sessionid.
export function toStorageState(input) {
  let data = input
  if (typeof input === 'string') {
    const s = input.trim()
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

// Разбор строки прокси в формат Playwright: { server, username, password }.
// Понимает: "scheme://user:pass@host:port", "user:pass@host:port",
// "host:port:user:pass", "host:port". Схема по умолчанию — http (Playwright сам
// туннелирует HTTPS через HTTP-CONNECT; для SOCKS указывайте socks5:// явно).
export function parseProxy(raw) {
  if (!raw || typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null

  let scheme = 'http'
  const schemeMatch = s.match(/^(\w+):\/\//)
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase()
    s = s.slice(schemeMatch[0].length)
  }

  let username, password, hostPort

  if (s.includes('@')) {
    // user:pass@host:port
    const [creds, hp] = [s.slice(0, s.lastIndexOf('@')), s.slice(s.lastIndexOf('@') + 1)]
    hostPort = hp
    const ci = creds.indexOf(':')
    if (ci >= 0) { username = creds.slice(0, ci); password = creds.slice(ci + 1) }
    else username = creds
  } else {
    const parts = s.split(':')
    if (parts.length === 4) {
      // host:port:user:pass
      hostPort = `${parts[0]}:${parts[1]}`
      username = parts[2]; password = parts[3]
    } else if (parts.length === 2) {
      // host:port
      hostPort = s
    } else {
      hostPort = s
    }
  }

  if (!hostPort || !hostPort.includes(':')) return null
  const server = `${scheme}://${hostPort}`
  const out = { server }
  if (username) out.username = username
  if (password !== undefined) out.password = password
  return out
}

// host:port без логина/пароля — для логов (видно, через какой IP шёл вход).
export function proxyHostLabel(raw) {
  const p = parseProxy(raw)
  if (!p) return 'без прокси'
  return p.server.replace(/^\w+:\/\//, '')
}

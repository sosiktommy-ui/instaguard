const PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL ?? 'http://localhost:8001'
const PYTHON_WORKER_SECRET = process.env.PYTHON_WORKER_SECRET ?? ''

async function workerFetch<T = any>(path: string, body: object): Promise<T> {
  const res = await fetch(`${PYTHON_WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': PYTHON_WORKER_SECRET,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Worker ${path} → ${res.status}: ${text}`)
  }
  return res.json()
}

export async function sendDM(session: object, toUserId: string, message: string, proxy?: string) {
  return workerFetch('/send-dm', { sessionData: session, toUserId, text: message, proxy })
}

export async function loginByCredentials(username: string, password: string, proxy?: string) {
  return workerFetch<{ sessionData: object }>('/login', { username, password, proxy })
}

export async function getFollowers(session: object, username: string, proxy?: string) {
  return workerFetch<{ followers: Array<{ pk: string; username: string; full_name: string }> }>(
    '/followers',
    { sessionData: session, username, proxy }
  )
}

export async function testSession(session: object, proxy?: string): Promise<boolean> {
  try {
    const data = await workerFetch<{ ok: boolean }>('/test-session', { sessionData: session, proxy })
    return data.ok
  } catch {
    return false
  }
}

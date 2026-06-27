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
  // 202 = challenge required (not an error — parse normally)
  if (!res.ok && res.status !== 202) {
    let detail: string
    try {
      const data = await res.json()
      detail = data.detail ?? data.error ?? JSON.stringify(data)
    } catch {
      detail = await res.text()
    }
    throw new Error(detail)
  }
  return res.json()
}

export async function sendDM(session: object, toUserId: string, message: string, proxy?: string) {
  return workerFetch('/send-dm', { sessionData: session, toUserId, text: message, proxy })
}

export async function sendDMPhoto(session: object, toUserId: string, image: string, proxy?: string) {
  return workerFetch('/send-dm-photo', { sessionData: session, toUserId, image, proxy })
}

export async function followUser(session: object, userId: string, proxy?: string) {
  return workerFetch('/follow-user', { sessionData: session, userId, proxy })
}

export async function likeLatestMedia(session: object, userId: string, proxy?: string) {
  return workerFetch('/like-latest-media', { sessionData: session, userId, proxy })
}

export interface IgComment { pk: string; text: string; user_pk: string; username: string; media_id: string }

export async function getComments(session: object, username: string, proxy?: string, mediaCount = 4, perMedia = 20) {
  return workerFetch<{ comments: IgComment[] }>('/comments', { sessionData: session, username, proxy, mediaCount, perMedia })
}

export async function replyComment(session: object, mediaId: string, text: string, commentId?: string, proxy?: string) {
  return workerFetch('/reply-comment', { sessionData: session, mediaId, text, commentId, proxy })
}

export async function likeComment(session: object, commentId: string, proxy?: string) {
  return workerFetch('/like-comment', { sessionData: session, commentId, proxy })
}

export async function loginByCredentials(username: string, password: string, proxy?: string) {
  return workerFetch<{ sessionData?: object; needsChallenge?: boolean; stepName?: string; username?: string }>('/login', { username, password, proxy })
}

export async function submitChallengeCode(username: string, code: string) {
  return workerFetch<{ sessionData: object }>('/login-challenge', { username, code })
}

export async function loginByCookies(cookies: object, proxy?: string) {
  return workerFetch<{ sessionData: object; username: string }>('/login-cookies', { cookies, proxy })
}

export async function getFollowers(session: object, username: string, proxy?: string, amount = 50) {
  return workerFetch<{ followers: Array<{ pk: string; username: string; full_name: string }> }>(
    '/followers',
    { sessionData: session, username, proxy, amount }
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

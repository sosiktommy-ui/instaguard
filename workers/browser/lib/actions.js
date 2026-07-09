// Действия аккаунта через браузер. См. plan.md §4.6. Каждое возвращает обновлённый
// storageState (сессия «дозревает»). Работают по username (навигация /{username}/).
import { SEL } from './selectors.js'
import { firstVisible, clickByText, pageHasText, hasSessionCookie, gotoResilient } from './browser.js'
import { humanType, jitter, idleMouse } from './human.js'

async function openProfile(context, username) {
  const page = await context.newPage()
  await gotoResilient(page, `https://www.instagram.com/${username}/`, { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1200, 2500)
  await idleMouse(page)
  return page
}

function requireSession(context) {
  return hasSessionCookie(context).then((ok) => {
    if (!ok) throw new Error('login_required: сессия недействительна — нужен повторный вход')
  })
}

// ── Директ ────────────────────────────────────────────────────────────────────
export async function sendDM(context, { toUsername, text }) {
  await requireSession(context)
  const page = await openProfile(context, toUsername)

  // Кнопка «Message» на профиле. Нет → личка закрыта/ограничена.
  const opened = await clickByText(page, SEL.messageButton, { timeout: 8000 })
  if (!opened) {
    // иногда «Message» спрятана в меню «•••» — пробуем, иначе считаем закрытой
    return { ok: false, closed: true, error: 'dm_closed: кнопка «Написать» недоступна (закрытая личка/ограничение)' }
  }
  const box = await firstVisible(page, SEL.dmTextbox, 12000)
  if (!box) return { ok: false, closed: true, error: 'dm_closed: поле сообщения не открылось' }

  await humanType(box, text)
  await jitter(400, 900)
  await box.press('Enter')
  await jitter(1200, 2200)

  return { ok: true, storageState: await context.storageState() }
}

// ── Подписка ────────────────────────────────────────────────────────────────
export async function followUser(context, { targetUsername }) {
  await requireSession(context)
  const page = await openProfile(context, targetUsername)

  if (await pageHasText(page, SEL.followingState)) {
    return { ok: true, already: true, storageState: await context.storageState() }
  }
  const clicked = await clickByText(page, SEL.followButton, { timeout: 8000 })
  if (!clicked) return { ok: false, error: 'follow_button_not_found: кнопка «Подписаться» не найдена' }
  await jitter(900, 1800)
  return { ok: true, storageState: await context.storageState() }
}

// ── Лайк последних постов ─────────────────────────────────────────────────────
export async function likeUser(context, { targetUsername, count = 1 }) {
  await requireSession(context)
  const page = await openProfile(context, targetUsername)

  // Ссылки на посты в сетке профиля.
  const postLinks = await page.locator('a[href*="/p/"]').evaluateAll(
    (els) => Array.from(new Set(els.map((e) => e.getAttribute('href')).filter(Boolean))).slice(0, 6)
  ).catch(() => [])
  if (!postLinks.length) return { ok: false, liked: 0, error: 'no_posts: у аккаунта нет постов для лайка' }

  let liked = 0
  for (const href of postLinks.slice(0, Math.max(1, count))) {
    try {
      await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await jitter(1000, 2200)
      const likeBtn = page.locator('div[role="button"]:has(svg[aria-label="Like"]), div[role="button"]:has(svg[aria-label="Нравится"])').first()
      if (await likeBtn.isVisible().catch(() => false)) {
        await likeBtn.click({ delay: 60 })
        liked++
        await jitter(1500, 3000)
      }
    } catch {}
  }
  return { ok: liked > 0, liked, storageState: await context.storageState() }
}

// ── Сторис: просмотр (+опц. лайк) ─────────────────────────────────────────────
export async function viewStories(context, { targetUsername, like = false }) {
  await requireSession(context)
  const page = await context.newPage()
  await gotoResilient(page, `https://www.instagram.com/stories/${targetUsername}/`, { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1500, 2800)

  // Если сторис нет — редирект на профиль/пусто.
  let viewed = 0, liked = 0
  const isViewer = page.url().includes('/stories/')
  if (!isViewer) return { ok: false, viewed, liked, error: 'no_stories: активных сторис нет' }

  // Пролистать несколько кадров.
  for (let i = 0; i < 4; i++) {
    viewed++
    if (like) {
      try {
        const likeBtn = page.locator('div[role="button"]:has(svg[aria-label="Like"]), div[role="button"]:has(svg[aria-label="Нравится"])').first()
        if (await likeBtn.isVisible().catch(() => false)) { await likeBtn.click({ delay: 60 }); liked++ }
      } catch {}
    }
    await jitter(2000, 4000)
    await page.keyboard.press('ArrowRight').catch(() => {})
    if (!page.url().includes('/stories/')) break
  }
  return { ok: true, viewed, liked, storageState: await context.storageState() }
}

// ── Комментарий к посту ───────────────────────────────────────────────────────
export async function commentPost(context, { postUrl, text }) {
  await requireSession(context)
  const page = await context.newPage()
  await gotoResilient(page, postUrl, { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1200, 2400)

  const box = await firstVisible(page, SEL.commentBox, 10000)
  if (!box) return { ok: false, error: 'comment_box_not_found: поле комментария недоступно' }
  await box.click({ delay: 50 })
  await humanType(box, text)
  await jitter(500, 1100)
  const posted = await clickByText(page, SEL.commentPost, { timeout: 4000 })
  if (!posted) await box.press('Enter')
  await jitter(1200, 2200)
  return { ok: true, storageState: await context.storageState() }
}

// Ответ в комментариях — для Фазы 2 трактуем как обычный коммент к посту
// (нить-reply требует клика по «Ответить» под конкретным комментом — Фаза 4).
export async function replyComment(context, { postUrl, text }) {
  return commentPost(context, { postUrl, text })
}

// ── Стори-события из директа (ответы на мои сторис + упоминания) ─────────────────
// Читаем ВЕБ-приватный API изнутри залогиненной страницы (fetch с cookies + x-ig-app-id) —
// это надёжнее DOM-скрейпа инбокса (React-вёрстка часто меняется). Форма события совпадает
// с Python get_story_events: {pk, user_pk, username, text, kind:'reply'|'mention'} — poll
// не нужно переписывать. См. plan.md §5 (стори всегда сессией ОСНОВНОГО — его личка).
export async function readStoryEvents(context, { amount = 10 } = {}) {
  await requireSession(context)
  const page = await context.newPage()
  // Нужен origin instagram.com, чтобы fetch унаследовал cookies и прошёл CORS/same-origin.
  await gotoResilient(page, 'https://www.instagram.com/', { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1200, 2200)

  const events = await page.evaluate(async (amount) => {
    const headers = { 'x-ig-app-id': '936619743392459' }
    async function getJson(url) {
      try {
        const r = await fetch(url, { headers, credentials: 'include' })
        if (!r.ok) return null
        return await r.json()
      } catch { return null }
    }
    const inbox = await getJson(`/api/v1/direct_v2/inbox/?visual_message_return_type=unseen&thread_message_limit=10&persistentBadging=true&limit=${amount}`)
    const pending = await getJson(`/api/v1/direct_v2/pending_inbox/?visual_message_return_type=unseen&thread_message_limit=10&limit=${amount}`)
    const ownId = String(inbox?.viewer?.pk ?? pending?.viewer?.pk ?? '')
    const threads = [...(inbox?.inbox?.threads ?? []), ...(pending?.inbox?.threads ?? [])]
    const out = []
    const seen = new Set()
    for (const t of threads) {
      const unameByPk = {}
      for (const u of (t.users ?? [])) unameByPk[String(u.pk)] = u.username || ''
      for (const it of (t.items ?? [])) {
        const itype = it.item_type || ''
        const uid = String(it.user_id || '')
        if (!uid || uid === ownId) continue
        let kind = null, text = ''
        if (itype === 'reel_share') {
          const rs = it.reel_share || {}
          kind = rs.type === 'mention' ? 'mention' : 'reply'
          text = rs.text || ''
        } else if (itype === 'story_share') {
          kind = 'mention'
        }
        if (!kind) continue
        const pk = String(it.item_id || '')
        if (pk && seen.has(pk)) continue
        if (pk) seen.add(pk)
        out.push({ pk, user_pk: uid, username: unameByPk[uid] || '', text, kind })
      }
    }
    return out
  }, amount)

  return { events: Array.isArray(events) ? events : [], storageState: await context.storageState() }
}

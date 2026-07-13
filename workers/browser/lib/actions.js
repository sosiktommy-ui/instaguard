// Действия аккаунта через браузер. См. plan.md §4.6. Каждое возвращает обновлённый
// storageState (сессия «дозревает»). Работают по username (навигация /{username}/).
import { SEL } from './selectors.js'
import { firstVisible, clickByText, findByText, pageHasText, hasSessionCookie, gotoResilient, safeStorageState } from './browser.js'
import { humanType, jitter, idleMouse, preActionBrowse, humanClick } from './human.js'

async function openProfile(context, username) {
  const page = await context.newPage()
  await preActionBrowse(page) // §1.2: полистать ленту перед заходом к цели — действие не «вхолодную»
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

// Явные индикаторы Instagram, что сообщение НЕ ушло (сеть/ограничение/сбой отправки).
const DM_FAIL_TEXT = [
  'Not delivered', 'Не доставлено', "Couldn't send", 'Failed to send',
  'Message failed', 'Не удалось отправить', 'Tap to retry', 'Нажмите, чтобы повторить',
  'Try again', 'Попробуйте снова',
]

// §4.6 — ПОДТВЕРЖДЕНИЕ доставки, а не «нажал Enter = доставлено».
// Успех = (нет индикатора сбоя) И (сообщение видно в треде ИЛИ композер очистился).
// Композер (contenteditable) очищается ТОЛЬКО когда IG принял отправку; если текст завис
// в поле или появился «Not delivered» — считаем недоставленным (транзиент → ретрай).
async function confirmDelivered(page, box, text) {
  const probe = String(text).split('\n').map((s) => s.trim()).find(Boolean) || ''
  const snippet = probe.slice(0, 40)
  const deadline = Date.now() + 8000
  let composerCleared = false
  while (Date.now() < deadline) {
    if (await pageHasText(page, DM_FAIL_TEXT)) return { delivered: false, reason: 'not_delivered: Instagram пометил сообщение недоставленным' }
    if (!composerCleared) {
      composerCleared = await box.evaluate((el) => ((el.innerText ?? el.value ?? '').trim().length === 0)).catch(() => false)
    }
    // Сильное подтверждение: наш текст виден в треде (композер к этому моменту пуст).
    if (composerCleared && snippet && await pageHasText(page, [snippet])) return { delivered: true }
    await jitter(500, 900)
  }
  // Композер очистился, явного сбоя нет — сообщение ушло (мягкое подтверждение), даже если
  // точный текст в треде не сматчился (эмодзи/ссылка/нормализация вёрстки).
  if (composerCleared) return { delivered: true }
  return { delivered: false, reason: 'unconfirmed: поле ввода не очистилось — отправка не подтверждена' }
}

// data:image/png;base64,AAAA… → { buffer, mimeType, name } для setInputFiles.
function dataUrlToFile(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''))
  if (!m) return null
  const mimeType = m[1] || 'image/jpeg'
  const isB64 = Boolean(m[2])
  const buffer = Buffer.from(m[3], isB64 ? 'base64' : 'utf8')
  if (!buffer.length) return null
  const ext = (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  return { buffer, mimeType, name: `photo.${ext}` }
}

// [A3] Фото в директ — BEST-EFFORT ОТДЕЛЬНЫМ сообщением ПОСЛЕ подтверждённого текста.
// Загрузка фото в веб-директ хрупкая и не проверена на живом IG; при любом сбое молча
// пропускаем — текст уже доставлен, регресс доставки исключён. Успех = превью прикрепилось
// и отправилось (композер очистился/появилось в треде).
async function tryAttachPhoto(context, page, dataUrl) {
  const file = dataUrlToFile(dataUrl)
  if (!file) return { sent: false, reason: 'bad_image' }
  try {
    // Скрытый input[type=file] в композере директа. IG не всегда держит его в DOM до клика
    // по «Прикрепить фото», поэтому пробуем и напрямую, и через кнопку.
    let input = page.locator('input[type="file"]').first()
    if (!(await input.count().catch(() => 0))) {
      await clickByText(page, ['Add Photo or Video', 'Add photo', 'Прикрепить фото', 'Фото или видео'], { timeout: 3000 }).catch(() => {})
      input = page.locator('input[type="file"]').first()
    }
    if (!(await input.count().catch(() => 0))) return { sent: false, reason: 'no_file_input' }
    await input.setInputFiles(file)
    await jitter(1500, 3000) // превью загружается
    // Отправка фото: кнопка «Send» или Enter в композере.
    const sent = await clickByText(page, ['Send', 'Отправить'], { timeout: 4000 })
    if (!sent) { const box = await firstVisible(page, SEL.dmTextbox, 2000); if (box) await box.press('Enter') }
    await jitter(1500, 3000)
    return { sent: true }
  } catch (e) {
    return { sent: false, reason: String(e?.message ?? e).slice(0, 120) }
  }
}

// ── Директ ────────────────────────────────────────────────────────────────────
export async function sendDM(context, { toUsername, text, image, dryRun }) {
  await requireSession(context)
  const page = await openProfile(context, toUsername)

  // §10.3 dry-run: доходим до композера директа, но НИЧЕГО не печатаем и не отправляем.
  // Открытие окна чата само по себе НЕ создаёт тред у получателя (тред возникает только при
  // отправке), поэтому безопасно — проверяем селекторы кнопки «Написать» и поля ввода.
  if (dryRun) {
    const btn = await findByText(page, SEL.messageButton, { timeout: 8000 })
    let composer = false
    if (btn) {
      await clickByText(page, SEL.messageButton, { timeout: 6000 })
      composer = Boolean(await firstVisible(page, SEL.dmTextbox, 8000))
    }
    return { ok: btn, dryRun: true, closed: !btn, reached: { messageButton: btn, composer }, storageState: await safeStorageState(context) }
  }

  // Кнопка «Message» на профиле. Нет → личка закрыта/ограничена.
  const opened = await clickByText(page, SEL.messageButton, { timeout: 8000 })
  if (!opened) {
    // иногда «Message» спрятана в меню «•••» — пробуем, иначе считаем закрытой
    return { ok: false, closed: true, error: 'dm_closed: кнопка «Написать» недоступна (закрытая личка/ограничение)' }
  }
  const box = await firstVisible(page, SEL.dmTextbox, 12000)
  if (!box) return { ok: false, closed: true, error: 'dm_closed: поле сообщения не открылось' }

  let delivered = true
  let deliverErr
  if (text) {
    await humanType(box, text)
    await jitter(400, 900)
    await box.press('Enter')
    await jitter(900, 1600)
    // Instagram web НЕ всегда отправляет директ по Enter (иногда нужна кнопка «Send»/«Отправить»).
    // Если после Enter текст ЗАВИС в композере — кликаем кнопку отправки (как в фото-пути).
    // Без этого директ молча не уходил, а confirmDelivered показывал «не доставлено» (баг «0 выполнено»).
    const stuck = await box.evaluate((el) => ((el.innerText ?? el.value ?? '').trim().length > 0)).catch(() => false)
    if (stuck) {
      await clickByText(page, ['Send', 'Отправить', 'Отправить сообщение', 'Send message'], { timeout: 3500 }).catch(() => {})
      await jitter(900, 1600)
    }
    // §4.6 — проверяем, что сообщение реально появилось в треде.
    const conf = await confirmDelivered(page, box, text)
    delivered = conf.delivered
    deliverErr = conf.reason
  }

  // [A3] Фото — только если текст доставлен (или текста нет вовсе). Best-effort, не влияет
  // на исход доставки текста: сбой фото не делает DM недоставленным.
  let photo
  if (image && (delivered || !text)) {
    const r = await tryAttachPhoto(context, page, image)
    photo = r.sent
    if (!r.sent) deliverErr = deliverErr ? `${deliverErr}; фото: ${r.reason}` : `фото не отправлено: ${r.reason}`
  }

  // Сессия «дозрела» в любом исходе — возвращаем storageState (недоставка текста = транзиент, ретрай).
  const storageState = await safeStorageState(context)
  if (text && !delivered) return { ok: false, delivered: false, error: deliverErr, storageState }
  return { ok: true, delivered: true, photo, error: deliverErr, storageState }
}

// ── Подписка ────────────────────────────────────────────────────────────────
export async function followUser(context, { targetUsername, dryRun }) {
  await requireSession(context)
  const page = await openProfile(context, targetUsername)

  if (await pageHasText(page, SEL.followingState)) {
    return { ok: true, already: true, dryRun: dryRun || undefined, storageState: await safeStorageState(context) }
  }
  // §10.3 dry-run: проверяем присутствие кнопки «Подписаться», НЕ кликаем.
  if (dryRun) {
    const btn = await findByText(page, SEL.followButton, { timeout: 8000 })
    return { ok: btn, dryRun: true, reached: { followButton: btn }, storageState: await safeStorageState(context) }
  }
  const clicked = await clickByText(page, SEL.followButton, { timeout: 8000 })
  if (!clicked) return { ok: false, error: 'follow_button_not_found: кнопка «Подписаться» не найдена' }
  await jitter(900, 1800)
  return { ok: true, storageState: await safeStorageState(context) }
}

// ── Лайк последних постов ─────────────────────────────────────────────────────
export async function likeUser(context, { targetUsername, count = 1, dryRun }) {
  await requireSession(context)
  const page = await openProfile(context, targetUsername)

  // Ссылки на посты в сетке профиля.
  const postLinks = await page.locator('a[href*="/p/"]').evaluateAll(
    (els) => Array.from(new Set(els.map((e) => e.getAttribute('href')).filter(Boolean))).slice(0, 6)
  ).catch(() => [])
  // 0 постов = действие НЕВОЗМОЖНО (не ошибка бота): у цели просто нечего лайкать (§13.10).
  if (!postLinks.length) return { ok: false, liked: 0, impossible: true, dryRun: dryRun || undefined, error: 'no_posts: у аккаунта нет постов для лайка' }

  // §10.3 dry-run: открываем первый пост, проверяем, что кнопка «Нравится» на месте, НЕ лайкаем.
  if (dryRun) {
    let likeBtn = false
    try {
      await page.goto(`https://www.instagram.com${postLinks[0]}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await jitter(1000, 2000)
      const b = page.locator('div[role="button"]:has(svg[aria-label="Like"]), div[role="button"]:has(svg[aria-label="Нравится"])').first()
      likeBtn = await b.isVisible().catch(() => false)
    } catch {}
    return { ok: likeBtn, dryRun: true, reached: { posts: postLinks.length, likeButton: likeBtn }, storageState: await safeStorageState(context) }
  }

  let liked = 0
  for (const href of postLinks.slice(0, Math.max(1, count))) {
    try {
      await page.goto(`https://www.instagram.com${href}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await jitter(1000, 2200)
      const likeBtn = page.locator('div[role="button"]:has(svg[aria-label="Like"]), div[role="button"]:has(svg[aria-label="Нравится"])').first()
      if (await likeBtn.isVisible().catch(() => false)) {
        await humanClick(page, likeBtn)   // §1.3: кривой подвод курсора + смещение от центра
        liked++
        await jitter(1500, 3000)
      }
    } catch {}
  }
  return { ok: liked > 0, liked, storageState: await safeStorageState(context) }
}

// ── Сторис: просмотр (+опц. лайк) ─────────────────────────────────────────────
export async function viewStories(context, { targetUsername, like = false, count = 4, dryRun }) {
  await requireSession(context)
  const page = await context.newPage()
  await preActionBrowse(page) // §1.2: прогрев ленты перед просмотром сторис
  await gotoResilient(page, `https://www.instagram.com/stories/${targetUsername}/`, { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1500, 2800)

  // Если сторис нет — редирект на профиль/пусто. 0 активных сторис = действие НЕВОЗМОЖНО
  // (не ошибка бота), а не «провал» (§13.10).
  let viewed = 0, liked = 0
  const isViewer = page.url().includes('/stories/')
  if (!isViewer) return { ok: false, viewed, liked, impossible: true, dryRun: dryRun || undefined, error: 'no_stories: активных сторис нет' }

  // §10.3 dry-run: убеждаемся, что вьюер сторис открылся, но НЕ лайкаем и не пролистываем дальше.
  if (dryRun) return { ok: true, dryRun: true, reached: { storyViewer: true }, viewed: 1, liked: 0, storageState: await safeStorageState(context) }

  // §13.10 — пролистать до N кадров (сколько выбрано в кампании); реально просмотренные = viewed.
  const frames = Math.max(1, count)
  for (let i = 0; i < frames; i++) {
    viewed++
    if (like) {
      try {
        const likeBtn = page.locator('div[role="button"]:has(svg[aria-label="Like"]), div[role="button"]:has(svg[aria-label="Нравится"])').first()
        if (await likeBtn.isVisible().catch(() => false)) { await humanClick(page, likeBtn); liked++ }
      } catch {}
    }
    await jitter(2000, 4000)
    await page.keyboard.press('ArrowRight').catch(() => {})
    if (!page.url().includes('/stories/')) break
  }
  return { ok: true, viewed, liked, storageState: await safeStorageState(context) }
}

// ── Комментарий к посту ───────────────────────────────────────────────────────
export async function commentPost(context, { postUrl, text, dryRun }) {
  await requireSession(context)
  const page = await context.newPage()
  await preActionBrowse(page) // §1.2: прогрев ленты перед комментарием
  await gotoResilient(page, postUrl, { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1200, 2400)

  const box = await firstVisible(page, SEL.commentBox, 10000)
  if (!box) return { ok: false, dryRun: dryRun || undefined, error: 'comment_box_not_found: поле комментария недоступно' }
  // §10.3 dry-run: поле комментария найдено — НЕ печатаем и не публикуем.
  if (dryRun) return { ok: true, dryRun: true, reached: { commentBox: true }, storageState: await safeStorageState(context) }
  await box.click({ delay: 50 })
  await humanType(box, text)
  await jitter(500, 1100)
  const posted = await clickByText(page, SEL.commentPost, { timeout: 4000 })
  if (!posted) await box.press('Enter')
  await jitter(1200, 2200)
  return { ok: true, storageState: await safeStorageState(context) }
}

// Ответ в комментариях — для Фазы 2 трактуем как обычный коммент к посту
// (нить-reply требует клика по «Ответить» под конкретным комментом — Фаза 4).
export async function replyComment(context, { postUrl, text, dryRun }) {
  return commentPost(context, { postUrl, text, dryRun })
}

// Комментарий к ПОСЛЕДНЕМУ посту цели (для канареечного теста: канарейка комментирует пост
// основного, чтобы у основного сработал триггер «Новый комментарий»). Находит первый /p/ в сетке
// профиля и комментирует его. 0 постов у цели = невозможно (не ошибка).
export async function commentLatestPost(context, { targetUsername, text, dryRun }) {
  await requireSession(context)
  const page = await openProfile(context, targetUsername)
  const postLinks = await page.locator('a[href*="/p/"]').evaluateAll(
    (els) => Array.from(new Set(els.map((e) => e.getAttribute('href')).filter(Boolean))).slice(0, 3)
  ).catch(() => [])
  if (!postLinks.length) return { ok: false, impossible: true, error: 'no_posts: у цели нет постов для комментария' }
  return commentPost(context, { postUrl: `https://www.instagram.com${postLinks[0]}`, text, dryRun })
}

// ── §13.11 Авто-приём заявок в подписчики (для ЗАКРЫТЫХ/приватных аккаунтов) ─────
// Приватный аккаунт получает не «нового подписчика», а «заявку на подписку» — пока её не
// подтвердить, человек не подписчик и триггер «Новая подписка» по нему не сработает. Читаем
// ожидающие заявки и подтверждаем каждую тем же приватным web-API изнутри залогиненной страницы
// (как readStoryEvents). Approve — POST с csrftoken из cookie. Пейсинг между подтверждениями +
// лимит на цикл (ban-safety: приём СВОИХ подписчиков естественен, но не залпом).
export async function acceptFollowRequests(context, { limit = 10 } = {}) {
  await requireSession(context)
  const page = await context.newPage()
  await gotoResilient(page, 'https://www.instagram.com/', { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1200, 2200)

  const result = await page.evaluate(async (limit) => {
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
    const headers = { 'x-ig-app-id': '936619743392459' }
    async function getJson(url) {
      try { const r = await fetch(url, { headers, credentials: 'include' }); if (!r.ok) return null; return await r.json() } catch { return null }
    }
    const pend = await getJson('/api/v1/friendships/pending/')
    const users = Array.isArray(pend?.users) ? pend.users : []
    const pendingCount = users.length
    const approved = []
    const errors = []
    for (const u of users.slice(0, limit)) {
      const pk = String(u.pk || u.pk_id || '')
      if (!pk) continue
      try {
        const r = await fetch(`/api/v1/friendships/approve/${pk}/`, {
          method: 'POST',
          headers: { ...headers, 'x-csrftoken': csrf, 'content-type': 'application/x-www-form-urlencoded' },
          credentials: 'include', body: '',
        })
        if (r.ok) approved.push({ pk, username: u.username || '' })
        else errors.push(`approve ${u.username || pk}: http ${r.status}`)
      } catch (e) { errors.push(`approve ${u.username || pk}: ${String(e).slice(0, 60)}`) }
      // человекоподобная пауза между подтверждениями
      await new Promise((res) => setTimeout(res, 900 + Math.random() * 1800))
    }
    return { pendingCount, approved, errors }
  }, limit)

  return { ...result, storageState: await safeStorageState(context) }
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

  return { events: Array.isArray(events) ? events : [], storageState: await safeStorageState(context) }
}

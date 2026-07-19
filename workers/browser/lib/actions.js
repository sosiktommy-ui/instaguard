// Действия аккаунта через браузер. См. plan.md §4.6. Каждое возвращает обновлённый
// storageState (сессия «дозревает»). Работают по username (навигация /{username}/).
import { SEL } from './selectors.js'
import { firstVisible, clickByText, findByText, pageHasText, hasSessionCookie, gotoResilient, safeStorageState } from './browser.js'
import { humanType, jitter, idleMouse, preActionBrowse, humanClick } from './human.js'
import { openNotifications } from './selfevents.js'   // §13.11 — DOM-приём заявок (не приватный API)
import { dismissInterstitials } from './login.js'     // §13.11 — закрыть всплывашки, перекрывающие иконку

// СВЕРКА ПРОФИЛЯ (§4.1): открытый URL должен вести ИМЕННО на @username. Совпадение — happy-path
// (по прямой ссылке первый сегмент пути = ник, поведение не меняется). Несовпадение = редирект
// на другой профиль / на главную (аккаунт удалён/переименован/недоступен) / на логин — тогда
// действовать НЕЛЬЗЯ (иначе действие «не тому»). Консервативно: блокируем ТОЛЬКО при явном
// расхождении первого сегмента, happy-path не трогаем.
function profileMatches(page, username) {
  try {
    const u = new URL(page.url())
    const seg = decodeURIComponent((u.pathname.split('/').filter(Boolean)[0] || '')).toLowerCase()
    return seg === String(username).toLowerCase()
  } catch { return false }
}

// §4.1 (B) ЖИВОЙ переход через ПОИСК: как человек — открыл поиск, набрал ник по буквам, кликнул
// точное совпадение. Локализованные aria-label иконки поиска. Всё best-effort: ЛЮБОЙ сбой → false
// → openProfile молча падает на прямой URL (текущее поведение, ничего не ломается). Точное
// совпадение href=`/{ник}/` + сверка профиля после клика = защита от «не того».
const SEARCH_NAV_LABELS = ['Search', 'Поиск', 'Пошук', 'Buscar', 'Pesquisar', 'Cari', 'Ara', 'Recherche', '検索', '검색', 'Cerca', 'Suche']
const SEARCH_PROB = 0.4   // доля переходов через поиск (варьируем: не искать одного 4 раза подряд = роботно)

async function tryOpenViaSearch(page, uname) {
  // Открыть панель поиска кликом по nav-иконке (мы уже на ленте после preActionBrowse).
  let opened = false
  for (const label of SEARCH_NAV_LABELS) {
    const nav = page.locator(`svg[aria-label="${label}"]`).first()
    if (await nav.isVisible().catch(() => false)) {
      const anc = nav.locator('xpath=ancestor::*[(@role="button") or (self::a) or (self::button)][1]')
      await humanClick(page, (await anc.count().catch(() => 0)) ? anc.first() : nav)
      opened = true
      break
    }
  }
  if (!opened) return false
  await jitter(700, 1400)
  const input = page.locator('input[aria-label*="Search" i], input[aria-label*="Поиск" i], input[aria-label*="Пошук" i], input[placeholder*="Search" i], input[placeholder*="Поиск" i]').first()
  if (!(await input.isVisible().catch(() => false))) return false
  await input.click({ delay: 40 }).catch(() => {})
  await humanType(input, uname)                 // печать ПО БУКВАМ (живое)
  await jitter(1200, 2200)                       // результаты подгружаются
  const result = page.locator(`a[href="/${uname}/"]`).first()   // ТОЧНОЕ совпадение ника
  if (!(await result.isVisible().catch(() => false))) return false
  await humanClick(page, result)
  await page.waitForLoadState('domcontentloaded').catch(() => {})
  await jitter(1000, 2000)
  return profileMatches(page, uname)
}

async function openProfile(context, username) {
  const uname = String(username).replace(/^@/, '').trim().toLowerCase()
  const page = await context.newPage()
  await preActionBrowse(page) // §1.2: полистать ленту перед заходом к цели — действие не «вхолодную»
  // §4.1 живой переход: варьированно пробуем ПОИСК, иначе — прямой URL (резерв). Поиск не удался/
  // открыл не того → тихо на URL (ничего не ломаем).
  let via = 'url'
  if (Math.random() < SEARCH_PROB) {
    try { if (await tryOpenViaSearch(page, uname)) via = 'search' } catch { /* → URL */ }
  }
  if (via !== 'search') {
    await gotoResilient(page, `https://www.instagram.com/${uname}/`, { timeout: 30000, retries: 1, backoffMs: [2000] })
    await jitter(1200, 2500)
    await idleMouse(page)
  }
  // §4.1 СВЕРКА: открыт НЕ тот профиль? Если пришли поиском — резерв прямой URL (и перепроверка);
  // если и URL дал не тот (удалён/переименован/недоступен) → НЕ действуем (retryable, повторим).
  if (!profileMatches(page, uname)) {
    if (via === 'search') {
      await gotoResilient(page, `https://www.instagram.com/${uname}/`, { timeout: 30000, retries: 1, backoffMs: [2000] }).catch(() => {})
      await jitter(1000, 2000)
    }
    if (!profileMatches(page, uname)) {
      const url = page.url()
      await page.close().catch(() => {})
      throw new Error(`wrong_profile: открылся не профиль @${uname} (${url}) — действие пропущено, повторим`)
    }
  }
  return page
}

function requireSession(context) {
  return hasSessionCookie(context).then((ok) => {
    if (!ok) throw new Error('login_required: сессия недействительна — нужен повторный вход')
  })
}

// Клик по «сердечку» лайка (посты И сторис). Прежний селектор `div[role="button"]:has(svg[aria-label="Like"])`
// был хрупким: (1) в сторис-вьюере обёртка НЕ div[role=button] (лайк не срабатывал вообще),
// (2) только EN/RU (для укр./исп./порт. аккаунтов aria-label иной → 0 лайков). Теперь ищем сам
// svg-heart по локализованному aria-label и кликаем его кликабельного предка (button|[role=button]),
// а если обёртки нет — сам svg. Возвращает true, если лайк нажат.
const LIKE_LABELS = ['Like', 'Нравится', 'Подобається', 'Me gusta', 'Curtir', 'J’aime', "J'aime", 'Suka', 'いいね！', '좋아요', 'Beğen']
// «Уже лайкнуто» (заполненное сердце) — для ПОДТВЕРЖДЕНИЯ лайка (§4.4).
const UNLIKE_LABELS = ['Unlike', 'Не нравится', 'Не подобається', 'Ya no me gusta', 'Descurtir', 'Je n’aime plus', "Je n'aime plus", 'Batalkan suka', 'Beğenmekten vazgeç', 'いいね！を取り消す', '좋아요 취소', 'Non mi piace più', 'Gefällt mir nicht mehr']

// §4.4 ПОДТВЕРЖДЕНИЕ лайка (ЛЕНИЕНТНО, без ложных «не выполнено»): true, если появилось «Unlike»
// (заполненное сердце) ИЛИ «Like»-сердце больше не видно (перерисовалось/detach). false ТОЛЬКО когда
// «Like»-сердце ЯВНО осталось на месте (клик не применился). Ничего не нашли → считаем ok (lenient).
async function likeConfirmed(page) {
  for (const l of UNLIKE_LABELS) {
    if (await page.locator(`svg[aria-label="${l}"]`).first().isVisible().catch(() => false)) return true
  }
  for (const l of LIKE_LABELS) {
    if (await page.locator(`svg[aria-label="${l}"]`).first().isVisible().catch(() => false)) return false
  }
  return true
}
async function clickLikeHeart(page, root) {
  const scope = root || page
  for (const label of LIKE_LABELS) {
    const heart = scope.locator(`svg[aria-label="${label}"]`).first()
    if (await heart.isVisible().catch(() => false)) {
      const anc = heart.locator('xpath=ancestor::*[(@role="button") or (self::button)][1]')
      const target = (await anc.count().catch(() => 0)) ? anc.first() : heart
      await humanClick(page, target)
      return true
    }
  }
  return false
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

// Есть ли на профиле КНОПКА состояния подписки («Вы подписаны»/«Запрос отправлен»)? Значит, мы
// уже подписаны (или заявка отправлена у приватного). ⚠️ Проверяем именно button-роль, а НЕ текст:
// слово «following» есть в счётчике статистики КАЖДОГО профиля («123 following») и раньше ложно
// матчилось pageHasText('Following') → followUser возвращал already:true для ВСЕХ = «подписка
// выполнена», хотя клика не было (жалоба «подписка писалась выполненной, но не выполнялась»).
async function hasFollowStateButton(page, timeout = 4000) {
  const deadline = Date.now() + timeout
  for (;;) {
    for (const n of SEL.followingState) {
      try {
        const b = page.getByRole('button', { name: n }).first()   // роль button не матчит текст статистики
        if (await b.isVisible().catch(() => false)) return true
      } catch {}
    }
    if (Date.now() >= deadline) return false
    await page.waitForTimeout(300)
  }
}

// ── Подписка ────────────────────────────────────────────────────────────────
export async function followUser(context, { targetUsername, dryRun }) {
  await requireSession(context)
  const page = await openProfile(context, targetUsername)

  // Уже подписаны/заявка отправлена — по КНОПКЕ состояния (не по тексту статистики, см. выше).
  if (await hasFollowStateButton(page, 2500)) {
    return { ok: true, already: true, dryRun: dryRun || undefined, storageState: await safeStorageState(context) }
  }
  // §10.3 dry-run: проверяем присутствие кнопки «Подписаться», НЕ кликаем.
  if (dryRun) {
    const btn = await findByText(page, SEL.followButton, { timeout: 8000 })
    return { ok: btn, dryRun: true, reached: { followButton: btn }, storageState: await safeStorageState(context) }
  }
  const clicked = await clickByText(page, SEL.followButton, { timeout: 8000 })
  if (!clicked) return { ok: false, error: 'follow_button_not_found: кнопка «Подписаться» не найдена', storageState: await safeStorageState(context) }
  await jitter(900, 1800)
  // ПОДТВЕРЖДЕНИЕ: кнопка реально сменилась на «Вы подписаны»/«Запрос отправлен». Без этого клик,
  // который не применился (перехват/анти-бот/промах), писался как «выполнено».
  if (!(await hasFollowStateButton(page, 6000))) {
    return { ok: false, error: 'follow_unconfirmed: после клика кнопка не сменилась на «Вы подписаны» — подписка не применилась', storageState: await safeStorageState(context) }
  }
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
      if (await clickLikeHeart(page)) {   // локализованный + любая обёртка (§1.3 humanClick внутри)
        await jitter(700, 1400)
        // §4.4 подтверждение: засчитываем лайк, только если сердце реально переключилось (иначе клик
        // не применился). Ленивентно — detach/неопределённость → считаем ok (без ложных «не лайкнуто»).
        if (await likeConfirmed(page)) { liked++; await jitter(1200, 2600) }
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
    // Дать кадру ОТРИСОВАТЬСЯ, прежде чем лайкать/листать — иначе первый кадр не успевал
    // «засчитаться»/залайкаться (жалоба «посмотрел 2й, а 1й нет; лайков 0»).
    await jitter(900, 1700)
    if (like) {
      try { if (await clickLikeHeart(page)) liked++ } catch {}
    }
    await jitter(1600, 3200)   // «человек смотрит» кадр
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
  // ПОДТВЕРЖДЕНИЕ: опубликованный коммент ОЧИЩАЕТ поле ввода (или заменяет его на новое). Если
  // текст ЗАВИС в поле — публикация не прошла (как и в директе: composer очищается только при приёме).
  // detached/gone → catch→false → «не завис» → считаем опубликованным; текст остался → не опубликован.
  const stuck = await box.evaluate((el) => ((el.innerText ?? el.value ?? '').trim().length > 0)).catch(() => false)
  if (stuck) return { ok: false, error: 'comment_unconfirmed: комментарий не опубликовался (поле не очистилось)', storageState: await safeStorageState(context) }
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
// §13.11 — авто-приём заявок в подписчики (приватный аккаунт) ЧЕЛОВЕКОПОДОБНО, через DOM.
// ⚠️ РАНЬШЕ приём шёл через приватный API (`friendships/pending`+`approve`) — это ЖИВОЙ кейс
// бана (2026-07-19): approve отдавал HTTP 200, но НЕ подтверждал заявку (Instagram детектит
// приватный API-write), и СЕССИЯ УМИРАЛА сразу после (login_required) → аккаунт «кикнуло».
// Приватный API-write = ADR-002-запрет, ровно то, ради ухода от чего проект переписан на эмуль.
// Теперь приём как у человека: открыть панель уведомлений → нажать «Confirm»/«Підтвердити» →
// СВЕРИТЬ, что строка исчезла (реально подтвердилось, а не «наебало»). Никаких API-вызовов.
const CONFIRM_LABELS = /^(confirm|підтвердити|подтвердить|confirmar|confirmer|konfirmasi|onayla|potwierdź|bestätigen|conferma|承認|확인)$/i
const REQ_GROUP = /follow requests|запити на стеження|запросы на подписку|solicitudes|permintaan mengikuti|takip istekleri/i
const NOTIF_HEAD = /notifications|сповіщенн|уведомлен|activity|діяльн|актив|actividad|aktivit|bildirim|powiadomien/i

// Флайаут уведомлений реально ОТКРЫТ (а не «мы что-то кликнули»): виден заголовок панели ЛИБО
// группа заявок ЛИБО кнопка «Confirm». Отличает «панель не открылась» (иконку не нашли — всплывашка
// перекрыла) от «панель открыта, заявок 0».
async function notifPanelOpen(page) {
  try { if (await page.getByRole('heading', { name: NOTIF_HEAD }).first().isVisible().catch(() => false)) return true } catch { /* нет заголовка */ }
  try { if (await page.getByText(REQ_GROUP).first().isVisible().catch(() => false)) return true } catch { /* нет группы */ }
  try { if (await page.getByRole('button', { name: CONFIRM_LABELS }).first().isVisible().catch(() => false)) return true } catch { /* нет кнопок */ }
  return false
}

export async function acceptFollowRequests(context, { limit = 10 } = {}) {
  await requireSession(context)
  const page = await context.newPage()
  await gotoResilient(page, 'https://www.instagram.com/', { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1500, 2600)
  // 🔴 Свежий вход по кукам почти всегда даёт всплывашки («Зберегти дані входу?»/«Увімкнути
  // сповіщення?»/cookie), которые ПЕРЕКРЫВАЮТ/ПРЯЧУТ иконку уведомлений → раньше приём падал
  // «панель не открылась». Закрываем их ПЕРЕД поиском иконки (мультиязычно, вкл. укр. «Не зараз»).
  await dismissInterstitials(page).catch(() => {})
  await preActionBrowse(page).catch(() => {})   // микро-браузинг перед действием (не «холодный» клик)

  const approved = []
  const errors = []
  let panelOpened = false
  let pendingCount = 0

  try {
    // Открываем флайаут уведомлений. Всплывашка может выскочить и ПОСЛЕ клика → закрываем снова.
    // До 2 попыток: не открылось — ещё раз закрыть всплывашки и открыть.
    for (let attempt = 0; attempt < 2 && !panelOpened; attempt++) {
      const clicked = await openNotifications(page)
      await dismissInterstitials(page).catch(() => {})   // всплывашка могла появиться после клика
      await jitter(1200, 2000)
      panelOpened = clicked || await notifPanelOpen(page)
      if (!panelOpened) { await dismissInterstitials(page).catch(() => {}); await jitter(900, 1500) }
    }

    // Заявки иногда скрыты под группой «Запити на стеження» — раскрываем в список.
    try {
      const grp = page.getByText(REQ_GROUP).first()
      if (await grp.isVisible().catch(() => false)) { await grp.click({ timeout: 3000 }).catch(() => {}); await jitter(1500, 2600) }
    } catch { /* группы нет — заявки прямо в панели */ }

    pendingCount = await page.getByRole('button', { name: CONFIRM_LABELS }).count().catch(() => 0)

    // Подтверждаем по одной: успешный клик убирает строку → следующая заявка становится первой.
    for (let i = 0; i < limit; i++) {
      const btns = page.getByRole('button', { name: CONFIRM_LABELS })
      const before = await btns.count().catch(() => 0)
      if (before === 0) break
      const btn = btns.first()
      // Ник заявителя — из ближайшей ссылки на профиль в той же строке (для триггера/лога).
      const username = await btn.evaluate((el) => {
        let row = el
        for (let k = 0; k < 8 && row.parentElement; k++) {
          row = row.parentElement
          const a = row.querySelector('a[href^="/"]')
          if (a) { const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9._]+)\/$/); if (m && !['p', 'reel', 'explore', 'direct', 'stories'].includes(m[1])) return m[1] }
        }
        return ''
      }).catch(() => '')
      if (!username) { errors.push('строка заявки без профиля — приём остановлен (не кликаем вслепую)'); break }
      let clicked = await humanClick(page, btn).catch(() => false)
      if (!clicked) clicked = await btn.click({ timeout: 4000 }).then(() => true).catch(() => false)
      if (!clicked) { errors.push(`confirm @${username}: клик не прошёл`); break }
      await jitter(1600, 3000)   // строка обрабатывается/исчезает
      // СВЕРКА: кнопок «Confirm» стало меньше → заявка реально подтверждена (не ложный успех).
      const after = await page.getByRole('button', { name: CONFIRM_LABELS }).count().catch(() => before)
      if (after >= before) { errors.push(`confirm @${username}: не подтвердилось (строка осталась)`); break }
      approved.push({ pk: '', username })
    }
  } catch (e) {
    errors.push(`accept: ${String(e?.message || e).slice(0, 90)}`)
  }

  // Диагностика: 0 принято → дамп РЕАЛЬНОЙ структуры (какие есть nav-иконки по aria-label, висящие
  // диалоги-всплывашки, тексты кнопок, url, текст панели). По нему точечно правим селекторы БЕЗ
  // риска для аккаунта (DOM-клики/чтение сессию не убивают). Отвечает на «он не находит нужное поле».
  let sample = ''
  if (!approved.length) {
    const d = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
      const nav = [...new Set(Array.from(document.querySelectorAll('svg[aria-label], a[aria-label], [role="button"][aria-label]')).map((e) => e.getAttribute('aria-label')).filter(Boolean))].slice(0, 30)
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).map((x) => clean(x.innerText).slice(0, 90))
      const buttons = [...new Set(Array.from(document.querySelectorAll('button')).map((b) => clean(b.textContent)).filter(Boolean))].slice(0, 25)
      const scope = document.querySelector('div[role="dialog"]') || document.body
      return { url: location.pathname, nav, dialogs, buttons, text: clean(scope.innerText).slice(0, 350) }
    }).catch(() => null)
    sample = d ? `url=${d.url} | nav=[${d.nav.join(', ')}] | dialogs=${JSON.stringify(d.dialogs)} | buttons=[${d.buttons.join(', ')}] | text="${d.text}"` : ''
  }

  return {
    pendingCount, approved, errors,
    panelOpened, sample,
    fetchFailed: !panelOpened,   // панель не открылась = не смогли прочитать заявки (не «их нет»)
    storageState: await safeStorageState(context),
  }
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

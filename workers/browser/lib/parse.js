// Парсинг черновыми (HELPER) аккаунтами через DOM браузера — plan.md §4.4/§5.
// ⚠️ ЭКСПЕРИМЕНТАЛЬНО: не проверялось на живом Instagram (нет тестового HELPER-аккаунта
// в этой сессии). Верстка модалок подписчиков/лайкнувших у Instagram виртуализирована и
// часто меняется — код защищён try/catch на каждом шаге и НИКОГДА не должен ронять весь
// цикл поллинга (см. scrape() в app/api/poll/route.ts — сбой парсинга = WARN, не ошибка
// основного). В отличие от HikerAPI, DOM не отдаёт числовой pk — используем username как
// стабильный суррогат идентификатора (он уникален и не меняется чаще pk на практике).
import { jitter, idleMouse } from './human.js'
import { gotoResilient } from './browser.js'

async function openDialogAt(context, url) {
  const page = await context.newPage()
  await gotoResilient(page, url, { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1500, 2600)
  await idleMouse(page)
  const dialog = page.locator('div[role="dialog"]').first()
  const ok = await dialog.isVisible({ timeout: 8000 }).catch(() => false)
  return { page, dialog, ok }
}

// Собирает уникальные @username из ссылок вида /username/ внутри диалога, докручивая его.
async function scrollCollectUsernames(page, dialog, { limit = 50, maxScrolls = 20 } = {}) {
  const seen = new Set()
  let stagnant = 0
  for (let i = 0; i < maxScrolls && seen.size < limit; i++) {
    const batch = await dialog.locator('a[href^="/"]').evaluateAll((els) =>
      Array.from(new Set(els
        .map((e) => (e.getAttribute('href') || '').match(/^\/([a-zA-Z0-9._]{1,30})\/?$/)?.[1])
        .filter(Boolean)))
    ).catch(() => [])
    const before = seen.size
    for (const u of batch) { if (u && u !== 'explore' && u !== 'reels') seen.add(u) }
    if (seen.size === before) stagnant++; else stagnant = 0
    if (stagnant >= 3) break
    try {
      await dialog.evaluate((el) => {
        const scroller = el.querySelector('div[style*="overflow"]') || el
        scroller.scrollTop = scroller.scrollHeight
      })
    } catch {}
    await jitter(700, 1300)
  }
  return Array.from(seen).slice(0, limit)
}

// ── Подписчики / подписки ──────────────────────────────────────────────────
async function parseUserList(context, { targetUsername, limit = 50 }, kind) {
  const { page, dialog, ok } = await openDialogAt(context, `https://www.instagram.com/${targetUsername}/${kind}/`)
  try {
    if (!ok) return { items: [], error: 'dialog_not_found: список не открылся (приватный аккаунт / изменилась вёрстка)' }
    const usernames = await scrollCollectUsernames(page, dialog, { limit })
    return { items: usernames.map((username) => ({ pk: username, username })) }
  } finally {
    await page.close().catch(() => {})
  }
}

export async function parseFollowers(context, opts) {
  const r = await parseUserList(context, opts, 'followers')
  return { followers: r.items, error: r.error }
}

export async function parseFollowing(context, opts) {
  const r = await parseUserList(context, opts, 'following')
  return { following: r.items, error: r.error }
}

// ── Последние посты владельца (для комментов/лайкнувших) ────────────────────
async function recentPostUrls(page, targetUsername, count) {
  await gotoResilient(page, `https://www.instagram.com/${targetUsername}/`, { timeout: 30000, retries: 1, backoffMs: [2000] })
  await jitter(1200, 2200)
  const hrefs = await page.locator('a[href*="/p/"]').evaluateAll((els) =>
    Array.from(new Set(els.map((e) => e.getAttribute('href')).filter(Boolean)))
  ).catch(() => [])
  return hrefs.slice(0, count).map((h) => (h.startsWith('http') ? h : `https://www.instagram.com${h}`))
}

function shortcodeFromUrl(url) {
  return url.match(/\/p\/([^/]+)\//)?.[1] ?? url
}

// ── Комментарии под последними постами ───────────────────────────────────────
export async function parseComments(context, { targetUsername, mediaCount = 3, perMedia = 20 }) {
  const page = await context.newPage()
  const out = []
  try {
    const posts = await recentPostUrls(page, targetUsername, mediaCount)
    for (const postUrl of posts) {
      const mediaId = shortcodeFromUrl(postUrl) // суррогат: используем shortcode как media_id (postUrl строится обратно из него же в poll/route.ts)
      try {
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await jitter(1000, 1800)
        // Комментарии — список <ul>/<li> под постом; текст берём из ролей "comment"/ссылок на профиль рядом.
        const rows = await page.locator('ul li:has(a[href^="/"])').evaluateAll((els, self) =>
          els.slice(0, 60).map((li) => {
            const a = li.querySelector('a[href^="/"]')
            const uname = (a?.getAttribute('href') || '').match(/^\/([a-zA-Z0-9._]{1,30})\/?$/)?.[1]
            const span = li.querySelector('span')
            const text = span?.textContent ?? ''
            return uname && uname !== self ? { username: uname, text } : null
          }).filter(Boolean)
        , targetUsername).catch(() => [])
        for (const r of rows.slice(0, perMedia)) {
          out.push({ pk: `${mediaId}_${r.username}_${out.length}`, text: r.text, user_pk: r.username, username: r.username, media_id: mediaId })
        }
      } catch { /* один пост не отдал комменты — пропускаем, не валим весь парсинг */ }
    }
  } finally {
    await page.close().catch(() => {})
  }
  return { comments: out }
}

// ── Лайкнувшие последние посты ────────────────────────────────────────────────
export async function parseLikers(context, { targetUsername, mediaCount = 3, perMedia = 50 }) {
  const page = await context.newPage()
  const out = []
  const seen = new Set()
  try {
    const posts = await recentPostUrls(page, targetUsername, mediaCount)
    for (const postUrl of posts) {
      const mediaId = shortcodeFromUrl(postUrl)
      try {
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await jitter(1000, 1800)
        // Открыть диалог «Нравится N пользователям» кликом по счётчику лайков.
        const likesLink = page.getByText(/like|нрав/i).first()
        if (!(await likesLink.isVisible().catch(() => false))) continue
        await likesLink.click({ delay: 50 }).catch(() => {})
        const dialog = page.locator('div[role="dialog"]').last()
        const ok = await dialog.isVisible({ timeout: 5000 }).catch(() => false)
        if (!ok) continue
        const usernames = await scrollCollectUsernames(page, dialog, { limit: perMedia })
        for (const username of usernames) {
          if (seen.has(username) || username.toLowerCase() === targetUsername.toLowerCase()) continue
          seen.add(username)
          out.push({ pk: username, username, media_id: mediaId })
        }
        await page.keyboard.press('Escape').catch(() => {})
      } catch { /* пост без доступного списка лайкнувших — пропускаем */ }
    }
  } finally {
    await page.close().catch(() => {})
  }
  return { likers: out }
}

# Браузерный воркер (эмуль)

Playwright + Chromium — вход и действия Instagram через настоящий браузер. Заменяет приватный
API (instagrapi), который не логинится. См. корневой `plan.md` §4.

## Деплой (Railway)
- Отдельный сервис, **Root Directory = `workers/browser`**, builder = Dockerfile (`railway.json`).
- Переменные: `BROWSER_WORKER_SECRET` (тот же, что `BROWSER_WORKER_SECRET` в Next.js), `BROWSER_CONCURRENCY` (1–2), `PORT` (Railway сам).
- В Next.js-сервисе задать `BROWSER_WORKER_URL` (публичный домен этого сервиса) + `BROWSER_WORKER_SECRET`.
- Проверка: `GET <url>/health` → `{ build:"2026-07-09-browser-1", chromium:"...", concurrency }`.

## Локально
```
cd workers/browser
npm install
npx playwright install chromium      # браузер для локального запуска
BROWSER_HEADFUL=1 BROWSER_WORKER_SECRET=dev node server.js
```

## Эндпоинты
- `GET /health`
- `POST /login {username,password,proxy?,totpSecret?}` → `{ok,browserState,username}` | `{needsCheckpoint,channel}` | `{needs2fa}` | 400 `{error,message}`
- `POST /login/checkpoint {username,code}` → `{ok,browserState,username}`
- `POST /login/resend {username}` · `POST /login/cookies {storageState|cookies,proxy?}` · `POST /session/test {storageState,proxy?}`
- Действия: `POST /dm|/follow|/like|/stories|/comment|/reply-comment {username,storageState,proxy?, ...}` → `{ok,storageState,...}`

Все ответы действий возвращают обновлённый `storageState` — Next.js сохраняет его в `InstagramAccount.browserState`.

## ⚠️ Требует живой проверки
Селекторы/детекция состояний Instagram-web выверяются только на реальном входе (аккаунт + чистый
прокси) после деплоя — локально запросы к Instagram не воспроизвести. Селекторы вынесены в
`lib/selectors.js` с фолбэками; при сбое подстраивать там.

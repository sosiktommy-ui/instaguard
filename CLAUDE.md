# InstaGuard — CLAUDE.md

Журнал всех изменений и архитектурных решений. Обновляется при каждом значимом изменении.

---

## Стек

| Слой | Технология |
|---|---|
| Frontend + Backend | Next.js 15.5.19 (App Router) |
| БД | PostgreSQL (Railway) + Prisma 5.22.0 |
| Очереди | BullMQ + Redis (Railway) |
| Instagram-автоматизация | Python FastAPI + instagrapi 2.1.3 (отдельный Railway-сервис) |
| Состояние клиента | Zustand с persist (`instaguard-store` v4) |
| Стили | Tailwind CSS, Apple/iOS дизайн-система |
| Деплой | Railway (Nixpacks для Next.js, Dockerfile для Python) |

---

## Архитектура

### Next.js сервис (`gallant-generosity`)
- **App Router** с группой `(dashboard)` — группа НЕ добавляет сегмент к URL
- Все dashboard-страницы на: `/`, `/accounts`, `/triggers`, `/drafts`, `/logs`, `/settings`
- `(auth)/login` → `/login`
- `app/page.tsx` — удалён, чтобы не конфликтовал с `(dashboard)/page.tsx`
- `(dashboard)/page.tsx` делает `redirect('/triggers')`

### Python воркер (`workers/python/`)
- Отдельный Railway-сервис, Root Directory = `workers/python`
- Запускается через Dockerfile
- URL передаётся в Next.js через `PYTHON_WORKER_URL`
- Секрет: переменная `WORKER_SECRET` в Python-сервисе; `PYTHON_WORKER_SECRET` в Next.js-сервисе

### API роуты (Next.js)
| Роут | Метод | Назначение |
|---|---|---|
| `/api/auth/login` | POST | Логин пользователя (bcrypt + JWT-сессия) |
| `/api/accounts` | GET | Список Instagram-аккаунтов из БД |
| `/api/accounts/auth` | POST | Авторизация Instagram-аккаунта через Python-воркер |
| `/api/accounts/[id]` | DELETE, PATCH | Удаление / обновление аккаунта |
| `/api/poll` | POST | Проверить подписчиков, отправить DM по триггерам |
| `/api/logs` | GET | Последние 80 логов из БД |

### Python воркер — эндпоинты (`workers/python/worker.py`)
| Эндпоинт | Назначение |
|---|---|
| `POST /login` | Логин instagrapi, возвращает `sessionData` |
| `POST /test-session` | Проверка что сессия жива |
| `POST /followers` | Получить подписчиков аккаунта |
| `POST /send-dm` | Отправить DM пользователю |

---

## Переменные окружения

### Next.js сервис (gallant-generosity)
```
DATABASE_URL          # PostgreSQL (Railway)
REDIS_URL             # Redis (Railway)
JWT_SECRET            # Секрет для JWT-сессий
PYTHON_WORKER_URL     # URL Python-воркера (публичный домен Railway)
PYTHON_WORKER_SECRET  # Секрет для авторизации запросов к воркеру
```

### Python-воркер
```
WORKER_SECRET         # Секрет (должен совпадать с PYTHON_WORKER_SECRET в Next.js)
PORT                  # Устанавливается Railway автоматически
```

---

## Ключевые файлы

```
app/
  (auth)/login/page.tsx          — страница входа (demo-bypass: demo@instaguard.com / demo1234)
  (dashboard)/
    layout.tsx                   — TopNav + SimulationProvider (отключён)
    page.tsx                     — redirect('/triggers')
    accounts/page.tsx            — добавление/удаление аккаунтов, реальная авторизация
    triggers/page.tsx            — управление триггерами
    logs/page.tsx                — просмотр логов
  api/                           — все API роуты (см. таблицу выше)

lib/
  store.ts                       — Zustand-стор (типы Account, Trigger, LogEntry и др.)
  instagram/client.ts            — обёртка над Python-воркером (workerFetch)
  prisma.ts                      — singleton Prisma-клиент

components/
  common/SimulationProvider.tsx  — ОТКЛЮЧЁН (возвращает null, симуляция убрана)
  common/ClientOnly.tsx          — обёртка против SSR-гидрации
  ui/button.tsx                  — кнопка (variants: primary/secondary/ghost/danger)
  ui/Tilt.tsx                    — 3D-карточка

workers/python/
  worker.py                      — FastAPI-приложение
  instagrapi_client.py           — обёртки над instagrapi
  requirements.txt               — instagrapi==2.1.3, Pillow, fastapi, uvicorn
  Dockerfile                     — python:3.11-slim, слушает $PORT
  railway.json                   — builder: DOCKERFILE

prisma/schema.prisma             — схема БД
nixpacks.toml                    — конфиг Railway для Next.js (Node 20, PORT=3000)
railway.json                     — конфиг Railway (NIXPACKS, npm start)
```

---

## История изменений

### 2026-06-24

#### feat: авторизация через куки
- `workers/python/instagrapi_client.py`: новая функция `login_by_cookies(cookies, proxy)` — устанавливает `cl.cookie_dict`, верифицирует через `get_timeline_feed()`, возвращает `(settings, username)`
- `workers/python/worker.py`: новый эндпоинт `POST /login-cookies`, модель `CookiePayload`
- `lib/instagram/client.ts`: новая функция `loginByCookies(cookies, proxy?)`
- `app/api/accounts/auth/route.ts`: поддержка `authMethod: 'cookies'` — парсит JSON или raw sessionid строку
- `app/(dashboard)/accounts/page.tsx`: AddModal — переключатель режимов [Логин/Пароль | Куки], в режиме Куки — textarea для JSON или sessionid

---

### 2026-06-23

#### fix: точные ошибки instagrapi при логине
- `worker.py`: определение ошибки по `type(e).__name__` вместо строкового матчинга
- Обрабатываются: `BadPassword`, `TwoFactorRequired`, `ChallengeRequired`, `FeedbackRequired`, `SentryBlock`, `PleaseWaitFewMinutes`, `LoginRequired`
- `lib/instagram/client.ts` (`workerFetch`): при ошибке извлекает поле `detail` из JSON вместо показа сырого текста

#### fix: имя переменной секрета в Python-воркере
- `worker.py` строка 13: исправлено `PYTHON_WORKER_SECRET` → `WORKER_SECRET` (совпадает с Railway Variables)

#### fix: обработка ошибок в /login, /followers, /send-dm
- Все три эндпоинта обёрнуты в `try/except`
- При ошибке возвращают HTTP 400 с читаемым сообщением вместо HTTP 500

---

### 2026-06-21

#### feat: реальная Instagram-автоматизация (замена симуляции)
- `SimulationProvider` отключён — `tick()` больше не генерирует фейковые события
- Созданы реальные API роуты: `/api/accounts`, `/api/accounts/auth`, `/api/accounts/[id]`, `/api/poll`, `/api/logs`
- `accounts/page.tsx` переписан: AddModal запрашивает логин/пароль/прокси, авторизуется через Python-воркер
- `lib/instagram/client.ts`: функции `loginByCredentials`, `getFollowers`, `sendDM`, `testSession`
- Python-воркер задеплоен как отдельный Railway-сервис (Root Directory: `workers/python`)

#### fix: Pillow для instagrapi
- `requirements.txt`: добавлен `Pillow>=8.1.1` (instagrapi требует PIL)

---

### Ранее (первоначальный деплой)

- Исправлена уязвимость CVE: `next` обновлён с 15.0.3 до 15.5.19
- Добавлен размер `sm` в `Button` компонент
- Исправлено сужение типов в `logs/page.tsx` (`as const`)
- Исправлен конфликт типов BullMQ/IORedis: передавать `{ url: string }` вместо `IORedis`-инстанса
- Исправлен PORT: Next.js слушает `${PORT:-3000}`, Railway networking → 3000
- Удалён `Dockerfile` для Next.js (конфликтовал с Nixpacks)
- Исправлен роутинг: удалён `app/page.tsx`, логин редиректит на `/` (не `/dashboard`)
- Добавлен `public/.gitkeep` чтобы `COPY public/ .` в Dockerfile не падал

---

## Известные ограничения / TODO

- [ ] Авто-поллинг подписчиков (сейчас только кнопка "Проверить подписчиков")
- [ ] Instagram challenge flow (нужно подтверждение в приложении при входе с нового IP)
- [ ] Seed для demo-пользователя в Railway БД (`prisma db seed`)
- [ ] Дополнительные действия триггеров помимо DM (лайк, комментарий и т.д.)

---

## Правила разработки

- **НИКОГДА** не писать `telegram/tg/тг/телеграм` в запросах воркеров
- BullMQ: передавать `{ url: REDIS_URL }` строкой, не IORedis-инстансом
- Next.js 15 async params: `params` — это `Promise<{ id: string }>`, нужен `await`
- Railway Root Directory для Python-воркера: устанавливается через "Add Root Directory" в Source → Settings
- После смены пароля Instagram: нужно подтвердить вход через приложение перед логином через instagrapi

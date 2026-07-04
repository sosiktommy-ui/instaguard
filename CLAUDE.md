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
| `/api/triggers` | GET | Список триггеров из БД |
| `/api/triggers` | POST | Создать триггеры (по одному на аккаунт) |
| `/api/triggers/[id]` | DELETE | Удалить триггер |
| `/api/triggers/[id]` | PATCH | Переключить isActive |

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

### 2026-07-04

#### redesign(H1+D3): успокоение эффектов + ярлык «ТРИГГЕР» на карточке + баннер только на «Аккаунтах»

- **Успокоены эффекты (план H1).** `components/ui/Tilt.tsx` — наклон за курсором убран (теперь проходная обёртка). Из `globals.css` удалены `pulse-glow`, `sheen`, `float-y`, `neon`/`spin-border`, `halo`, `grad-anim`, орбы (`drift-*`/`.orb`). Оставлены мягкие тени (`card-3d`, `gloss`) и плавное появление (`rise`). В `triggers/page.tsx` сняты классы `neon/neon-on`, `pulse-glow`, `float-y`, `sheen grad-anim`; убран импорт `Tilt`. В `login` снят `float-y`.
- **Карточка кампании — ярлык «ТРИГГЕР» (план D3).** Блок триггера теперь с шапкой-ярлыком «Триггер» в стиле блока «Действия» (без крупной аватарки — маленькая иконка типа). Триггер и действия визуально разделены одинаково.
- **Баннер «нет черновых» — только на вкладке «Аккаунты».** `DraftsStatus` получил проп `showBanner`; на главной (`triggers/page.tsx`) — `showBanner={false}` (остаётся лишь строка-счётчик черновых).

### 2026-07-03

#### feat(A): SaaS-фундамент — мультитенантность, публичная регистрация, изоляция по userId

- **Реальные сессии на пользователя.** `lib/auth.ts`: `getUserOrFirst()` больше НЕ возвращает «первого юзера БД», а отдаёт пользователя JWT-сессии (`getCurrentUser`). Имя оставлено, чтобы не трогать импорты.
- **Публичная регистрация:** `app/api/auth/register/route.ts` (email+пароль, bcrypt, валидация, `plan:'free'`, сразу создаёт сессию), страница `app/(auth)/register/page.tsx`, ссылки логин↔регистрация. Middleware: `/register` и `/api/auth/register` в `PUBLIC_PATHS`.
- **Реальный выход:** `app/api/auth/logout/route.ts` (удаляет куку) + `handleLogout` в `TopNav` (чистит `instaguard-store`). Раньше кнопка только редиректила на `/login`, а кука оставалась.
- **Изоляция данных по `userId` во ВСЕХ API:**
  - `/api/accounts` (GET) — фильтр `where:{userId}` (раньше отдавал ВСЕ аккаунты!).
  - `/api/accounts/auth` — привязка к юзеру сессии (не к «первому»), проверка что раздел его.
  - `/api/accounts/[id]` (DELETE/PATCH) и `/reset-snapshot` — проверка владения.
  - `/api/triggers` (POST) — проверка, что выбранные аккаунты принадлежат юзеру.
  - `/api/logs` — фильтр по `account.userId` (раньше отдавал все логи).
  - `/api/poll` — крон (по `x-internal-secret`) обрабатывает все тенанты; ручной вызов из UI скоупится по юзеру сессии.
  - Триггеры/шаблоны/разделы уже фильтровались по `user.id` — теперь это юзер сессии.
- **Поле плана:** `User.plan String @default("free")` (миграция `20260703120000_user_plan`) — задел под биллинг, оплата не включена.
- **Убран авто-сид владельца** из `instrumentation.ts` (перезаписывал первого юзера email/паролем из `DEFAULT_USER_EMAIL/PASSWORD` — костыль под одного, ломал изоляцию). Переменные `DEFAULT_USER_*` больше не используются.
- ⚠️ Существующие данные остаются привязаны к прежнему владельцу (недеструктивно): вход под его email покажет их; новые регистрации стартуют пустыми.

#### redesign(C2): разделы/подразделы (папки) + фильтры аккаунтов

- **Модель `Section`** (`prisma/schema.prisma`): `{ id, userId, parentId?, name }`, самоссылка `SectionTree` (двухуровневая иерархия: раздел → подраздел). У `InstagramAccount` — `sectionId?` (FK `ON DELETE SET NULL`). Миграция `20260703000000_add_sections` (идемпотентная, применяется через `prisma migrate deploy` в `start`).
- **API:** `app/api/sections/route.ts` (GET со счётчиком аккаунтов, POST — раздел/подраздел, ограничение 2 уровня), `app/api/sections/[id]/route.ts` (DELETE каскадом подразделов + обнуление `sectionId` у аккаунтов; PATCH — переименование). Скоуп по `getUserOrFirst()`.
- **Аккаунты:** `/api/accounts` (GET) отдаёт `sectionId`; `/api/accounts/auth` принимает `sectionId` при создании; `/api/accounts/[id]` (PATCH) — `sectionId` в `PATCHABLE`.
- **Фронт:** `components/accounts/SectionBar.tsx` — чипы «Все» + разделы + «+ Раздел»; при выборе раздела второй ряд подразделов + «+ Подраздел»; создание инлайн-инпутом, удаление с попапом-подтверждением (§D2). На главном экране (`triggers/page.tsx`) — фильтр `visibleAccounts` по разделу/подразделу (раздел включает свои подразделы). В попапе добавления (`AddAccountModal`) и в модалке деталей (`accounts/page.tsx`) — выбор/смена раздела (два `select`).

#### rebrand: ReactiveGram + фиолетовая палитра

- **Название сервиса:** везде `ShadowGram` → **ReactiveGram** (`layout.tsx` title, `login`, `TopNav`, title Python-воркера).
- **Логотип:** `components/common/AppLogo.tsx` теперь рендерит `/Foto/reactive.png` (файл в `public/Foto/reactive.png`). Favicon — `app/icon.png` (копия иконки); удалены старые генераторы `app/icon.svg` и `app/icon.tsx`.
- **Палитра:** синий бренд заменён на фиолетовый. `--brand #0071e3 → #663af1`; вторичный `#5e5ce6 → #6a7df9`; светлый акцент/градиенты `#9b66ff`. Обновлены `tailwind.config.ts` (brand.DEFAULT/hover/light/alt), `globals.css` (selection, aurora, neon, halo) и hex-цвета в `triggers/accounts/drafts/stats`.

#### redesign(B2): главный экран — создание кампании наверх, аккаунты под ним, «+ Аккаунт» → попап

- `app/(dashboard)/triggers/page.tsx` (Level-1): порядок сверху вниз — **1) «Создание кампании» (CreateForm)** → **2) Аккаунты** → **3) кнопка «+ Аккаунт» под списком** → **4) сводка (StatCard)**. Раньше форма была внизу, а «+ Аккаунт» уводил на `/accounts`.
- **Единый переиспользуемый попап аккаунта:** `AddModal` вынесен из `accounts/page.tsx` в `components/accounts/AddAccountModal.tsx` (основа §C1). Кнопка «+ Аккаунт» на главной и пустое состояние открывают модалку, не переходят на вкладку. `accounts/page.tsx` использует тот же компонент.

### 2026-07-02

#### feat: аккаунт-центричная вкладка (пирамидка) + счётчики действий + реальные подписчики

- **Вкладка «Триггеры» переделана: главное — аккаунты, потом кампании по ним.**
  - Уровень 1 (`AccountCard`): сетка аккаунтов, у каждого 4 иконки типов, статус-плашка и 3 цифры — **Кампаний · Подписчиков · Срабатываний**. Клик → «проваливается» внутрь.
  - Уровень 2: хлебные крошки + назад, шапка аккаунта, список **компактных карточек кампаний** (`CampaignCard`) и кнопка «+ Кампания» (создаёт триггер сразу для этого аккаунта — `CreateForm` с `lockedAccountId`, шаг выбора аккаунта скрыт).
  - `CampaignCard` показывает только важное: «сработал N раз» + **действия со счётчиками** (`DM ×12 · Лайк ×5 · …`); текст/задержка спрятаны под «детали».
- **Счётчики по действиям:** новое поле `TriggerRule.stats` (JSON: dm/like/follow/story/comment), инкремент при каждом успешном действии (dm-воркер, inline-поток, комментарии). Хелпер `mergeStats`.
- **Реальное число подписчиков:** новое поле `InstagramAccount.followers`; поллинг тянет `account_info` (эндпоинт воркера `/account-info`, ⚠️ нужен редеплой) и сохраняет; `/api/accounts` отдаёт `followers`.
- Миграция `20260702000000_account_stats` (followers + stats).


### 2026-07-01

#### fix(auth): логин синхронизируется с переменными Railway + прямой фикс владельца в БД
- `instrumentation.ts` (сид): вместо `upsert(update:{})` теперь **обновляет владельца** (самого раннего юзера) email+паролем из `DEFAULT_USER_EMAIL/PASSWORD` при каждом старте; удаляет дубликат с этим email перед апдейтом (иначе падало на unique). Раньше смена переменных не действовала на существующую запись.
- Причина, почему логин не работал: в боевой БД был один юзер `admin@instaguard.com` с другим паролем; авто-сид в проде фактически **не отрабатывал**. Исправлено напрямую в БД (владельцу выставлены нужные email/пароль).
- ⚠️ Открытый вопрос: `instrumentation.ts` (авто-поллинг каждые 30 мин + BullMQ dm-воркер) в проде, судя по `lastChecked`/логам, **не запускается** — требует проверки логов Railway.

#### feat: разделение ролей — черновые (HELPER) парсят, основные (RESPONDER) только шлют
- **Вкладка «Черновые аккаунты» выведена из беты** (убран бейдж BETA в `TopNav.tsx` и `drafts/page.tsx`).
- `app/api/poll/route.ts` переписан под роли:
  - **Пул черновых**: активные HELPER с сессией, round-robin (LRU по `lastChecked`).
  - **Парсинг** (`getFollowers`, `getComments`) + **лайк/подписка/сторис** — сессией чернового (свои дневные лимиты, отдельный `Counters` на каждый черновой, сохраняются в `limits`).
  - **DM, ответы в комментах, gate-приглашение, проверка подписки** — сессией основного (проверка «подписан ли на нас» корректна только с сессии основного).
  - Основной цикл теперь берёт только `RESPONDER`/`BOTH` (HELPER исключены из «отправителей»).
  - **Фолбэк**: нет живых черновых → парсинг НЕ запускается, `notifyOwner()` пишет громкий лог `🚨…` (троттлинг 3 ч) и, если задан `ALERT_WEBHOOK_URL`, шлёт вебхук (точка подключения SMS/email). Ответ поллинга: `{ alert: 'no-drafts' }`.
- `instrumentation.ts` (dm-воркер) и `runFollowerActionsInline`: follow/like/story берут `draftSessionData`/`draftProxy` из job (DM/фото — по-прежнему сессией основного).
- **Новая переменная (опц.):** `ALERT_WEBHOOK_URL` — вебхук для тревоги «нет черновых».
- ⚠️ Следствие: при **0 черновых** основной аккаунт больше не парсит (по согласованному фолбэку) — нужно добавить минимум один черновой.

#### feat: триггеры «Лайк» и «Ответ на сторис» из беты + гейт подписки + закрытый директ
- **Триггеры Лайк (`NEW_LIKE`) и Ответ на сторис (`STORY_MENTION`) выведены из «СКОРО»** — `TRIG_META.soon=false`, разрешены в `/api/triggers` (SUPPORTED += NEW_LIKE, STORY_MENTION).
- **Python-воркер (⚠️ нужен редеплой):** новые эндпоинты `POST /media-likers` (лайкнувшие последние посты) и `POST /story-events` (ответы на мои сторис + упоминания меня — из тредов директа, дефенсивный разбор `item_type`). Функции `get_recent_likers`, `get_story_events`. Клиент: `getLikers`, `getStoryEvents`.
- **`app/api/poll/route.ts`:** два новых потока (лайки/сторис) через общий `handleTargets` (DM — основной в очередь; лайк/подписка/сторис — черновой). Дедуп снапшотами `LIKES`/новый `STORY`. Парсинг лайкнувших — сессией чернового; чтение стори-событий — сессией **основного** (свой директ). Кулдауны: лайки 30 мин, сторис 60 мин.
- **Гейт подписки на DM:** галочка «Проверять подписку» с режимом `followed_by` (подписан на нас) / `mutual` (взаимно). Хранится как `gate:{mode,inviteText}` на экшене `SEND_MESSAGE` (legacy `COMMENT_GATE` ещё читается). Не проходит: **Комментарий** — приглашение в коммент, DM стоп; **Лайк/Сторис** — DM пропуск. `passesGate()` в поллинге. UI: компонент `GateBlock` (комментарий/лайк/сторис; у подписки скрыт).
- **Закрытый директ:** если DM не доставлен и это не бан/челлендж — вместо DM бот делает follow+лайк последнего поста **сессией чернового** (в `handleTargets`/воркере/inline/комментах). Бан/челлендж/лимит по-прежнему → основной на паузу.
- Схема: `SnapshotType += STORY` (миграция `20260701120000_add_story_snapshot`).
- **Новая переменная (опц.):** `ALERT_WEBHOOK_URL` (из прошлого шага).
- ⚠️ Без редеплоя Python-воркера новые триггеры не добывают инфу; без рабочего `instrumentation.ts` очередь DM не разбирается.

### 2026-06-28 (ночь)

#### feat: неоновая 3D-иконка приложения + живой 3D-фон Vanta NET

- `components/common/AppLogo.tsx` (новый) — неоновый SVG-логотип (тёмная плитка + IG-кольцо градиентом + молния, свечение). `compact` — для шапки/favicon; `detailed` — со связанными узлами-аккаунтами и «схемными» линиями (для крупного показа).
- `app/icon.svg` (новый) — favicon (Next.js App Router подхватывает автоматически).
- `components/common/VantaBackground.tsx` (новый) — фон Vanta **NET** (сеть связанных точек, цвет индиго `#5e5ce6` на фоне canvas), монтируется только на клиенте (dynamic import `three`+`vanta`), отключается при `prefers-reduced-motion`, мягкая вуаль сверху для читаемости. Заменил `.aurora` в `(dashboard)/layout.tsx`.
- `TopNav` и `login` — старый «Zap в синем квадрате» заменён на `AppLogo` (в логине — `detailed` версия).
- `globals.css` — `.card`/`.card-flat` стали стеклянными (полупрозрачные + `backdrop-blur`), чтобы фон-сеть мягко просвечивал → единый стиль.
- `next.config.ts` — `serverExternalPackages: ['bullmq','ioredis','bcryptjs']` (не бандлить, ускоряет сборку).
- Зависимости: `three`, `vanta`; типы — `vanta.d.ts`.

### 2026-06-28 (вечер)

#### feat: игровой 3D-дизайн + тултипы-подсказки везде

- `components/ui/Tooltip.tsx` (новый) — тултип на React-портале (не обрезается `overflow-hidden`), тёмный «стеклянный» пузырь со стрелкой, анимация появления. Принимает `className` для управления обёрткой (нужно для чипов в grid).
- `app/globals.css` — игровые утилиты: `tip-in`, `pulse-glow` (пульсация активных иконок), `sheen` (бегущий блик по кнопке), `float-y`, `card-3d` (приподнятие + цветная тень при наведении), `gloss` (глянцевый блик), `prefers-reduced-motion` отключает анимации.
- `triggers/page.tsx`:
  - `TrigBadge` — объёмнее (двойные тени + внутренний блик), `pulse-glow` для активных, hover scale/rotate, обёрнут в `Tooltip`.
  - Чипы действий — 3D-объём, нажатие (`active:scale`), свечение цветом, у каждого тултип с описанием.
  - Карточки события — `Tilt` (наклон за курсором) + усиленное свечение выбранного.
  - Статистика сверху — компонент `StatCard` (3D, парящая иконка, `Hint`-подсказка).
  - Карточки триггеров — `card-3d`; бейджи действий с тултипами.
  - Кнопка «Создать» — эффект `sheen`. Статус аккаунта и `?`-хинты с пояснениями.

### 2026-06-28

#### feat: переработка логики действий — группы-аккордеоны, объединённый «Директ» комментария, проверка подписки, сторис

**Фронтенд (`triggers/page.tsx`, переписан):**
- Все настройки действия — **сворачиваемые группы** (компонент `Group`). Внутри любой группы «Сообщение» порядок: **Картинка → Текст → Кастомный текст** (компонент `MessageBlock`). «Продолжить диалог» удалён.
- **Новая подписка** — чипы Директ · Лайк · Подписка · **Сторис**. Сторис: галочки «Просмотреть» / «Пролайкать просмотренные».
- **Комментарий** — чипы Директ · Лайк · Подписка · Сторис. «Директ» объединяет директ и комментарии через группы:
  - Крупная галочка **«Проверять подписку»** (выше Сигнала) + текст для неподписанных
  - Группа **«Сигнал»** (общая для всего триггера) — на что реагировать (фразы)
  - Галочка **«Ответ в комментариях»** (между Сигналом и Сообщением) → группа «Комментарии» (мин. 5 вариантов)
  - Группа **«Сообщение (директ)»**
- `Draft` расширен: `actStories/storyView/storyLike`, `cmtCheckSub/cmtGateText`; `match` (Сигнал) для комментария сохраняется в `conditions` триггера; удалены `dialog*`, `crMatch*`.

**Бэкенд (`app/api/poll/route.ts`):**
- Комментарий: `match` берётся из `trigger.conditions` (общий Сигнал, фильтрует весь триггер). Логика на новый коммент: при `COMMENT_GATE` (проверка подписки) — `getFriendship`, если не подписан → только коммент-приглашение, стоп; если подписан → ответ-коммент → подписка (если чип) → DM → сторис. Порядок: сначала коммент, потом DM. Лайк коммента — только по Сигналу.
- Новые действия `VIEW_STORIES{like}` исполняются в обоих потоках (followers — через очередь/inline, comments — inline).
- `instrumentation.ts`: dm-воркер обрабатывает `viewStories/storyLike`.

**Worker (`worker.py`/`instagrapi_client.py`, ⚠️ нужен редеплой):** `POST /friendship` (подписан ли), `POST /user-stories` (просмотр + опц. лайк).
**`lib/instagram/client.ts`:** `getFriendship`, `viewStories`.

### 2026-06-27

#### feat: триггер «Комментарий» — ответ в директ/комментариях, лайк, сопоставление фраз

**Фронтенд (`triggers/page.tsx`):** при выборе события «Комментарий» Шаг 3 меняется:
- Действия: Директ · Коммент · Лайк (лайкает все новые комментарии)
- Для «Директ» и «Коммент» — блок «На что реагировать»: `На все слова` / `Конкретные фразы` (по одной на строку) + чекбокс `Только точная фраза`. Без точного совпадения работает нестрогое сопоставление (регистр + опечатки)
- «Ответ в комментариях» — минимум 5 вариантов (можно больше), бот выбирает случайный
- Новые компоненты `MatchConfig`, `CommentReplies`; в `Draft` добавлены `dmMatchMode/dmPhrases/dmExact`, `crMatchMode/crPhrases/crExact`, `commentReplies[]`, `actCommentReply/actLikeComment`

**Бэкенд:**
- `app/api/poll/route.ts`: переписан — обрабатывает оба потока. Снапшоты теперь по типу (`FOLLOWERS`/`COMMENTS`) и удаляются раздельно (раньше followers-поток затирал бы comments-снапшот). Новый поток комментариев: сканирует последние 4 поста × 20 комментов, дедуп по `COMMENTS`-снапшоту, на каждый новый коммент — DM автору (по фразам), ответ в комментах (случайный вариант, по фразам), лайк коммента. Функция `matchPhrase` (Левенштейн, порог сходства 0.6/0.7) для нестрогого совпадения
- Флаг `manual` в теле запроса: кнопка «Проверить подписчиков» теперь шлёт `{manual:true}` → отправка СРАЗУ (inline), без очереди/кулдауна
- `workers/python` (`worker.py`/`instagrapi_client.py`): эндпоинты `POST /comments`, `/reply-comment`, `/like-comment` (⚠️ нужен редеплой Python-сервиса)
- `lib/instagram/client.ts`: `getComments`, `replyComment`, `likeComment`

#### feat: переработка страницы триггеров — мульти-действия, кастомный текст, шаблоны + фикс «Unauthorized»

**Корневая причина бага «не создаётся триггер»:** `/api/triggers` (POST) требовал JWT-сессию через `getCurrentUser()` и возвращал 401 «Unauthorized», тогда как `/api/accounts` работает без авторизации (по факту приложение однопользовательское). Без куки триггер не создавался.

**Бэкенд:**
- `lib/auth.ts`: новый `getUserOrFirst()` — берёт пользователя из JWT, а при его отсутствии первого пользователя БД (как `/api/accounts/auth`)
- `app/api/triggers/route.ts` + `[id]/route.ts`: используют `getUserOrFirst()`; POST принимает готовый массив `actions` (новый UI) либо плоские поля (обратная совместимость); PATCH умеет менять `name`/`conditions`/`actions`, а не только `isActive`; GET отдаёт `responder.status` и `errorCount`
- `app/api/templates/route.ts` + `[id]/route.ts` (новые): CRUD шаблонов триггеров (модель `Template`, `category='trigger'`, весь черновик сериализуется JSON в `content`)
- `app/api/poll/route.ts`: выполняет ВСЕ действия триггера на каждого нового подписчика — DM (+ссылка дописывается текстом, IG не поддерживает inline-кнопки), фото, подписка в ответ, лайк последнего поста; новый helper `runActionsInline` для пути без Redis
- `instrumentation.ts`: BullMQ dm-воркер обрабатывает новые поля job (`image`, `doFollow`, `doLike`)
- `workers/python/worker.py` + `instagrapi_client.py`: новые эндпоинты `POST /follow-user`, `/like-latest-media`, `/send-dm-photo` (⚠️ требуют редеплоя Python-сервиса)
- `lib/instagram/client.ts`: `followUser`, `likeLatestMedia`, `sendDMPhoto`

**Фронтенд (`app/(dashboard)/triggers/page.tsx`, переписан):**
- Квадрат 1 (аккаунты): у каждого 4 цветные 3D-иконки триггеров (синий/зелёный/розовый/оранжевый) — горят градиентом если триггер этого типа активен, серые если нет; цвет плашки: зелёный (работает), синий (готов), красный (бан/челлендж), жёлтый (ошибки)
- Квадрат 2 (событие): 3D-иконки в цветах типов
- Квадрат 3 (настройка): выбор действий (Директ/Лайк/Подписка, мультивыбор), название, текст DM, кнопка «Кастомный текст» → чекбоксы «Ссылка-кнопка» (текст+URL) и «Продолжить диалог» (триггер-фраза+ответ), загрузка картинки, условия, задержки
- Шаблоны: кнопка «Сохранить как шаблон» + кнопка «Шаблоны» (выезжающая панель с применением/удалением)

**Известные ограничения:** «Продолжить диалог» сохраняется и отображается, но входящий авто-ответ требует отдельного поллинга директа (пока не реализован). Лайк/подписка/фото исполняются только после редеплоя Python-воркера с новыми эндпоинтами.

#### fix: система триггеров — сохранение в БД (срабатывания показывали 0)

**Корневая причина:** триггеры хранились только в Zustand (localStorage). `/api/poll` запрашивал `triggersAsResponder` из PostgreSQL — всегда пустой массив. Account ID в Zustand были случайными (uid()), не совпадали с реальными ID в БД. `tick()` — чистая симуляция без Instagram.

**Исправления:**

`prisma/schema.prisma` + `prisma/migrations/20260626000001_add_trigger_fire_count/migration.sql`:
- Добавлено поле `fireCount Int @default(0)` в `TriggerRule` — счётчик реальных отправленных DM

`package.json`:
- `build`: добавлен `prisma migrate deploy` перед `next build` — применяет новую миграцию при деплое

`app/api/triggers/route.ts` (новый):
- `GET` — список триггеров пользователя из БД (include responder.username)
- `POST` — создаёт по одному `TriggerRule` на каждый выбранный аккаунт (accountIds[]); маппинг UI-типов → EventType: FOLLOW→NEW_FOLLOWER, COMMENT→NEW_COMMENT, LIKE→NEW_LIKE, STORY_REPLY→STORY_MENTION; actions = [{type:'SEND_MESSAGE', templates:[message], delayMin, delayMax}]

`app/api/triggers/[id]/route.ts` (новый):
- `DELETE` — удаляет триггер
- `PATCH` — переключает isActive

`app/api/poll/route.ts`:
- После успешной отправки DM: `triggerRule.update({ fireCount: { increment: 1 } })`

`lib/store.ts`:
- `addAccount` принимает опциональный `id`; дедупликация по username (не добавляет дубли)

`app/(dashboard)/accounts/page.tsx`:
- `addAccount({ id: data.account.id, ... })` — теперь Zustand account ID = реальный DB UUID

`app/(dashboard)/triggers/page.tsx` (переписан):
- Загружает аккаунты из `/api/accounts` (не Zustand) — настоящие DB UUID
- Сохраняет через `POST /api/triggers` (не Zustand)
- Показывает список сохранённых триггеров из `GET /api/triggers` с реальным `fireCount`
- Кнопки Вкл/Выкл (PATCH) и Удалить (DELETE) работают напрямую с БД
- Убраны `tick()`, случайные uid(), `ActiveTriggersDock` (Zustand)

---

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

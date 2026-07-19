# PLAN-LOGIN.md — Довести ВХОД до идеала (глобальный план для агентов)

> Цель: сделать так, чтобы вход Instagram работал НАДЁЖНО по ВСЕМ путям — обычный логин,
> 2FA (с ключом и без), challenge по почте/SMS, подтверждение на устройстве, капча
> (reCAPTCHA Enterprise / hCaptcha / FunCaptcha / image), вход по кукам/сессии, массовый
> импорт, suspended-чекпоинт. План опирается на РЕАЛЬНЫЙ код (файлы/строки указаны), а не догадки.
>
> **Статус на момент составления (2026-07-18):** вход упирается в reCAPTCHA Enterprise на
> `auth_platform/recaptcha`. Две живые ошибки: (A) токен получен, но `callback ✗` → форма не
> отправляется → `network`; (B) `ERROR_CAPTCHA_UNSOLVABLE` без ретрая. Диагноз — §1.
>
> **Как пользоваться (для агентов):** правки идут по фазам §14. После КАЖДОЙ фазы — `node --check`
> + воркер-тесты + деплой + отметка `[x]` здесь + запись в `CLAUDE.md` + «что затестить живьём».
> Живой браузер в песочнице не запускается (Defender кварантинит chrome.exe) — верификация
> только через редеплой воркера + повтор входа пользователем, поэтому каждая правка ДЕТЕРМИНИРОВАНА
> и с диагностикой в тексте ошибки. Правило проекта: **никаких прямых API-вызовов к Instagram**
> (только видимый DOM/навигация реальным браузером) — см. `CLAUDE.md` ADR-002.

---

## 0. Карта файлов (где что чинить)

| Файл | Роль |
|---|---|
| `workers/browser/lib/captcha.js` | Детект + решение капчи через 2captcha, вписывание токена. **Главная боль.** |
| `workers/browser/lib/login.js` | Все пути входа: `attemptLogin`, `resumeCode`, `resumeWithTotp`, `loginByState`, `handleCaptchaIfPresent`, TOTP, challenge/2FA/device-approval, extractUsername. |
| `workers/browser/lib/selectors.js` | `SEL`/`URLS` — селекторы форм/кнопок/полей + URL-признаки состояний. |
| `workers/browser/server.js` | HTTP-эндпоинты `/login`, `/login/checkpoint`, `/login/resend`, `/login/cookies`; карта `pending` (контекст между шагами). |
| `lib/browser/client.ts` | Обёртка Next.js→воркер; таймауты `LOGIN_TIMEOUT_MS=240с`, `VISIT=300с`, default 180с. |
| `app/api/accounts/auth/route.ts` | Оркестрация: подбор прокси, гео-локаль, фолбэк куки→пароль, пометка выжженных IP, ответ 202 (challenge/2fa). |
| `app/api/accounts/auth/challenge/route.ts` | Ввод кода challenge/2FA (проброс на `/login/checkpoint`). |
| `app/api/accounts/auth/resend/route.ts` | Повтор кода. |
| `app/api/accounts/import/route.ts` | Массовый импорт (пароль/куки), паузы, ретрай на другом прокси. |
| `components/accounts/AddAccountModal.tsx` | UI: challenge/2FA-экран, повтор/смена канала, ручной код. |

---

## 1. ДИАГНОЗ двух живых ошибок (подтверждён кодом)

### 1.1 Ошибка A — `callback ✗`: токен есть, но форма не отправляется → `network`
```
🔐 Капча: распознана recaptcha ENTERPRISE (via dom), sitekey 6LeyIlkaAAAAAE…,
   pageurl https://www.fbsbx.com/captcha/recaptcha/iframe/
   | 2captcha OK: токен получен (len 2254), вписан [textarea ✓, callback ✗]
🔗 Экран: https://www.instagram.com/auth_platform/recaptcha/ (фреймов: 6)
```
**Корень (100% подтверждён):** На экране Meta `auth_platform/recaptcha` (скрин 1) есть ТОЛЬКО чекбокс
«I'm not a robot» — **НЕТ кнопки «Continue»**. Отправка результата на этом экране **целиком
callback-driven**: успешный reCAPTCHA дёргает `data-callback`-функцию внутри iframe `fbsbx.com`,
которая забирает `g-recaptcha-response` и постит токен обратно в Meta (form submit / `parent.postMessage`).

`injectToken` (`captcha.js:132`) вписывает токен в textarea (`textarea ✓`), но **не дёргает нужный
колбэк** (`callback ✗`), потому что:
1. Ищет колбэк ТОЛЬКО в `window.___grecaptcha_cfg.clients`, и всего на 2 уровня вглубь
   (`captcha.js:151-167`). У reCAPTCHA **ENTERPRISE** (`grecaptcha.enterprise.render`) структура
   конфига иная/глубже — реальный колбэк не находится.
2. **НЕ читает атрибут `data-callback`** у `.g-recaptcha`/`[data-sitekey]` и не вызывает named-функцию
   напрямую — а это и есть штатный success-хендлер fbsbx-страницы.
3. Даже если бы дёрнул grecaptcha-колбэк — fbsbx-обёртка слушает СВОЙ хендлер, не абстрактный
   grecaptcha-callback.

`handleCaptchaIfPresent` (`login.js:15`) после решения жмёт кнопку продолжения
(`login.js:22-24`) — но на этом экране кнопки НЕТ → фолбэка отправки нет → Instagram ждёт →
дедлайн → `network`. **Токен валиден и не использован.**

### 1.2 Ошибка B — `ERROR_CAPTCHA_UNSOLVABLE` без ретрая
```
| 2captcha ОШИБКА: 2captcha_failed: ERROR_CAPTCHA_UNSOLVABLE
```
**Корень:** тот же sitekey/pageurl в ошибке A решился (токен len 2254) → параметры в целом верны →
`ERROR_CAPTCHA_UNSOLVABLE` здесь **вероятностный/транзиентный сбой на стороне 2captcha**
(Enterprise reCAPTCHA решается хуже обычной v2). Но код **НЕ ретраит**: `pollResult` (`captcha.js:27`)
бросает на ЛЮБОМ статусе кроме `CAPCHA_NOT_READY` (включая UNSOLVABLE), `trySolveCaptcha` ловит и
сдаётся, а `captchaTried=true` (`login.js:698`) запрещает вторую попытку в этом входе. **Один
неудачный солв = весь вход провален.**

### 1.3 Почему «на 2FA работает, а на обычном входе — нет» (наблюдение пользователя)
`resumeCode`/`resumeWithTotp` тоже зовут `handleCaptchaIfPresent`. Но экраны 2FA/challenge обычно
имеют **явную кнопку Continue/Submit**, которая отправляет форму с уже вписанным
`g-recaptcha-response` (textarea ✓ достаточно — колбэк не нужен). На обычном логине
`auth_platform/recaptcha` кнопки НЕТ → без колбэка отправки нет. **Это и есть асимметрия** — она
подтверждает: чинить надо ОТПРАВКУ решённого токена (§4.1), а не само 2captcha.

---

## 2. Карта ВСЕХ путей входа (текущее состояние)

| # | Путь | Точка входа | Текущее состояние | Главный риск |
|---|---|---|---|---|
| P1 | Обычный вход (логин/пароль) | `attemptLogin` `login.js:549` | Работает до капчи | **Капча (§4)** |
| P2 | 2FA с ключом (авто-TOTP) | `attemptLogin` 2FA-ветка `login.js:622` + `resumeWithTotp` `login.js:820` | Работает (окна 0/-1/+1) | Капча на 2FA-экране; кнопка Continue во фрейме |
| P3 | 2FA без ключа → почта | `tryAnotherWayToEmail` `login.js:529` | Best-effort | Экран выбора метода варьируется |
| P4 | Challenge email/SMS | `attemptLogin` challenge-ветка `login.js:661` + `resumeCode` `login.js:744` | Работает; явный выбор почты | Поле кода `name="email"`; SMS вместо почты |
| P5 | Подтверждение на устройстве (afad) | `attemptLogin` `login.js:682` | Работает (ждёт ~2.25 мин) | Пользователь не успел нажать «Это я» |
| P6 | Капча reCAPTCHA Enterprise | `handleCaptchaIfPresent`→`trySolveCaptcha` | **СЛОМАНО** (§1) | callback✗ + нет ретрая |
| P6b | hCaptcha / FunCaptcha | `solveHCaptcha`/`solveFunCaptcha` `captcha.js:45/51` | Не проверено живьём; нет ретрая | Редко у IG; surl-детект хрупкий |
| P6c | Image-капча (текст на картинке) | `handleImageCaptcha`/`fillImageCaptcha` `login.js:100/157` | Робастно (координатный фолбэк) | ОК |
| P7 | Вход по кукам/сессии | `loginByState` `login.js:936` | Работает | Гео-несовпадение прокси↔аккаунт |
| P7b | Фолбэк куки→пароль | `accounts/auth/route.ts:103-145` | Работает | — |
| P8 | Массовый импорт | `accounts/import/route.ts` | Работает, паузы + ретрай IP | Долго; challenge дожимается вручную |
| P9 | suspended-чекпоинт | `extractUsername` `login.js:431` | Проходит «Continue» | Реальный бессрочный бан |

---

## 3. Корневые баги и логические дыры (ранжировано)

| ID | Приоритет | Где | Проблема | Фикс в |
|---|---|---|---|---|
| **B1** | 🔴 P0 | `captcha.js` `injectToken` | Колбэк enterprise-капчи не дёргается (`callback ✗`) → токен не отправляется. Нет чтения `data-callback`, нет рекурсии по cfg, нет form-submit/postMessage. | §4.1 |
| **B2** | 🔴 P0 | `captcha.js` `pollResult`/`solveRecaptchaV2` | Нет ретрая на `ERROR_CAPTCHA_UNSOLVABLE`/таймаут/сеть. Один сбой = провал. | §4.2 |
| **B3** | 🔴 P0 | `login.js` `attemptLogin` `captchaTried` | Гейт запрещает вторую попытку капчи в одном входе → после единичного сбоя цикл впустую ждёт таймаут. | §4.5 |
| **B4** | 🟠 P1 | `login.js`/`captcha.js` | Нет ВЕРИФИКАЦИИ, что капча реально пройдена (URL ушёл / iframe исчез / кука появилась) после вписывания токена. Слепое ожидание. | §4.4 |
| **B5** | 🟠 P1 | `captcha.js` `solveRecaptchaV2` | Для enterprise на 2captcha не передаётся `data-s`/`action`; pageurl жёстко fbsbx — не проверено эмпирически, что это оптимум (↑ доля UNSOLVABLE). | §4.3 |
| **B6** | 🟠 P1 | `login.js` дедлайны | После решения капчи дедлайн +30с — мало под submit+навигацию+возможный ретрай. Клиентский бюджет 240с недоиспользован. | §4.6 |
| **B7** | 🟡 P2 | `login.js` `handleCaptchaIfPresent` | На экране без кнопки (recaptcha) фолбэк-«клик кнопки» — no-op; нет фолбэка «нажать чекбокс/дождаться авто-сабмита». | §4.1 |
| **B8** | 🟡 P2 | `captcha.js` `detectCaptcha` | Enterprise-флаг из DOM-ветки (`data-sitekey`) не выставляется (только из frame-url ветки). `isEnterpriseRecaptcha` спасает по top-URL, но детект неполный. | §4.3 |
| **B9** | 🟡 P2 | hCaptcha/FunCaptcha | Нет ретрая (как B2); FunCaptcha `surl` может не определиться. | §4.2 |
| **B10** | 🟢 P3 | Наблюдаемость | Трасса капчи хорошая, но нет: времени решения, номера попытки, причины «не отправилось». | §13 |

---

## 4. ПОДСИСТЕМА КАПЧИ — глубокий разбор и план фиксов (ядро плана)

Инвариант: капча на входе Instagram = reCAPTCHA **Enterprise** в iframe `fbsbx.com/captcha/recaptcha/iframe/`,
верхний экран `instagram.com/auth_platform/recaptcha/`, 6 фреймов (fbsbx → google anchor/bframe).

### 4.1 🔴 B1 — НАДЁЖНАЯ отправка решённого токена (самый важный фикс)
Переписать `injectToken` (`captcha.js:132`) так, чтобы после получения токена ПОСЛЕДОВАТЕЛЬНО
выполнить ВСЕ способы «протолкнуть» решение, по всем фреймам (evaluate в каждом фрейме — legal,
т.к. внутри своего origin fbsbx всё доступно):

1. **Вписать во все textarea** ответа (уже есть): `g-recaptcha-response`, `g-recaptcha-response-N`,
   `#g-recaptcha-response` + `input`/`change` события.
2. **НОВОЕ — вызвать `data-callback` напрямую:** прочитать у `.g-recaptcha`/`[data-sitekey][data-callback]`
   атрибут `data-callback`; если это строка-имя → `window[name](token)`; если функция —
   вызвать. Это штатный success-хендлер fbsbx — вероятнее всего именно он и чинит `callback ✗`.
3. **НОВОЕ — рекурсивный обход `___grecaptcha_cfg`:** обойти `clients` РЕКУРСИВНО (не 2 уровня),
   собрать ВСЕ функции-свойства с именами `callback`/оканчивающиеся на `callback`, и вызвать
   каждую с токеном. Плюс проверить `grecaptcha.enterprise` (если есть `getResponse`/конфиг).
4. **НОВОЕ — submit формы:** если textarea лежит внутри `<form>` → `form.requestSubmit?.() ?? form.submit()`.
5. **НОВОЕ — клик по «невидимому»/появившемуся submit** (на случай, если fbsbx рисует скрытую кнопку).
6. Вернуть детальный `{ textarea, dataCallback, cfgCallback, formSubmit }` для трассы.

> Ключевая гипотеза: пункт **2 (data-callback)** закрывает `callback ✗`. Реализовать все пункты
> (дёшево, идемпотентно), т.к. точную вёрстку fbsbx в песочнице не проверить.

### 4.2 🔴 B2/B9 — РЕТРАИ 2captcha
- В `solveRecaptchaV2`/`solveHCaptcha`/`solveFunCaptcha` обернуть submit+poll в цикл **до 2–3 попыток**
  при исходах `ERROR_CAPTCHA_UNSOLVABLE`, `ERROR_NO_SLOT_AVAILABLE`, таймаут, сетевой сбой (каждая
  попытка = НОВАЯ задача с новым id). Логические ошибки (`ERROR_WRONG_GOOGLEKEY`, `ERROR_KEY_DOES_NOT_EXIST`,
  `ERROR_ZERO_BALANCE`) — сразу проброс без ретрая (ретрай не поможет, только жжёт время/баланс).
- Разделить в `pollResult` «ретраибельные» и «фатальные» коды 2captcha (карта кодов).
- Общий бюджет капчи держать в рамках `LOGIN_TIMEOUT_MS` (240с): напр. 2 попытки × ~90с poll.

### 4.3 🟠 B5/B8 — enterprise-параметры и pageurl (эмпирически)
- **B8:** в `detectCaptcha` DOM-ветке (`captcha.js:93-104`) добавить определение enterprise
  (по наличию `grecaptcha.enterprise`, по `src` скриптов `recaptcha/enterprise.js`, по фрейму) —
  чтобы `found.enterprise` был надёжен независимо от тайминга. Сейчас его вытягивает только
  `isEnterpriseRecaptcha` по top-URL — оставить как страховку.
- **B5 (задача-эксперимент, НЕ слепая правка):** снять `data-s` (если fbsbx его отдаёт в
  `.g-recaptcha[data-s]` или в URL anchor) и передавать в 2captcha как `data-s`. Проверить A/B
  двумя параметрами `pageurl`:
  - (a) текущий `https://www.fbsbx.com/captcha/recaptcha/iframe/`
  - (b) верхний `https://www.instagram.com/auth_platform/recaptcha/`
  Через доп. диагностику (§13) записать, при каком pageurl ниже доля `UNSOLVABLE`. Оставить лучший.
- Убедиться, что `enterprise:'1'` уходит ВСЕГДА, когда `isEnterpriseRecaptcha=true` (сейчас так —
  `login.js`/`captcha.js:266`, `enterprise` из `isEnterpriseRecaptcha`).

### 4.4 🟠 B4 — ВЕРИФИКАЦИЯ «капча пройдена»
После `injectToken` (§4.1) НЕ ждать вслепую, а поллить до ~15с признак успеха:
- URL ушёл с `auth_platform/recaptcha` **ИЛИ**
- фрейм `/captcha/recaptcha/iframe` **исчез** (detach) **ИЛИ**
- появился `sessionid` (`hasSessionCookie`) **ИЛИ**
- на странице появилось поле кода/следующий экран.

Если ни один признак за N секунд — считать «не отправилось» → в `trySolveCaptcha` вернуть
`solved:false` с причиной, чтобы сработал ретрай (§4.5) с НОВЫМ токеном/повторным `injectToken`.

### 4.5 🔴 B3 — снять `captchaTried`-гейт, разрешить K попыток
- В `attemptLogin` (`login.js:691-702`) заменить булев `captchaTried` на счётчик `captchaAttempts`
  (лимит 2–3). Пока верификация (§4.4) не подтвердила успех И попытки не исчерпаны И капча всё ещё
  на экране — пробовать снова (новый solve). Дедлайн продлевать под каждую попытку (§4.6).
- Гарантия от жжёного баланса: попытки считаются в рамках ОДНОГО входа; между попытками —
  проверка, что капча ещё на экране (не решать в пустоту).

### 4.6 🟠 B6 — тайминги/дедлайны
- Клиент даёт 240с (`LOGIN_TIMEOUT_MS`). Бюджет капчи внутри `attemptLogin` расширить: после
  успешного solve дедлайн +45–60с (submit fbsbx + навигация); при ретрае — ещё продление, но так,
  чтобы суммарно воркер уложился в ~220с (оставить клиенту запас на возврат diag).
- `waitForRecaptchaReady` 9с оставить; poll 2captcha на попытку ≤90с (при 2 попытках → ≤180с).

### 4.7 Диагностика капчи (расширить трассу — §13)
Добавить в `log`: `via`(dom/frame-url), `enterprise`, `pageurl`, попытка N/K, время solve, а после
инъекции — `[textarea ✓/✗, data-callback ✓/✗, cfg-callback ✓/✗, form-submit ✓/✗]` и итог верификации
(`advanced: url-changed|iframe-gone|session|no`). Тогда следующий провал скажет ТОЧНО, что не сработало.

---

## 5. P1 — Обычный вход (логин/пароль)
`attemptLogin` (`login.js:549`). Устойчивый поиск формы (`findLoginForm`, `name="email"/"pass"` учтён),
человеческий ввод, разбор исходов в цикле. **После фиксов §4 — основной путь должен закрыться.**
- [ ] Проверить, что после капчи (§4.4 verified) цикл доходит до `hasSessionCookie` и success.
- [ ] `BAD_CREDS_MSG` — оставить (честно про анти-брутфорс).
- [ ] Убедиться, что капча ДО формы (`login.js:562`) тоже проходит через новую отправку (§4.1).

## 6. P2/P3 — 2FA
- **P2 (ключ есть):** окна 0/-1/+1 (`login.js:637`, `resumeWithTotp:834`) — оставить. Проверить, что
  капча НА 2FA-экране решается новой отправкой (§4.1) и кнопка Continue ищется по ВСЕМ фреймам
  (`findButtonAnyFrame` — уже есть).
- **P3 (ключа нет):** `tryAnotherWayToEmail` (`login.js:529`) → почта. Проверить набор кнопок
  `ANOTHER` и `chooseEmailChannel` на живом экране; расширить фразы при промахе.
- [ ] Кейс `bad_code` при верном ключе — трасса кнопок (`buttonsSummary`) уже есть; убедиться, что
  причина «кнопка не нажалась» отличима от «ключ неверный».

## 7. P4 — Challenge (email/SMS)
`attemptLogin` challenge-ветка (`login.js:661`) + `resumeCode` (`login.js:744`).
- Явный выбор ПОЧТЫ (`chooseEmailChannel`) — критично (иначе код уходит в SMS на номер, которого нет).
- Поле кода `name="email"` учтено в `CODE_SELECTORS` (`login.js:757`).
- [ ] Проверить экран выбора метода с radio И без radio (кликабельная строка `...@...`).
- [ ] `resendCode` (`login.js:924`) — работает через `SEL.resendLink`.

## 8. P5 — Подтверждение на устройстве (afad)
`login.js:682`, `URLS.deviceApproval`. Ждёт ~2.25 мин, при неуспехе — `approval_pending` (не `network`).
- [ ] Проверить, что дедлайн (135с) укладывается в клиентский 240с (да).
- [ ] Расширить `SEL.deviceApprovalText`/`URLS.deviceApproval` при новых формулировках.

## 9. P7 — Вход по кукам/сессии + фолбэк куки→пароль
`loginByState` (`login.js:936`), фолбэк в `accounts/auth/route.ts:103`.
- Различает `bad_cookies` (формат) vs `session_rejected` (гео/срок/чужой аккаунт) — оставить.
- [ ] Добавить `handleCaptchaIfPresent` в `loginByState` перед финальной проверкой (на случай, если
  заход по куке триггерит капчу — редко, но покрыть новой отправкой §4.1).
- [ ] Гео-подсказка (прокси в стране аккаунта) — уже в тексте ошибки.

## 10. P8 — Массовый импорт
`accounts/import/route.ts`. Паузы между строками, ретрай на другом прокси при blacklist, challenge/2FA
дожимаются в UI (`PendingCodeRow`). После фиксов §4 — импорт с капчей тоже проходит.
- [ ] Прокинуть `manual`-код и капча-исходы в те же строки-«ждут код».

## 11. P9 / P6c — suspended + image-капча
`extractUsername` (`login.js:431`) жмёт «Continue» (`SEL.suspendedContinue`); image-капча — `fillImageCaptcha`
(координатный фолбэк). Робастно. Реальный бессрочный бан — вход невозможен ничем (честно сообщить).

## 12. Слой оркестрации Next.js
`accounts/auth/route.ts`: подбор прокси ДО входа, гео-локаль (`localeForCountry`), пометка выжженных IP
(`markProxyBlocked`), ответ 202 при challenge/2fa, фолбэк куки→пароль.
- [ ] `LOGIN_TIMEOUT_MS` — убедиться, что 240с ≥ нового бюджета капчи воркера (§4.6). При 2 попытках
  капчи поднять до 260–280с (env `BROWSER_LOGIN_TIMEOUT_MS`), чтобы клиент не рвал fetch раньше воркера.
- [ ] `challenge/route.ts` — проброс `manual` (уже есть) для ручного кода.

---

## 13. Наблюдаемость (единый формат трассы)
Довести до вида, по которому ЛЮБОЙ провал диагностируется без гадания:
```
🔐 Капча: recaptcha ENTERPRISE (via dom) · pageurl=<...> · попытка 2/3 · solve=41с
   · вписан [textarea ✓, data-callback ✓, cfg-callback ✗, form-submit ✓]
   · verify: iframe-gone → OK   (ИЛИ: verify: no → ретрай)
```
- В `trySolveCaptcha` собирать эти поля; `attemptLogin` прикладывать к `network`-ошибке (уже
  прикладывает `captchaLog` — расширить содержимым).
- В логи воркера (`console.error('[captcha]…')`) — полный дамп; в UI — компактно.
- Скрин экрана (`captureDiag`) — уже прикладывается.

---

## 14. ФАЗЫ исполнения (порядок; с чего начать)

- [x] **Фаза 1 (🔴 разблокировка — §4.1 + §4.4):** СДЕЛАНО 2026-07-18 (build browser-83). `injectToken`
  переписан (data-callback + рекурсия cfg глубина 6 + form-submit, по всем фреймам) + `waitCaptchaCleared`
  верификация «капча ушла». `node --check` + тесты 35/35 + `tsc` чисты. ⚠️ Живьём не подтверждено (нужен редеплой + повтор входа @iheidy.zub).
- [x] **Фаза 2 (🔴 ретраи — §4.2 + §4.5 + §4.6):** СДЕЛАНО 2026-07-18 (build browser-84). §4.2 — ретраи
  2captcha на UNSOLVABLE/NO_SLOT/таймаут внутри `solveWithRetry` (фатальные коды — сразу проброс). §4.5 —
  `captchaTried` bool → `captchaAttempts` счётчик (лимит 2) в `attemptLogin`; повтор ТОЛЬКО пока капча на
  экране (`captchaOnScreen`) и не пройдена, с общим потолком времени 200с и запасом на полный solve (2-я
  попытка идёт лишь если 1-я была быстрой — «токен есть, но виджет не провёл»). §4.6 — дедлайны: advanced→+25с,
  не-advanced→+60с (в пределах потолка); `LOGIN_TIMEOUT_MS` 240→280с (клиент ждёт дольше воркера). Тесты 35/35, tsc чист.
- [~] **Фаза 3 (🟠 enterprise-параметры — §4.3 + §4.7):** B8 СДЕЛАНО (build browser-84) — enterprise-флаг
  теперь определяется ПРЯМО в DOM-ветке `detectCaptcha` (`grecaptcha.enterprise` / скрипт `enterprise.js` /
  `data-enterprise`), `isEnterpriseRecaptcha` остаётся страховкой по top-URL. Трасса §4.7 уже богатая (Фаза 1).
  ⬜ ОСТАЛОСЬ: эксперимент pageurl (a/b) + `data-s` — требует ЖИВЫХ данных (какой pageurl даёт меньше UNSOLVABLE), в песочнице не снять.
- [~] **Фаза 4 (🟠 остальные пути — §5–§9):** §9 СДЕЛАНО (build browser-84) — `handleCaptchaIfPresent` добавлен
  в `loginByState` (заход по куке тоже проходит капчу новой машинерией). §12 — `LOGIN_TIMEOUT_MS` поднят под
  новый бюджет капчи. Кнопка Continue во фреймах (`findButtonAnyFrame`) уже была. ⬜ ОСТАЛОСЬ: живая проверка
  2FA/challenge-экранов С капчей (нужен реальный прогон).
- [x] **Фаза 4c (🔴 НОВЫЙ ПУТЬ P10 — экран-выбор аккаунта / one-tap `__coig_login`):** СДЕЛАНО
  (build browser-109). ЖИВОЙ кейс `@5mgda18johnsonrichard`: мёртвая сессия → IG перекидывает
  `/accounts/edit/` на экран-ВЫБОР аккаунта (ник + «Continue» / «Use another profile», `forms:0`) →
  `extractUsername`/`rereadUsername` застревали («сессия НЕ активна»). Новый `tryOneTapContinue(page)`:
  детект по `__coig_login`/«Use another profile» + нет поля логина → клик «Continue» → `restored`
  (появился sessionid, БЕЗ пароля/капчи!) / `password` / `none`. Подключён в `extractUsername`
  (при `restored` → назад на `/accounts/edit/` читать ник) и `loginByState` (перед `session_rejected`
  пробует восстановить). Только DOM (ADR-002). ⬜ Живьём не переподтверждено (редеплой + повтор 🔤).
  ⚠️ Обнаружен и зафиксирован как P10 — в §1/§2 при составлении плана его не было (всплыл на живом дампе).
- [ ] **Фаза 5 (🟢 полировка — §10–§12):** импорт, оркестрация, диагностика, чистка.
- [ ] **Фаза 6 (верификация — §15):** прогнать матрицу тестов на живых аккаунтах пользователя.

После КАЖДОЙ фазы: `node --check` (captcha.js/login.js/server.js) + `npm test` воркера + деплой
воркера (обновить BUILD) + `[x]` тут + запись в `CLAUDE.md` + «что затестить».

---

## 15. Матрица тестирования (проверить ВСЕ пути живьём)

| # | Сценарий | Как получить | Ожидаемо после фиксов |
|---|---|---|---|
| T1 | Обычный вход, без капчи | Свежий чистый прокси в стране аккаунта | success, сессия сохранена |
| T2 | Вход с reCAPTCHA Enterprise | Подозрительный IP → экран `auth_platform/recaptcha` | капча решена+отправлена, вход завершён |
| T3 | reCAPTCHA + первый UNSOLVABLE | Повторные попытки | ретрай → success (не `network`) |
| T4 | 2FA с ключом | Аккаунт с 2FA + base32-ключ | авто-TOTP, вход без участия человека |
| T5 | 2FA без ключа | Аккаунт с app-2FA, ключа нет | «Try another way» → код на почту → ввод |
| T6 | Challenge email | Новый IP → «Check your email» | явный выбор почты, код принят |
| T7 | Challenge, IG шлёт SMS | Аккаунт с телефоном | выбор почты форсит email, не SMS |
| T8 | Подтверждение на устройстве | afad-экран | ждёт approve, затем success |
| T9 | Вход по кукам (живая сессия) | Мобильная строка с Bearer | success |
| T10 | Куки отклонены → пароль | Устаревшая сессия + логин/пароль в строке | фолбэк на пароль |
| T11 | Гео-несовпадение | Прокси не в стране аккаунта | понятный `session_rejected` + подсказка |
| T12 | Массовый импорт с капчей/2FA | Список строк | строки «ждут код» дожимаются |
| T13 | suspended-чекпоинт | Аккаунт с `/accounts/suspended/` | «Continue» пройден или честный бан |
| T14 | image-капча | identity-checkpoint | авто-solve или ручной ввод |
| T15 | Экран-выбор аккаунта (one-tap) | Мёртвая сессия у помнящего аккаунта (`__coig_login`) | клик «Continue» восстанавливает сессию БЕЗ пароля ИЛИ честное «нужен повторный вход» |

Каждый T-кейс: приложить трассу капчи (§13) и скрин к результату.

---

## 16. Definition of Done («вход доведён до идеала»)
- [ ] Экран `auth_platform/recaptcha` (reCAPTCHA Enterprise) **проходится** — `callback`/`form-submit`
  срабатывает, вход завершается сессией (ошибка A устранена, подтверждено живьём).
- [ ] `ERROR_CAPTCHA_UNSOLVABLE` больше не роняет вход с первого раза — есть ретрай (ошибка B устранена).
- [ ] Все T1–T14 из §15 проходят ИЛИ дают ЧЕСТНЫЙ понятный исход (не `network`-заглушка).
- [ ] Любой провал несёт точную трассу (§13): что распознали, сколько попыток, вписался ли токен,
  дёрнулся ли колбэк/сабмит, ушёл ли экран — без гадания.
- [ ] `node --check` + воркер-тесты зелёные; воркер задеплоен с новым BUILD; `CLAUDE.md` обновлён.
- [ ] Баланс 2captcha не жжётся впустую (ретраи ограничены, решаем только когда капча на экране).

---

## 17. Приложение — ориентиры для агента (ключевые места правок)

- **§4.1** `captcha.js:132` `injectToken` — добавить чтение `element.getAttribute('data-callback')` →
  `window[name](token)`; рекурсивный обход `___grecaptcha_cfg` (сейчас 2 уровня, строки 151-167);
  `form.requestSubmit()`. Вернуть расширенный статус.
- **§4.2** `captcha.js:20` `pollResult` / `:33` `solveRecaptchaV2` — карта ретраибельных кодов + внешний
  цикл попыток с новым `submitTask`.
- **§4.4** `captcha.js:239` `trySolveCaptcha` — после `injectToken` поллить признак успеха; вернуть
  `solved` только при подтверждении.
- **§4.5** `login.js:691` — `captchaTried` (bool) → `captchaAttempts` (счётчик, лимит 2–3) + условие «капча ещё на экране».
- **§4.6** `login.js:594/699` — дедлайны; `client.ts:20` `LOGIN_TIMEOUT_MS` при необходимости.
- **§4.3** `captcha.js:88` `detectCaptcha` (enterprise-флаг в DOM-ветке) + `:33` `solveRecaptchaV2` (`data-s`/pageurl-эксперимент).
- **§9** `login.js:936` `loginByState` — добавить `handleCaptchaIfPresent` перед финальной проверкой.

> Примечание: всё в `workers/browser/` — только видимый DOM/навигация. `frame.evaluate` внутри
> fbsbx-фрейма легально (свой origin фрейма), это НЕ прямой API-вызов к Instagram (ADR-002).

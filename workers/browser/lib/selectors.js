// Селекторы Instagram-web с фолбэками (RU/EN, роли, aria-label). IG часто меняет вёрстку —
// поэтому по несколько вариантов на элемент. См. plan.md §4.6/§Фаза 4.
// helpers ниже (firstVisible / clickByText) перебирают варианты и берут первый видимый.

export const SEL = {
  // Форма входа (несколько вариантов — IG меняет вёрстку/aria-label по регионам).
  // name="email"/"pass" — РЕАЛЬНЫЙ вариант формы входа (подтверждено DOM-дампом живого провала
  // 2026-07-09: {name:"email",type:"text"} + {name:"pass",type:"password"}, БЕЗ aria-label —
  // ни один из старых селекторов не матчил, поэтому userInput был null И passInput даже не
  // проверялся (код искал username ПЕРВЫМ и не доходил до password, хотя type="password" его
  // бы нашёл). Похоже на общую с Facebook вёрстку формы входа Meta, не выдумка/бот-стена.
  loginUsername: [
    'input[name="username"]',
    'input[name="email"]',
    'input[autocomplete="username"]',
    'input[aria-label*="username" i]',
    'input[aria-label*="Phone number" i]',
    'input[aria-label*="Телефон" i]',
    'input[aria-label*="имя пользователя" i]',
  ],
  loginPassword: [
    'input[name="password"]',
    'input[name="pass"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[aria-label*="Password" i]',
    'input[aria-label*="Пароль" i]',
  ],
  loginSubmit: ['button[type="submit"]', 'button:has-text("Log in")', 'button:has-text("Войти")'],
  loginError: ['#slfErrorAlert', '[data-testid="login-error-message"]', 'p[role="alert"]'],
  // Фолбэк «неверный логин/пароль» ПО ТЕКСТУ страницы, не по CSS-контейнеру — форма с
  // name="email"/"pass" (см. выше) рендерит ошибку в СВОЁМ контейнере, который loginError
  // не матчит: живой провал 2026-07-09 показал реальный текст Instagram («Неверный логин
  // или пароль») на скрине, а код классифицировал это как «unknown» (CSS не нашёл элемент,
  // текст никогда не проверялся). pageHasText ищет по видимому тексту всей страницы —
  // не зависит от того, в каком контейнере/классе Instagram его рисует.
  badCredsText: [
    'Неверный логин или пароль', 'неверный логин', 'неверный пароль',
    'Sorry, your password was incorrect', 'password was incorrect',
    "The username you entered doesn't belong to an account",
    'incorrect. Please double check your',
    // Новый формат Instagram (2026): «The login information you entered is incorrect. Find your account…»
    // — часть, не завязанная на #slfErrorAlert; без неё код ловил таймаут «network» вместо честного bad_password.
    'The login information you entered is incorrect', 'login information you entered',
    'информация для входа неверна', 'введённые данные для входа неверны',
  ],
  // Промежуточный экран (logged-out домашняя / «продолжить») — открыть форму входа
  logInLink: ['Log in', 'Log In', 'Войти', 'Log In', 'Log in with credentials'],
  // Экраны «не форма»: ошибка/лимит/бот-защита — для понятного сообщения вместо «unknown»
  errorPage: [
    'Something went wrong', 'Что-то пошло не так', 'Please wait a few minutes',
    'Подождите несколько минут', 'try again later', 'Sorry, something went wrong',
    'Page Not Found', 'reported activity',
  ],
  // «Подтвердите вход на другом устройстве» (device-approval): ждём подтверждения в приложении,
  // НЕ таймаутим. Мультиязычно — берём заметные фразы обоих экранов (англ./рус.).
  deviceApprovalText: [
    'Check your notifications on another device', 'Waiting for approval',
    'Approve from the other device', 'Approve the login', 'approve the login to continue',
    'Проверьте уведомления', 'Подтвердите, что это вы', 'на другом устройстве',
    'Ожидание подтверждения', 'Подтвердите вход',
  ],

  // Диалоги после входа
  notNowButtons: ['Not Now', 'Not now', 'Не сейчас', 'Cancel', 'Отмена'],
  saveInfoDialog: ['Save your login info?', 'Save Your Login Info?', 'Сохранить данные для входа'],
  // Экран /accounts/suspended/?next=... — часто НЕ окончательный бан, а confirm-чекпоинт
  // («Это вы?»/«Continue»), после которого Instagram сам редиректит на next= (напр. обратно
  // на /accounts/edit/). extractUsername пробует пройти его, прежде чем сдаться.
  suspendedContinue: [
    'Continue', 'Продолжить', 'This Was Me', 'This was me', 'Это я',
    'Get Started', 'Начать', 'Confirm', 'Подтвердить', 'I understand', 'Понятно', 'OK', 'Ок',
  ],

  // Код подтверждения (challenge / 2FA / codeentry)
  codeInput: [
    'input[name="verificationCode"]',
    'input[name="security_code"]',
    'input[name="confirmationCode"]',
    'input[autocomplete="one-time-code"]',
    'input[name*="code" i]',
    'input[aria-label*="Security" i]',
    'input[aria-label*="confirmation" i]',
    'input[aria-label*="code" i]',
    'input[aria-label*="код" i]',
    'input[inputmode="numeric"]',
    'input[type="tel"]',
    'input[maxlength="6"]',
    'input[maxlength="8"]',
    // Последний шанс — единственное текстовое поле в форме challenge (не логин/пароль).
    'form input[type="text"]:not([name="username"]):not([name="email"]):not([name="pass"]):not([name="password"])',
  ],
  // ТОЛЬКО тексты — используется через clickByText (текстовый матчер). CSS-кнопку
  // submit отправляет submitCodeForm() отдельно (firstVisible=CSS). Раньше сюда была
  // ошибочно вписана 'button[type="submit"]' — clickByText её как текст не матчит.
  codeSubmit: ['Confirm', 'Submit', 'Подтвердить', 'Далее', 'Next', 'Continue', 'Продолжить'],
  // CSS-кнопки подтверждения кода (для firstVisible).
  codeSubmitCss: ['button[type="submit"]:not([disabled])', 'div[role="button"][tabindex]:has-text("Confirm")'],
  resendLink: ['Resend', 'Resend Code', 'Send again', 'Отправить снова', 'Отправить ещё раз'],

  // Профиль / действия
  messageButton: ['Message', 'Написать', 'Send message', 'Send Message'],
  followButton: ['Follow', 'Подписаться', 'Follow Back', 'Подписаться в ответ'],
  followingState: ['Following', 'Requested', 'Вы подписаны', 'Запрос отправлен'],
  dmTextbox: ['div[role="textbox"][contenteditable="true"]', 'textarea[placeholder]'],
  likeButton: ['svg[aria-label="Like"]', 'svg[aria-label="Нравится"]'],
  commentBox: ['textarea[aria-label*="omment" i]', 'textarea[aria-label*="омментар" i]', 'div[role="textbox"][contenteditable="true"]'],
  commentPost: ['Post', 'Опубликовать'],
}

// URL-признаки состояний входа.
export const URLS = {
  challenge: ['/challenge/', '/auth_platform/codeentry'],
  twoFactor: ['/accounts/login/two_factor', 'two_factor'],
  suspended: ['/accounts/suspended', '/challenge/action/'],
  // «Подтвердите вход на другом устройстве» (device-approval, БЕЗ кода — approve на телефоне).
  deviceApproval: ['/auth_platform/afad', 'auth_platform/afad', '/auth_platform/review'],
}

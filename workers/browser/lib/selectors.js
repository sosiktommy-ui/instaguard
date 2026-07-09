// Селекторы Instagram-web с фолбэками (RU/EN, роли, aria-label). IG часто меняет вёрстку —
// поэтому по несколько вариантов на элемент. См. plan.md §4.6/§Фаза 4.
// helpers ниже (firstVisible / clickByText) перебирают варианты и берут первый видимый.

export const SEL = {
  // Форма входа (несколько вариантов — IG меняет вёрстку/aria-label по регионам)
  loginUsername: [
    'input[name="username"]',
    'input[autocomplete="username"]',
    'input[aria-label*="username" i]',
    'input[aria-label*="Phone number" i]',
    'input[aria-label*="Телефон" i]',
    'input[aria-label*="имя пользователя" i]',
  ],
  loginPassword: [
    'input[name="password"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[aria-label*="Password" i]',
    'input[aria-label*="Пароль" i]',
  ],
  loginSubmit: ['button[type="submit"]', 'button:has-text("Log in")', 'button:has-text("Войти")'],
  loginError: ['#slfErrorAlert', '[data-testid="login-error-message"]', 'p[role="alert"]'],
  // Промежуточный экран (logged-out домашняя / «продолжить») — открыть форму входа
  logInLink: ['Log in', 'Log In', 'Войти', 'Log In', 'Log in with credentials'],
  // Экраны «не форма»: ошибка/лимит/бот-защита — для понятного сообщения вместо «unknown»
  errorPage: [
    'Something went wrong', 'Что-то пошло не так', 'Please wait a few minutes',
    'Подождите несколько минут', 'try again later', 'Sorry, something went wrong',
    'Page Not Found', 'reported activity',
  ],

  // Диалоги после входа
  notNowButtons: ['Not Now', 'Not now', 'Не сейчас', 'Cancel', 'Отмена'],
  saveInfoDialog: ['Save your login info?', 'Save Your Login Info?', 'Сохранить данные для входа'],

  // Код подтверждения (challenge / 2FA / codeentry)
  codeInput: [
    'input[name="verificationCode"]',
    'input[name="security_code"]',
    'input[name="email"][maxlength="6"]',
    'input[autocomplete="one-time-code"]',
    'input[aria-label*="Security" i]',
    'input[aria-label*="код" i]',
    'input[type="tel"][maxlength="6"]',
  ],
  codeSubmit: ['button[type="submit"]', 'Confirm', 'Submit', 'Подтвердить', 'Далее', 'Next'],
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
  challenge: ['/challenge/', '/auth_platform/codeentry', '/accounts/login/two_factor'],
  twoFactor: ['/accounts/login/two_factor', 'two_factor'],
  suspended: ['/accounts/suspended', '/challenge/action/'],
}

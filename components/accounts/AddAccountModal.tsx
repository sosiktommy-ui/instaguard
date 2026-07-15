'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, AtSign, Lock, Globe, Loader2, FolderTree, ShieldCheck, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Hint } from '@/components/common/Hint'

type AuthMode = 'password' | 'cookies'

interface SectionItem { id: string; parentId: string | null; name: string }

// Разбирает строку от продавца «логин пароль 2FA-ключ» при вставке.
// 2FA-ключ = хвост из base32-групп по 4 символа (OJDU 3SXQ …) ИЛИ один длинный base32-токен.
// Возвращает null, если формат не распознан (тогда обычная вставка).
function parseSellerLine(text: string): { username: string; password: string; totp: string } | null {
  const toks = text.trim().split(/\s+/).filter(Boolean)
  if (toks.length < 2) return null
  const isGroup = (t: string) => /^[A-Za-z2-7]{4}$/.test(t)
  const isLong = (t: string) => /^[A-Za-z2-7]{16,}$/.test(t)
  let end = toks.length
  const groups: string[] = []
  while (end > 0 && isGroup(toks[end - 1])) { groups.unshift(toks[end - 1]); end-- }
  let totp = ''
  if (groups.length >= 2) totp = groups.join('')
  else if (isLong(toks[toks.length - 1])) { totp = toks[toks.length - 1]; end = toks.length - 1 }
  else end = toks.length
  const rest = toks.slice(0, end)
  if (rest.length >= 2) return { username: rest[0].replace(/^@/, ''), password: rest[1], totp }
  if (rest.length === 1 && totp) return { username: '', password: rest[0], totp }
  return null
}

/**
 * Единый переиспользуемый попап подключения Instagram-аккаунта.
 * Используется и на вкладке «Аккаунты», и на главном экране (кнопка «+ Аккаунт»).
 */
export function AddAccountModal({
  onClose, onAdded, presetProxy,
  role = 'RESPONDER',
  title = 'Подключить аккаунт',
  subtitle,
  defaultMode = 'password',
  presetUsername,
}: {
  onClose: () => void
  onAdded: (username: string) => void
  presetProxy?: string
  /** Роль создаваемого аккаунта. HELPER — черновой (парсер), RESPONDER — основной (шлёт). */
  role?: 'RESPONDER' | 'HELPER'
  /** Заголовок окна (для черновых — «Черновой аккаунт»). */
  title?: string
  /** Подзаголовок под заголовком (необязательно). */
  subtitle?: string
  /** Режим по умолчанию: для черновых удобнее 'cookies' (безопаснее для парсинга). */
  defaultMode?: AuthMode
  /** §1.1 — повторный вход: логин заранее заполнен (upsert по username обновит существующий аккаунт). */
  presetUsername?: string
}) {
  const addAccount = useStore((s) => s.addAccount)
  const [mode, setMode]         = useState<AuthMode>(defaultMode)
  const [username, setUsername] = useState(presetUsername ?? '')
  const [password, setPassword] = useState('')
  const [totp, setTotp]         = useState('')   // 2FA-ключ (base32), если у аккаунта включена 2FA
  const [emailLogin, setEmailLogin]       = useState('')  // почта аккаунта (для авто-подтверждения кода)
  const [emailPassword, setEmailPassword] = useState('')  // пароль почты (только для IMAP)
  const [cookies, setCookies]   = useState('')
  const [proxy, setProxy]       = useState(presetProxy ?? '')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [shot, setShot]         = useState('')   // скрин экрана Instagram при неудачном браузерном входе
  const [step, setStep]         = useState<'form' | 'auth' | 'challenge'>('form')
  const [pasteNote, setPasteNote] = useState('')

  // Challenge (код с почты/SMS при входе с нового устройства) ИЛИ 2FA — контекст из ответа
  // 202 роута /api/accounts/auth, с которым возвращаемся на /challenge после ввода кода.
  const [challenge, setChallenge] = useState<{
    kind: 'challenge' | '2fa'
    username: string
    proxyId: string | null
    role: string
    sectionId: string | null
    stepName: string
    sentTo?: string | null
    methods?: string[]
    contact?: { email?: string; phone?: string }
    method?: string   // 2fa: 'sms' | 'app'
    phone?: string     // 2fa: маскированный номер
  } | null>(null)
  const [code, setCode] = useState('')
  const [resending, setResending] = useState(false)
  const [resendNote, setResendNote] = useState('')
  // Авто-решение 2FA (воркер сам считает TOTP из ключа и вписывает код — человек ничего не
  // вводит). 'running' — идёт попытка на воркере; 'failed' — авто не справилось (напр. кнопка
  // подтверждения не найдена), тогда показываем ручной фолбэк с полем кода.
  const [auto2fa, setAuto2fa] = useState<'idle' | 'running' | 'failed'>('idle')
  const [secondsLeft, setSecondsLeft] = useState(30 - (Math.floor(Date.now() / 1000) % 30))

  // Умная вставка: если вставили строку «логин пароль 2FA-ключ» — раскладываем по полям
  const onCredsPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const parsed = parseSellerLine(e.clipboardData.getData('text'))
    if (!parsed) return
    e.preventDefault()
    if (parsed.username) setUsername(parsed.username)
    setPassword(parsed.password)
    if (parsed.totp) setTotp(parsed.totp)
    setPasteNote(`Разложено по полям: ${parsed.username ? `логин @${parsed.username} · ` : ''}пароль${parsed.totp ? ' · 2FA-ключ' : ''}`)
  }

  // Разделы/подразделы (папки) — для назначения аккаунту при создании
  const [sections, setSections] = useState<SectionItem[]>([])
  const [secId, setSecId]       = useState('')  // корневой раздел
  const [subId, setSubId]       = useState('')  // подраздел

  // Прокси: авто (из пула) или уникальный (вручную). Если задан presetProxy — сразу «уникальный».
  const [proxyMode, setProxyMode] = useState<'auto' | 'unique'>('unique')
  const [poolFree, setPoolFree]   = useState(0)   // сколько пуловых прокси со свободной ёмкостью

  useEffect(() => {
    fetch('/api/sections').then((r) => r.ok ? r.json() : []).then(setSections).catch(() => {})
    fetch('/api/proxies').then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d) return
      const cap = d.accountsPerProxy ?? 3
      setPoolFree((d.proxies ?? []).filter((p: any) => p.kind === 'pool' && (p.accountCount ?? 0) < cap).length)
    }).catch(() => {})
  }, [])

  const roots = useMemo(() => sections.filter((s) => !s.parentId), [sections])
  const subs = useMemo(() => sections.filter((s) => s.parentId === secId), [sections, secId])

  const credsOk = mode === 'password' ? Boolean(username.trim() && password.trim()) : Boolean(cookies.trim())
  const proxyOk = proxyMode !== 'auto' || poolFree > 0
  const canSubmit = credsOk && proxyOk

  // Для черновых (parser) куки безопаснее — показываем их первыми и помечаем «рекомендуется».
  const modeOrder: AuthMode[] = defaultMode === 'cookies' ? ['cookies', 'password'] : ['password', 'cookies']

  // Общий блок выбора прокси (одинаков для логина и куки).
  // Если задан presetProxy (открыли с вкладки «Прокси» → «+ аккаунт на этот прокси») —
  // прокси зафиксирован, переключатель не показываем.
  const proxyBlock = presetProxy ? (
    <div>
      <label className="text-[13px] text-subt font-medium block mb-2">Приватный прокси</label>
      <div className="relative">
        <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
        <input value={proxy} readOnly className="field pl-10 font-mono text-[13px] bg-canvas text-subt cursor-default" />
      </div>
      <p className="text-[11px] text-subt mt-1.5 pl-1">Аккаунт будет закреплён за этим прокси.</p>
    </div>
  ) : (
    <div>
      <label className="text-[13px] text-subt font-medium block mb-2">Прокси</label>
      <div className="flex gap-1 p-1 bg-canvas rounded-2xl mb-2.5">
        <button type="button" onClick={() => setProxyMode('auto')}
          className={cn('flex-1 py-1.5 text-[12.5px] font-medium rounded-xl transition-all', proxyMode === 'auto' ? 'bg-card shadow text-ink' : 'text-subt hover:text-ink')}>
          Авто (из пула)
        </button>
        <button type="button" onClick={() => setProxyMode('unique')}
          className={cn('flex-1 py-1.5 text-[12.5px] font-medium rounded-xl transition-all', proxyMode === 'unique' ? 'bg-card shadow text-ink' : 'text-subt hover:text-ink')}>
          Уникальный (вручную)
        </button>
      </div>
      {proxyMode === 'auto' ? (
        poolFree > 0 ? (
          <div className="text-[12px] text-subt bg-canvas rounded-2xl p-3 leading-relaxed">
            Прокси возьмётся автоматически из общего пула (свободно: {poolFree}). Пул и число аккаунтов на один прокси настраиваются на вкладке «Прокси».
          </div>
        ) : (
          <div className="text-[12px] text-warn bg-warn/10 rounded-2xl p-3 leading-relaxed">
            В пуле нет свободных прокси. Добавьте их на вкладке «Прокси» или выберите «Уникальный».
          </div>
        )
      ) : (
        <>
          <div className="relative">
            <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
            <input value={proxy} onChange={(e) => setProxy(e.target.value)}
              className="field pl-10 font-mono text-[13px]" placeholder="user:pass@host:port" />
          </div>
          <p className="text-[11px] text-subt mt-1.5 pl-1">Индивидуальный прокси только для этого аккаунта. Если оставить пустым — прокси подключится автоматически из пула, чтобы вход не шёл без прокси (риск бана). Вход совсем без прокси возможен, только если включить «Работать без прокси» в Настройках.</p>
        </>
      )}
    </div>
  )

  const save = async () => {
    setLoading(true)
    setError('')
    setShot('')
    setStep('auth')

    try {
      const sectionId = subId || secId || undefined
      const proxyVal = proxyMode === 'unique' ? (proxy.trim() || undefined) : undefined
      const body = mode === 'cookies'
        ? { authMethod: 'cookies', cookies: cookies.trim(), proxy: proxyVal, proxyMode, sectionId, role }
        : { username: username.replace(/^@/, '').trim(), password, totpSecret: totp.trim() || undefined, proxy: proxyVal, proxyMode, sectionId, role, emailLogin: emailLogin.trim() || undefined, emailPassword: emailPassword || undefined }

      const res = await fetch('/api/accounts/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      // Instagram запросил код (challenge с почты/SMS или 2FA) → шаг ввода кода.
      if (res.status === 202 && (data.needsChallenge || data.needs2fa)) {
        setChallenge({
          kind: data.needs2fa ? '2fa' : 'challenge',
          username: data.username,
          proxyId: data.proxyId ?? null,
          role: data.role ?? 'RESPONDER',
          sectionId: data.sectionId ?? null,
          stepName: data.stepName ?? '',
          sentTo: data.sentTo ?? null,
          methods: data.methods ?? [],
          contact: data.contact,
          method: data.method,
          phone: data.phone,
        })
        setCode('')
        setError('')
        setResendNote('')
        setAuto2fa('idle')
        setStep('challenge')
        return
      }

      if (!res.ok) { setError(data.error ?? 'Ошибка авторизации'); setShot(data.screenshot ?? ''); setStep('form'); return }

      // Черновые (HELPER) не пишем в основной стор-список — они живут на своей вкладке.
      if (role !== 'HELPER') addAccount({ id: data.account.id, username: data.account.username, followers: 0 })
      onAdded(data.account.username)
      onClose()
    } catch {
      setError('Ошибка сети — проверьте подключение')
      setStep('form')
    } finally {
      setLoading(false)
    }
  }

  // Шаг 2: пользователь ввёл код из письма/SMS → подтверждаем и сохраняем аккаунт.
  // manual=true — явный фолбэк-путь ПОСЛЕ провала авто-2FA: тогда code обязателен и
  // используется на воркере РОВНО как есть (авто-TOTP там пропускается).
  const submitCode = async (manual = false) => {
    if (!challenge) return
    // Авто-попытка 2FA (manual=false, kind='2fa') не требует введённого кода — воркер игнорирует
    // его и считает свой. Во всех остальных случаях (challenge email/SMS, ручной 2FA-фолбэк) код обязателен.
    const isAutoAttempt = challenge.kind === '2fa' && !manual
    if (!isAutoAttempt && !code.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/accounts/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: challenge.username,
          code: code.trim() || '000000',
          proxyId: challenge.proxyId,
          role: challenge.role,
          sectionId: challenge.sectionId,
          mode: challenge.kind === '2fa' ? '2fa' : undefined,
          manual: manual || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Неверный код подтверждения')
        setShot(data.screenshot ?? '')
        if (challenge.kind === '2fa' && !manual) setAuto2fa('failed')
        return
      }

      // Черновые (HELPER) не пишем в основной стор-список — они живут на своей вкладке.
      if (role !== 'HELPER') addAccount({ id: data.account.id, username: data.account.username, followers: 0 })
      onAdded(data.account.username)
      onClose()
    } catch {
      setError('Ошибка сети — проверьте подключение')
      if (challenge.kind === '2fa' && !manual) setAuto2fa('failed')
    } finally {
      setLoading(false)
    }
  }

  // Авто-решение 2FA: срабатывает САМО, как только открылся этот экран — воркер уже знает
  // 2FA-ключ (сохранён на шаге /login) и сам считает/вводит код, человеку вводить нечего.
  // code здесь — заглушка (воркер его игнорирует, пока manual не запрошен явно).
  useEffect(() => {
    if (step === 'challenge' && challenge?.kind === '2fa' && auto2fa === 'idle') {
      setAuto2fa('running')
      submitCode(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, challenge?.kind, auto2fa])

  // Живой обратный отсчёт до смены TOTP-окна (30с) — пока идёт авто-попытка.
  useEffect(() => {
    if (!(step === 'challenge' && challenge?.kind === '2fa' && auto2fa === 'running')) return
    const id = setInterval(() => setSecondsLeft(30 - (Math.floor(Date.now() / 1000) % 30)), 1000)
    return () => clearInterval(id)
  }, [step, challenge?.kind, auto2fa])

  // Повторно отправить код challenge (или на другой канал: 'email' | 'sms').
  const resendCode = async (method: 'email' | 'sms') => {
    if (!challenge) return
    setResending(true); setResendNote(''); setError('')
    try {
      const res = await fetch('/api/accounts/auth/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: challenge.username, method }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Не удалось отправить код повторно'); return }
      setChallenge({ ...challenge, sentTo: data.sentTo })
      setResendNote(data.sentTo === 'sms' ? '✓ Код отправлен повторно по SMS' : '✓ Код отправлен повторно на почту')
    } catch {
      setError('Ошибка сети — проверьте подключение')
    } finally {
      setResending(false)
    }
  }

  // Куда Instagram отправил код — чтобы подсказать пользователю, где искать.
  const chDest = (() => {
    if (!challenge) return ''
    if (challenge.kind === '2fa') {
      return challenge.method === 'app'
        ? 'из приложения-аутентификатора'
        : `по SMS${challenge.phone ? ` на ${challenge.phone}` : ''}`
    }
    if (challenge.sentTo === 'email') return `на почту${challenge.contact?.email ? ` ${challenge.contact.email}` : ''}`
    if (challenge.sentTo === 'sms') return `по SMS${challenge.contact?.phone ? ` на ${challenge.contact.phone}` : ''}`
    return 'на почту или по SMS'
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-md p-7 animate-scale-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="text-[13px] text-subt mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-subt hover:text-ink shrink-0"><X size={22} /></button>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[11px] text-subt">Способ подключения</span>
          <Hint text="Логин/Пароль — стандартный вход, Instagram может запросить подтверждение с нового IP. Куки — вход по уже действующей сессии браузера (sessionid), без пароля." />
        </div>
        <div className="flex gap-1 p-1 bg-canvas rounded-2xl mb-5">
          {modeOrder.map((m) => (
            <button key={m} onClick={() => { setMode(m); setError(''); setShot('') }}
              className={cn('flex-1 py-2 text-[13px] font-medium rounded-xl transition-all',
                mode === m ? 'bg-card shadow text-ink' : 'text-subt hover:text-ink')}>
              {m === 'password' ? '🔑 Логин / Пароль' : `🍪 Куки${defaultMode === 'cookies' ? ' (рекомендуется)' : ''}`}
            </button>
          ))}
        </div>

        {mode === 'password' && (
          <div className="text-[11.5px] text-warn bg-warn/10 rounded-xl px-3 py-2 mb-5 leading-snug">
            ⚠️ Вход по паролю Instagram отклоняет чаще (challenge/blacklist), особенно с нового IP. Если войти не удаётся — надёжнее режим <b>«Куки»</b> (сессия уже создана с чистого IP аккаунта).
          </div>
        )}

        {/* Раздел / подраздел (папка). Создаются на главном экране кнопкой «+ Раздел». */}
        {step === 'form' && roots.length > 0 && (
          <div className="mb-4">
            <label className="text-[13px] text-subt font-medium mb-2 flex items-center gap-1.5">
              <FolderTree className="w-3.5 h-3.5" /> Раздел (необязательно)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select value={secId} onChange={(e) => { setSecId(e.target.value); setSubId('') }} className="field text-[13px] py-2.5">
                <option value="">— без раздела —</option>
                {roots.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={subId} onChange={(e) => setSubId(e.target.value)} disabled={!secId || subs.length === 0}
                className="field text-[13px] py-2.5 disabled:opacity-40">
                <option value="">{secId && subs.length === 0 ? 'нет подразделов' : '— подраздел —'}</option>
                {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {step === 'auth' ? (
          <div className="py-12 flex flex-col items-center gap-4 text-center">
            <Loader2 className="w-10 h-10 text-brand animate-spin" />
            <div className="font-medium">Авторизация в Instagram…</div>
            <div className="text-[13px] text-subt">Это может занять 15–30 секунд</div>
          </div>
        ) : step === 'challenge' && challenge?.kind === '2fa' && auto2fa !== 'failed' ? (
          // 2FA с известным ключом: бот решает САМ (считает TOTP-код из ключа и вписывает его) —
          // ничего вводить не нужно. Только живой таймер и статус попытки.
          <div className="space-y-4">
            <div className="flex flex-col items-center text-center gap-3 pt-2 pb-2">
              <div className="w-14 h-14 rounded-2xl bg-brand/10 flex items-center justify-center relative">
                <ShieldCheck className="w-7 h-7 text-brand" />
                <Loader2 className="w-14 h-14 text-brand/40 animate-spin absolute inset-0" />
              </div>
              <div className="font-semibold text-[17px]">Бот сам решает 2FA</div>
              <div className="text-[13px] text-subt leading-relaxed max-w-[280px]">
                Ключ 2FA уже известен — код считается автоматически и вводится ботом для <b>@{challenge?.username}</b>. Вводить ничего не нужно, просто подождите.
              </div>
              <div className="text-[28px] font-mono font-semibold text-brand tabular-nums">{secondsLeft}с</div>
              <div className="text-[11.5px] text-subt">до пересчёта кода (окно 30с) — попытки продолжатся автоматически</div>
            </div>
            {error && <div className="text-bad text-[12.5px] whitespace-pre-wrap break-words bg-bad/[0.06] rounded-2xl p-3 max-h-56 overflow-y-auto leading-relaxed">{error}</div>}
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => { setStep('form'); setError(''); setCode(''); setResendNote(''); setAuto2fa('idle') }}>Отмена</Button>
            </div>
          </div>
        ) : step === 'challenge' ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center text-center gap-2 pt-1">
              <div className="w-12 h-12 rounded-2xl bg-brand/10 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-brand" />
              </div>
              <div className="font-semibold text-[17px]">
                {challenge?.kind === '2fa' ? 'Автоматический ввод не сработал' : 'Подтверждение входа'}
              </div>
              <div className="text-[13px] text-subt leading-relaxed">
                {challenge?.kind === '2fa'
                  ? <>Бот не смог сам отправить форму 2FA. Введите код {chDest} для <b>@{challenge?.username}</b> вручную (он подставится РОВНО как вы его ввели, авто-расчёт в этот раз не используется).</>
                  : <>Instagram отправил код подтверждения {chDest} аккаунта <b>@{challenge?.username}</b>. Введите его ниже.</>}
              </div>
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => e.key === 'Enter' && submitCode(challenge?.kind === '2fa')}
              autoFocus inputMode="numeric"
              className="field text-center tracking-[0.4em] text-[20px] font-mono"
              placeholder="——————"
            />

            {/* Повтор / выбор канала — только для challenge (у 2FA источник кода — свой authenticator) */}
            {challenge?.kind === 'challenge' && (
              <div className="text-[12px] text-subt text-center leading-relaxed">
                Не пришёл код?{' '}
                <button type="button" disabled={resending}
                  onClick={() => resendCode(challenge.sentTo === 'sms' ? 'sms' : 'email')}
                  className="text-brand font-medium hover:underline disabled:opacity-50">
                  {resending ? 'Отправляю…' : 'Отправить ещё раз'}
                </button>
                {challenge.methods?.includes('sms') && challenge.methods?.includes('email') && (
                  <>
                    {' · '}
                    <button type="button" disabled={resending}
                      onClick={() => resendCode(challenge.sentTo === 'sms' ? 'email' : 'sms')}
                      className="text-brand font-medium hover:underline disabled:opacity-50">
                      {challenge.sentTo === 'sms' ? 'Прислать на почту' : 'Прислать по SMS'}
                    </button>
                  </>
                )}
              </div>
            )}
            {challenge?.kind === '2fa' && (
              <div className="text-[12px] text-subt text-center">
                <button type="button" onClick={() => { setAuto2fa('idle'); setError(''); setShot('') }} className="text-brand font-medium hover:underline">
                  Попробовать авто-решение ещё раз
                </button>
              </div>
            )}
            {resendNote && <div className="text-[12px] text-ok text-center">{resendNote}</div>}

            {error && <div className="text-bad text-[12.5px] whitespace-pre-wrap break-words bg-bad/[0.06] rounded-2xl p-3 max-h-56 overflow-y-auto leading-relaxed">{error}</div>}
            {shot && (
              <a href={shot} target="_blank" rel="noreferrer" className="block mt-1.5">
                <img src={shot} alt="Экран Instagram при ошибке входа" className="w-full rounded-2xl border border-black/10" />
                <span className="block text-subt text-[11px] mt-1">📷 Что увидел браузер при входе (клик — открыть крупно). Видно: бот-защита / «подождите» / checkpoint / другой экран.</span>
              </a>
            )}
            <div className="text-[12px] text-subt bg-canvas rounded-2xl p-3.5 leading-relaxed">
              {challenge?.kind === '2fa'
                ? 'Код из приложения обновляется каждые 30 секунд — вводите свежий, ближе к моменту отправки.'
                : 'Код приходит в течение минуты. Проверьте папку «Спам». Не закрывайте это окно.'}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => { setStep('form'); setError(''); setCode(''); setResendNote(''); setAuto2fa('idle') }} disabled={loading}>Назад</Button>
              <Button className="flex-1" onClick={() => submitCode(challenge?.kind === '2fa')} disabled={loading || !code.trim()}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Подтвердить'}
              </Button>
            </div>
          </div>
        ) : mode === 'password' ? (
          <div className="space-y-4">
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Instagram логин</label>
              <div className="relative">
                <AtSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input value={username} onChange={(e) => setUsername(e.target.value)}
                  onPaste={onCredsPaste}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  autoFocus className="field pl-10" placeholder="username" />
              </div>
            </div>
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Пароль</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  onPaste={onCredsPaste}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  className="field pl-10" placeholder="••••••••" />
              </div>
            </div>
            <div>
              <label className="text-[13px] text-subt font-medium mb-2 flex items-center gap-1.5">
                2FA-ключ <span className="text-subt/70 font-normal">(если включена 2FA)</span>
                <Hint text="Ключ двухфакторной аутентификации (base32, вида JBSW Y3DP…). Магазины дают его в комплекте у аккаунтов «2FA verified with key». Без него вход в такой аккаунт Instagram не пропустит. Оставьте пустым, если 2FA нет." />
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                <input value={totp} onChange={(e) => setTotp(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  className="field pl-10 font-mono text-[13px]" placeholder="напр. JBSWY3DPEHPK3PXP (необязательно)" />
              </div>
            </div>
            <div>
              <label className="text-[13px] text-subt font-medium mb-2 flex items-center gap-1.5">
                Почта аккаунта <span className="text-subt/70 font-normal">(необязательно)</span>
                <Hint text="Почта и её пароль нужны, чтобы автоматически прочитать код подтверждения (challenge), который Instagram шлёт на новое устройство. Если не задать — код вводится вручную. Пароль почты не показывается и используется только для чтения кода." />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                  <input value={emailLogin} onChange={(e) => setEmailLogin(e.target.value)}
                    className="field pl-9 text-[13px]" placeholder="email аккаунта" />
                </div>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-subt" />
                  <input type="password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)}
                    className="field pl-9 text-[13px]" placeholder="пароль почты" />
                </div>
              </div>
            </div>
            {pasteNote && <div className="text-[12px] text-ok bg-ok/10 rounded-2xl px-3 py-2">✓ {pasteNote}</div>}
            {proxyBlock}
            {error && <div className="text-bad text-[12.5px] whitespace-pre-wrap break-words bg-bad/[0.06] rounded-2xl p-3 max-h-56 overflow-y-auto leading-relaxed">{error}</div>}
            {shot && (
              <a href={shot} target="_blank" rel="noreferrer" className="block mt-1.5">
                <img src={shot} alt="Экран Instagram при ошибке входа" className="w-full rounded-2xl border border-black/10" />
                <span className="block text-subt text-[11px] mt-1">📷 Что увидел браузер при входе (клик — открыть крупно). Видно: бот-защита / «подождите» / checkpoint / другой экран.</span>
              </a>
            )}
            <div className="text-[12px] text-subt bg-canvas rounded-2xl p-3.5 leading-relaxed">
              Пароль не хранится — только сессия Instagram.
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Отмена</Button>
              <Button className="flex-1" onClick={save} disabled={!canSubmit}>Авторизоваться</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-[13px] text-subt font-medium block mb-2">Куки Instagram</label>
              <textarea
                value={cookies} onChange={(e) => setCookies(e.target.value)}
                autoFocus rows={6}
                className="field font-mono text-[11px] resize-none leading-relaxed"
                placeholder={'{"sessionid": "abc123...", "ds_user_id": "12345", "csrftoken": "..."}\n\nИли просто sessionid:\nabc123...'}
              />
            </div>
            {proxyBlock}
            {error && <div className="text-bad text-[12.5px] whitespace-pre-wrap break-words bg-bad/[0.06] rounded-2xl p-3 max-h-56 overflow-y-auto leading-relaxed">{error}</div>}
            {shot && (
              <a href={shot} target="_blank" rel="noreferrer" className="block mt-1.5">
                <img src={shot} alt="Экран Instagram при ошибке входа" className="w-full rounded-2xl border border-black/10" />
                <span className="block text-subt text-[11px] mt-1">📷 Что увидел браузер при входе (клик — открыть крупно). Видно: бот-защита / «подождите» / checkpoint / другой экран.</span>
              </a>
            )}
            <div className="text-[12px] text-subt bg-canvas rounded-2xl p-3.5 leading-relaxed">
              Экспортируйте куки с instagram.com через расширение браузера (например, Cookie-Editor). Нужен как минимум <code className="font-mono bg-black/5 px-1 rounded">sessionid</code>.
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Отмена</Button>
              <Button className="flex-1" onClick={save} disabled={!canSubmit}>Подключить</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

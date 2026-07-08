'use client'

import { useState } from 'react'
import { X, Loader2, Check, AlertTriangle, Cookie, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RowResult {
  line: number; ok: boolean; username?: string; reason?: string
  needsCode?: boolean
  codeMode?: 'challenge' | '2fa'
  proxyId?: string | null
  role?: Role
  sentTo?: string | null
  method?: string | null
}
type Mode = 'cookies' | 'password'
type Role = 'RESPONDER' | 'HELPER'

/**
 * Массовый импорт аккаунтов. Одна строка — один аккаунт. Два режима:
 *  • Куки — массив Cookie-Editor / JSON / k=v / sessionid / мобильная сессия (можно «логин|пароль|UA|куки»).
 *  • Логин/Пароль — «логин пароль почта почта-пароль [2FA-ключ]» (разделитель — пробел или |).
 * Роль (основной/черновой) применяется ко всем импортируемым в этой пачке. Прокси — авто из пула.
 */
export function ImportCookiesModal({ onClose, onDone, lockedRole }: { onClose: () => void; onDone: (imported: number) => void; lockedRole?: Role }) {
  const [mode, setMode]       = useState<Mode>('password')
  const [role, setRole]       = useState<Role>(lockedRole ?? 'RESPONDER')
  const [text, setText]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [res, setRes]         = useState<{ imported: number; skipped: number; results: RowResult[] } | null>(null)
  const [doneCount, setDoneCount] = useState(0)   // сколько «ждавших код» строк дожали

  const lineCount = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length

  const run = async () => {
    setLoading(true); setError(''); setRes(null); setDoneCount(0)
    // Клиентский таймаут — чтобы кнопка не «крутилась бесконечно», если пачка большая
    // и вход к Instagram затянулся дольше, чем держит шлюз. Каждый вход — 15–40с.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
    try {
      const r = await fetch('/api/accounts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode, role }),
        signal: controller.signal,
      })
      // Читаем как текст: ответ может быть не-JSON (например, gateway-таймаут 502/504),
      // тогда покажем статус и тело, а не глухое «Ошибка импорта».
      const rawBody = await r.text()
      let d: any = null
      try { d = rawBody ? JSON.parse(rawBody) : null } catch { /* не JSON */ }
      if (!r.ok) {
        if (d?.error) setError(d.error)
        else if (r.status === 502 || r.status === 504)
          setError(`Шлюз оборвал запрос (${r.status}) — вход занял слишком долго. Импортируйте по 1–2 строки за раз (каждый вход к Instagram — 15–40с).`)
        else setError(`Ошибка ${r.status}: ${(rawBody || 'пустой ответ').slice(0, 300)}`)
        return
      }
      if (!d) { setError('Сервер вернул пустой ответ — попробуйте меньше строк за раз.'); return }
      setRes(d)
      if (d.imported > 0) onDone(d.imported)
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setError('Импорт идёт дольше 90с и был прерван. Импортируйте по 1 строке за раз — каждый вход к Instagram занимает 15–40с (проверка прокси + вход).')
      } else {
        setError(`Ошибка сети — ${e?.message ?? 'проверьте подключение'}`)
      }
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }

  const pending = res?.results.filter((x) => x.needsCode) ?? []
  const failed = res?.results.filter((x) => !x.ok && !x.needsCode) ?? []

  const tab = (v: Mode | Role, cur: Mode | Role, set: () => void, label: string) => (
    <button type="button" onClick={set}
      className={cn('flex-1 py-1.5 text-[12.5px] font-medium rounded-xl transition-all',
        v === cur ? 'bg-card shadow text-ink' : 'text-subt hover:text-ink')}>
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="card w-full max-w-lg p-7 animate-scale-in max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-ok/10 flex items-center justify-center shrink-0">
              <Cookie className="w-5 h-5 text-ok" />
            </div>
            <div>
              <h2 className="text-[20px] font-semibold tracking-tight leading-tight">Массовый импорт аккаунтов</h2>
              <p className="text-[12.5px] text-subt mt-0.5">Одна строка — один аккаунт</p>
            </div>
          </div>
          <button onClick={onClose} className="text-subt hover:text-ink"><X size={22} /></button>
        </div>

        {/* Режим входа */}
        <div className="text-[11px] text-subt mb-1.5">Способ входа</div>
        <div className="flex gap-1 p-1 bg-canvas rounded-2xl mb-3">
          {tab('password', mode, () => { setMode('password'); setRes(null) }, '🔑 Логин / Пароль')}
          {tab('cookies', mode, () => { setMode('cookies'); setRes(null) }, '🍪 Куки')}
        </div>

        {/* Роль — скрываем, если она зафиксирована (например, импорт с вкладки «Черновые»). */}
        {lockedRole ? (
          <div className="text-[12px] text-subt bg-canvas rounded-2xl px-3.5 py-2.5 mb-4 leading-snug">
            Все аккаунты импортируются как <b className="text-ink">{lockedRole === 'HELPER' ? 'черновые (парсят подписчиков)' : 'основные (шлют)'}</b>.
          </div>
        ) : (
          <>
            <div className="text-[11px] text-subt mb-1.5">Роль всех аккаунтов в пачке</div>
            <div className="flex gap-1 p-1 bg-canvas rounded-2xl mb-4">
              {tab('RESPONDER', role, () => setRole('RESPONDER'), 'Основные (шлют)')}
              {tab('HELPER', role, () => setRole('HELPER'), 'Черновые (парсят)')}
            </div>
          </>
        )}

        <div className="text-[12px] text-subt bg-canvas rounded-2xl p-3.5 leading-relaxed mb-4">
          {mode === 'password' ? (
            <>
              <div className="font-medium text-ink mb-1">Формат строки:</div>
              <div className="font-mono text-[11px] text-brand">логин пароль почта почта-пароль [2FA-ключ]</div>
              <div className="mt-1.5">Почта и её пароль в аккаунт не сохраняются (нужны вам для восстановления). Если у аккаунта включена <b>2FA</b> — добавьте 2FA-ключ (base32) последним, иначе Instagram не пустит.</div>
            </>
          ) : (
            <>
              <div className="font-medium text-ink mb-1">Формат: <code className="font-mono bg-black/5 px-1 rounded">логин|пароль|User-Agent|куки</code> или просто куки.</div>
              <div className="mt-1.5">Куки Instagram: массив Cookie-Editor, JSON, <code className="font-mono bg-black/5 px-1 rounded">sessionid=…</code> или сырой sessionid. Нужен <b>sessionid</b> с instagram.com — куки Facebook (c_user/xs) не подойдут.</div>
            </>
          )}
        </div>

        <textarea
          value={text} onChange={(e) => setText(e.target.value)}
          autoFocus rows={8} disabled={loading}
          className="field font-mono text-[11px] resize-none leading-relaxed w-full disabled:opacity-60"
          placeholder={mode === 'password'
            ? 'rudywu19 GZWTmVJ3 braelynnbarnett@onet.pl marsh#@295\nlianawu82 bKsDqAsG novadwalton@onet.pl marsh#@295'
            : 'login|pass|Mozilla/5.0 …|[{"name":"sessionid","value":"…"}]\nsessionid=abc123…; ds_user_id=1; csrftoken=…'}
        />

        {lineCount > 2 && !res && (
          <p className="text-[11.5px] text-warn bg-warn/10 rounded-xl px-3 py-2 mt-3 leading-snug">
            ⚠️ {lineCount} строк за раз. Каждый вход к Instagram — 15–40с, большая пачка может упереться в таймаут шлюза. Надёжнее импортировать по 1–2 строки.
          </p>
        )}
        {error && <p className="text-bad text-[13px] text-center mt-3">{error}</p>}

        {res && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <span className="inline-flex items-center gap-1.5 text-ok font-medium"><Check className="w-4 h-4" /> Импортировано: {res.imported + doneCount}</span>
              {pending.length > doneCount && <span className="inline-flex items-center gap-1.5 text-brand font-medium"><KeyRound className="w-4 h-4" /> Ждут код: {pending.length - doneCount}</span>}
              {failed.length > 0 && <span className="inline-flex items-center gap-1.5 text-warn font-medium"><AlertTriangle className="w-4 h-4" /> Ошибок: {failed.length}</span>}
            </div>

            {/* Аккаунты, которым Instagram отправил код — «дожимаем» вводом кода (challenge/2FA). */}
            {pending.length > 0 && (
              <div className="space-y-2">
                {pending.map((p) => (
                  <PendingCodeRow key={p.line} row={p} onDone={() => { setDoneCount((c) => c + 1); onDone(1) }} />
                ))}
              </div>
            )}

            {failed.length > 0 && (
              <div className="bg-canvas rounded-2xl p-3 space-y-1 max-h-40 overflow-y-auto">
                {failed.map((f) => (
                  <div key={f.line} className="text-[11.5px] text-bad leading-snug">
                    <span className="text-subt">Строка {f.line}:</span> {f.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <Button variant="secondary" className="flex-1" onClick={onClose}>{res ? 'Закрыть' : 'Отмена'}</Button>
          <Button className="flex-1" onClick={run} disabled={loading || !text.trim()}>
            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Импорт…</span> : 'Импортировать'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Строка «аккаунт ждёт код»: Instagram при массовом импорте запросил подтверждение
 * (challenge — «новое устройство» — или 2FA без ключа). Воркер уже отправил код и хранит
 * challenge-сессию по username, поэтому здесь достаточно ввести код — он уходит в тот же
 * роут, что и одиночный вход (/api/accounts/auth/challenge). Есть повтор/смена канала.
 */
function PendingCodeRow({ row, onDone }: { row: RowResult; onDone: () => void }) {
  const [code, setCode]         = useState('')
  const [busy, setBusy]         = useState(false)
  const [resent, setResent]     = useState(false)
  const [err, setErr]           = useState('')
  const [ok, setOk]             = useState(false)
  const is2fa = row.codeMode === '2fa'

  const submit = async () => {
    const c = code.replace(/\D/g, '')
    if (c.length < 4) { setErr('Введите код из письма/SMS'); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/accounts/auth/challenge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: row.username, code: c, proxyId: row.proxyId ?? undefined,
          role: row.role, mode: is2fa ? '2fa' : undefined,
        }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok) { setErr(d?.error ?? `Ошибка ${r.status}`); return }
      setOk(true); onDone()
    } catch (e: any) {
      setErr(`Ошибка сети — ${e?.message ?? 'проверьте подключение'}`)
    } finally {
      setBusy(false)
    }
  }

  const resend = async (method: 'email' | 'sms') => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/accounts/auth/resend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: row.username, method }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d?.ok) { setErr(d?.error ?? 'Не удалось отправить код повторно'); return }
      setResent(true)
    } catch (e: any) {
      setErr(`Ошибка сети — ${e?.message ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  if (ok) {
    return (
      <div className="bg-ok/10 rounded-2xl px-3.5 py-2.5 text-[12.5px] text-ok inline-flex items-center gap-1.5 w-full">
        <Check className="w-4 h-4 shrink-0" /> @{row.username} — вход завершён
      </div>
    )
  }

  const dest = is2fa
    ? (row.method === 'app' ? 'приложение-аутентификатор' : 'SMS')
    : (row.sentTo === 'sms' ? 'SMS' : 'почту')

  return (
    <div className="bg-brand/5 border border-brand/20 rounded-2xl p-3.5">
      <div className="text-[12.5px] font-medium text-ink flex items-center gap-1.5">
        <KeyRound className="w-3.5 h-3.5 text-brand shrink-0" /> @{row.username}
      </div>
      <div className="text-[11.5px] text-subt mt-0.5 leading-snug">
        {is2fa
          ? `Instagram запросил код двухфакторной аутентификации (${dest}).`
          : `Instagram отправил код подтверждения на ${dest}.`}
      </div>
      <div className="flex gap-2 mt-2">
        <input
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric" placeholder="Код" disabled={busy}
          className="field flex-1 text-center tracking-[0.3em] font-mono text-[14px] disabled:opacity-60"
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <Button onClick={submit} disabled={busy || !code}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Подтвердить'}
        </Button>
      </div>
      {!is2fa && (
        <div className="text-[11px] text-subt mt-2">
          Не пришёл код?{' '}
          <button type="button" disabled={busy} onClick={() => resend('email')} className="text-brand hover:underline disabled:opacity-50">отправить ещё раз</button>
          {' · '}
          <button type="button" disabled={busy} onClick={() => resend(row.sentTo === 'sms' ? 'email' : 'sms')} className="text-brand hover:underline disabled:opacity-50">
            прислать {row.sentTo === 'sms' ? 'на почту' : 'по SMS'}
          </button>
          {resent && <span className="text-ok ml-1">✓ отправлено</span>}
        </div>
      )}
      {err && <p className="text-bad text-[11.5px] mt-2">{err}</p>}
    </div>
  )
}

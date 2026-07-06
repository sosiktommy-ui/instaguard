'use client'

import { useState } from 'react'
import { X, Loader2, Check, AlertTriangle, Cookie } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface RowResult { line: number; ok: boolean; username?: string; reason?: string }
type Mode = 'cookies' | 'password'
type Role = 'RESPONDER' | 'HELPER'

/**
 * Массовый импорт аккаунтов. Одна строка — один аккаунт. Два режима:
 *  • Куки — массив Cookie-Editor / JSON / k=v / sessionid / мобильная сессия (можно «логин|пароль|UA|куки»).
 *  • Логин/Пароль — «логин пароль почта почта-пароль [2FA-ключ]» (разделитель — пробел или |).
 * Роль (основной/черновой) применяется ко всем импортируемым в этой пачке. Прокси — авто из пула.
 */
export function ImportCookiesModal({ onClose, onDone }: { onClose: () => void; onDone: (imported: number) => void }) {
  const [mode, setMode]       = useState<Mode>('password')
  const [role, setRole]       = useState<Role>('RESPONDER')
  const [text, setText]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [res, setRes]         = useState<{ imported: number; skipped: number; results: RowResult[] } | null>(null)

  const run = async () => {
    setLoading(true); setError(''); setRes(null)
    try {
      const r = await fetch('/api/accounts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, mode, role }),
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
      setError(`Ошибка сети — ${e?.message ?? 'проверьте подключение'}`)
    } finally {
      setLoading(false)
    }
  }

  const failed = res?.results.filter((x) => !x.ok) ?? []

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

        {/* Роль */}
        <div className="text-[11px] text-subt mb-1.5">Роль всех аккаунтов в пачке</div>
        <div className="flex gap-1 p-1 bg-canvas rounded-2xl mb-4">
          {tab('RESPONDER', role, () => setRole('RESPONDER'), 'Основные (шлют)')}
          {tab('HELPER', role, () => setRole('HELPER'), 'Черновые (парсят)')}
        </div>

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

        {error && <p className="text-bad text-[13px] text-center mt-3">{error}</p>}

        {res && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-4 text-[13px]">
              <span className="inline-flex items-center gap-1.5 text-ok font-medium"><Check className="w-4 h-4" /> Импортировано: {res.imported}</span>
              {res.skipped > 0 && <span className="inline-flex items-center gap-1.5 text-warn font-medium"><AlertTriangle className="w-4 h-4" /> Пропущено: {res.skipped}</span>}
            </div>
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

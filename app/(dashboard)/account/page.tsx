'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  User, Mail, Calendar, Lock, Sparkles, Check, ArrowRight, Eye, EyeOff,
  Loader2, Users, CreditCard, Building2, Crown, Settings2, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/common/PageHeader'
import { IconTile } from '@/components/common/IconTile'
import { TONE, hexA, darken } from '@/lib/colors'
import { cn } from '@/lib/utils'
import { getPlan, type PlanId } from '@/lib/plans'

const PLAN_ICON: Record<PlanId, any> = { free: User, pro: Sparkles, business: Building2, agency: Crown }

interface Me {
  email: string
  name: string | null
  plan: string
  createdAt: string
  accountCount: number
}

export default function AccountPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [loadErr, setLoadErr] = useState(false)

  const load = useCallback(() => {
    setLoadErr(false)
    fetch('/api/account')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setMe)
      .catch(() => setLoadErr(true))
  }, [])

  useEffect(() => { load() }, [load])

  if (loadErr) {
    return (
      <div className="card p-8 text-center max-w-md mx-auto mt-6">
        <AlertCircle className="w-8 h-8 text-bad mx-auto mb-3" />
        <div className="font-semibold">Не удалось загрузить профиль</div>
        <p className="text-subt text-[14px] mt-1">Проверьте соединение и попробуйте снова.</p>
        <Button variant="secondary" className="mt-4" onClick={load}>Повторить</Button>
      </div>
    )
  }

  if (!me) return <AccountSkeleton />

  const plan = getPlan(me.plan)
  const PlanIcon = PLAN_ICON[plan.id]
  const initial = (me.name?.trim()?.[0] || me.email[0] || 'U').toUpperCase()
  const registered = safeDate(me.createdAt)
  const maxAcc = plan.maxAccounts
  const pct = maxAcc ? Math.min(100, Math.round((me.accountCount / maxAcc) * 100)) : 0

  return (
    <div className="space-y-6 pb-4">
      <PageHeader icon={User} title="Личный кабинет" subtitle="Профиль, тариф и оплата">
        <Button size="lg" onClick={() => router.push('/pricing')} className="gap-2">
          <Sparkles className="w-4 h-4" /> Посмотреть тарифы
        </Button>
      </PageHeader>

      {/* Приветствие */}
      <div className="card gloss rise p-5 flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-semibold text-[22px] shrink-0"
          style={{
            background: `linear-gradient(145deg, ${TONE.brand}, ${darken(TONE.brand)})`,
            boxShadow: `0 6px 18px ${hexA(TONE.brand, 0.4)}, inset 0 1.5px 1px rgba(255,255,255,0.4)`,
          }}
          aria-hidden
        >
          {initial}
        </div>
        <div className="min-w-0">
          <div className="text-[19px] font-semibold tracking-tight truncate">{me.name || 'Ваш аккаунт'}</div>
          <div className="text-subt text-[14px] truncate">{me.email}</div>
        </div>
        <span
          className="ml-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium"
          style={{ background: hexA(plan.accent, 0.12), color: plan.accent }}
        >
          <PlanIcon className="w-3.5 h-3.5" /> {plan.name}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 items-start">
        {/* Тариф и оплата */}
        <div className="lg:col-span-2 card gloss rise p-6" style={{ animationDelay: '60ms' }}>
          <div className="flex items-center gap-3">
            <IconTile icon={PlanIcon} color={plan.accent} size={44} />
            <div className="min-w-0">
              <div className="text-subt text-[12px] uppercase tracking-wide">Текущий тариф</div>
              <div className="text-[20px] font-semibold tracking-tight leading-tight">{plan.name}</div>
            </div>
          </div>

          {/* Использование: аккаунты */}
          <div className="mt-5">
            <div className="flex items-center justify-between text-[13px] mb-1.5">
              <span className="text-subt inline-flex items-center gap-1.5"><Users className="w-4 h-4" /> Instagram-аккаунты</span>
              <span className="font-medium tabular-nums">{me.accountCount} / {maxAcc ?? '∞'}</span>
            </div>
            <div className="h-2.5 rounded-full bg-black/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${maxAcc ? pct : 100}%`, background: `linear-gradient(90deg, ${plan.accent}, ${darken(plan.accent, 0.82)})` }}
              />
            </div>
            {maxAcc && me.accountCount >= maxAcc && (
              <div className="text-[12.5px] text-warn mt-2">Лимит аккаунтов тарифа исчерпан — повысьте тариф, чтобы добавить ещё.</div>
            )}
          </div>

          {/* Что входит (кратко) */}
          <ul className="mt-5 grid sm:grid-cols-2 gap-2">
            {plan.features.filter((f) => f.included).slice(0, 4).map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-[13.5px] text-ink/85">
                <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: plan.accent }} />
                <span className="leading-snug">{f.text}</span>
              </li>
            ))}
          </ul>

          {/* Действия */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <Button size="lg" onClick={() => router.push('/pricing')} className="gap-2">
              <Sparkles className="w-4 h-4" /> Посмотреть тарифы <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              disabled
              title="Доступно после подключения онлайн-оплаты (Stripe)"
              className="gap-2"
            >
              <CreditCard className="w-4 h-4" /> Управлять подпиской
            </Button>
          </div>
          <p className="text-[12px] text-subt mt-2.5">
            Онлайн-оплата (Stripe) и управление подпиской подключаются в ближайшее время.
          </p>
        </div>

        {/* Профиль */}
        <div className="card gloss rise p-6 space-y-5" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center gap-2.5">
            <IconTile icon={Settings2} color={TONE.alt} size={40} />
            <div className="text-[16px] font-semibold tracking-tight">Профиль</div>
          </div>

          <NameEditor initial={me.name ?? ''} onSaved={(n) => setMe((m) => (m ? { ...m, name: n } : m))} />

          <Field icon={Mail} label="Email">
            <div className="text-[14px] text-ink/90 truncate">{me.email}</div>
          </Field>

          <Field icon={Calendar} label="Регистрация">
            <div className="text-[14px] text-ink/90">{registered}</div>
          </Field>

          <div className="pt-1">
            <PasswordChanger />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Имя ── */
function NameEditor({ initial, onSaved }: { initial: string; onSaved: (n: string | null) => void }) {
  const [name, setName] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const dirty = name.trim() !== initial.trim()

  const save = async () => {
    setSaving(true); setSaved(false)
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) { onSaved(d.name ?? null); setSaved(true); setTimeout(() => setSaved(false), 2500) }
    } finally { setSaving(false) }
  }

  return (
    <div>
      <label htmlFor="acc-name" className="flex items-center gap-2 text-[12px] text-subt mb-1.5">
        <User className="w-3.5 h-3.5" /> Имя
      </label>
      <div className="flex gap-2">
        <input
          id="acc-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Как к вам обращаться"
          maxLength={80}
          className="field !py-2.5 !px-4 flex-1"
        />
        <Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty || saving} onClick={save} className="shrink-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : 'Сохранить'}
        </Button>
      </div>
      {saved && <div className="text-[12px] text-ok mt-1.5" role="status" aria-live="polite">Сохранено</div>}
    </div>
  )
}

/* ── Пароль ── */
function PasswordChanger() {
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)

  const reset = () => { setCur(''); setNext(''); setConfirm(''); setErr(null) }

  const submit = async () => {
    setErr(null)
    if (next.length < 6) return setErr('Новый пароль не короче 6 символов')
    if (next !== confirm) return setErr('Пароли не совпадают')
    setLoading(true)
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(d.error || 'Не удалось сменить пароль'); return }
      setOk(true); reset()
      setTimeout(() => { setOk(false); setOpen(false) }, 2000)
    } catch {
      setErr('Ошибка сети — попробуйте снова')
    } finally { setLoading(false) }
  }

  if (!open) {
    return (
      <button
        onClick={() => { reset(); setOpen(true) }}
        className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl text-[14px] font-medium text-ink/80 bg-black/[0.03] hover:bg-black/[0.05] transition-colors"
      >
        <Lock className="w-4 h-4 text-subt" /> Сменить пароль
      </button>
    )
  }

  return (
    <div className="rounded-2xl bg-black/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-2 text-[14px] font-medium"><Lock className="w-4 h-4 text-subt" /> Смена пароля</div>
      <PwInput label="Текущий пароль" value={cur} onChange={setCur} show={show} autoComplete="current-password" />
      <PwInput label="Новый пароль" value={next} onChange={setNext} show={show} autoComplete="new-password" />
      <PwInput label="Повторите новый" value={confirm} onChange={setConfirm} show={show} autoComplete="new-password" />

      <label className="flex items-center gap-2 text-[12.5px] text-subt cursor-pointer select-none">
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="inline-flex items-center gap-1.5 hover:text-ink transition-colors"
          aria-pressed={show}
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {show ? 'Скрыть пароли' : 'Показать пароли'}
        </button>
      </label>

      {err && <div className="text-[13px] text-bad flex items-center gap-1.5" role="alert"><AlertCircle className="w-4 h-4 shrink-0" /> {err}</div>}
      {ok && <div className="text-[13px] text-ok flex items-center gap-1.5" role="status" aria-live="polite"><Check className="w-4 h-4" /> Пароль изменён</div>}

      <div className="flex gap-2 pt-1">
        <Button size="sm" disabled={loading || !cur || !next || !confirm} onClick={submit}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить пароль'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { reset(); setOpen(false) }}>Отмена</Button>
      </div>
    </div>
  )
}

function PwInput({ label, value, onChange, show, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; show: boolean; autoComplete: string
}) {
  return (
    <div>
      <label className="block text-[12px] text-subt mb-1">{label}</label>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="field !py-2.5 !px-4"
      />
    </div>
  )
}

function Field({ icon: Icon, label, children }: { icon: any; label: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[12px] text-subt mb-1.5"><Icon className="w-3.5 h-3.5" /> {label}</div>
      {children}
    </div>
  )
}

function safeDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return '—' }
}

function AccountSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-12 w-64 bg-black/[0.05] rounded-2xl" />
      <div className="h-24 card" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 h-72 card" />
        <div className="h-72 card" />
      </div>
    </div>
  )
}

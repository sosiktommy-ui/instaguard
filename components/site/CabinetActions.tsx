'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

// Кнопки кабинета, требующие fetch+редирект (роуты возвращают JSON, а не 30x — form-post не годится).

export function ManageSubscriptionButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const go = async () => {
    setLoading(true); setMsg('')
    try {
      const r = await fetch('/api/billing/portal', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (d?.url) { window.location.href = d.url; return }
      setMsg(d?.error || 'Онлайн-оплата ещё не подключена')
    } catch { setMsg('Ошибка сети') }
    setLoading(false)
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <button type="button" className={className} disabled={loading} onClick={go}>
        {loading ? 'Открываю…' : 'Управлять подпиской'}
      </button>
      {msg && <span style={{ fontSize: 12, color: '#d97706' }}>{msg}</span>}
    </span>
  )
}

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter()
  const out = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
    try { localStorage.removeItem('instaguard-store') } catch {}
    router.push('/lp'); router.refresh()
  }
  return (
    <button type="button" className={className} onClick={out} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#dc2626' }}>
      <LogOut size={16} /> Выйти
    </button>
  )
}

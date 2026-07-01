'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/components/common/AppLogo'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleLogin = async () => {
    if (!email || !password) { setError('Заполните все поля'); return }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Неверный email или пароль')
        setLoading(false)
        return
      }
      // Кука выставлена сервером — обновляем, чтобы middleware увидел сессию
      router.push('/')
      router.refresh()
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-canvas">
      <div className="w-full max-w-[400px] animate-scale-in">
        <div className="flex flex-col items-center mb-8">
          <AppLogo size={96} detailed className="mb-5 float-y drop-shadow-2xl" />
          <h1 className="text-[28px] font-semibold tracking-tight">Вход в ShadowGram</h1>
          <p className="text-subt mt-1.5 text-[15px]">Automation Suite</p>
        </div>

        <div className="card p-7 space-y-3.5">
          <input type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            className="field" />
          <input type="password" placeholder="Пароль" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            className="field" />

          {error && <p className="text-bad text-[13px] text-center">{error}</p>}

          <Button onClick={handleLogin} disabled={loading} size="lg" className="w-full mt-1">
            {loading ? 'Вход…' : 'Войти'}
          </Button>
        </div>

      </div>
    </div>
  )
}

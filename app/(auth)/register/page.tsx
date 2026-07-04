'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AppLogo } from '@/components/common/AppLogo'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleRegister = async () => {
    if (!email || !password) { setError('Заполните email и пароль'); return }
    if (password.length < 6) { setError('Пароль должен быть не короче 6 символов'); return }
    if (password !== confirm) { setError('Пароли не совпадают'); return }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Не удалось зарегистрироваться')
        setLoading(false)
        return
      }
      // Новый пользователь — показываем обучение (сбрасываем флаг прошлого показа в этом браузере)
      try { localStorage.removeItem('rg-onboarded') } catch {}
      // Кука выставлена сервером — переходим в приложение
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
          <AppLogo size={96} detailed className="mb-5 drop-shadow-2xl" />
          <h1 className="text-[28px] font-semibold tracking-tight">Регистрация в ReactiveGram</h1>
          <p className="text-subt mt-1.5 text-[15px]">Создайте аккаунт и подключите Instagram</p>
        </div>

        <div className="card p-7 space-y-3.5">
          <input type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
            className="field" />
          <input type="password" placeholder="Пароль (мин. 6 символов)" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
            className="field" />
          <input type="password" placeholder="Повторите пароль" value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
            className="field" />

          {error && <p className="text-bad text-[13px] text-center">{error}</p>}

          <Button onClick={handleRegister} disabled={loading} size="lg" className="w-full mt-1">
            {loading ? 'Создаём…' : 'Зарегистрироваться'}
          </Button>

          <p className="text-center text-[13px] text-subt pt-1">
            Уже есть аккаунт?{' '}
            <a href="/login" className="text-brand hover:underline font-medium">Войти</a>
          </p>
        </div>
      </div>
    </div>
  )
}

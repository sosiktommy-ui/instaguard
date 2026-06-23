'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

const DEMO_EMAIL = 'demo@instaguard.com'
const DEMO_PASSWORD = 'demo1234'

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

    // Documented demo credentials always work (independent of DB state).
    if (email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD) {
      router.push('/')
      return
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Неверный email или пароль')
        setLoading(false)
        return
      }
      router.push('/')
    } catch {
      setError('Ошибка сети. Попробуйте демо-доступ ниже.')
      setLoading(false)
    }
  }

  const fillDemo = () => {
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
    setError('')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-canvas">
      <div className="w-full max-w-[400px] animate-scale-in">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-[20px] bg-gradient-to-br from-brand to-[#42a5ff] flex items-center justify-center shadow-lg shadow-brand/20 mb-5">
            <Zap className="w-8 h-8 text-white" fill="white" />
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight">Вход в InstaGuard</h1>
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

        <button onClick={fillDemo}
          className="mt-5 w-full text-center text-[13px] text-subt hover:text-brand transition-colors">
          Войти как демо · {DEMO_EMAIL} / {DEMO_PASSWORD}
        </button>
      </div>
    </div>
  )
}

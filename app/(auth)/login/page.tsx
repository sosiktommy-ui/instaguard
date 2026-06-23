'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const router = useRouter()

  const handleLogin = async () => {
    if (!email || !password) { setError('Заполните все поля'); return }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Ошибка входа')
        return
      }

      router.push('/dashboard')
    } catch {
      setError('Ошибка сети')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleLogin()
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md p-10 glass rounded-3xl">
        <div className="flex justify-center mb-10">
          <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center">
            <span className="text-4xl font-bold text-black">I</span>
          </div>
        </div>

        <h1 className="text-4xl font-semibold tracking-tighter text-center mb-2">
          Вход в InstaGuard
        </h1>
        <p className="text-center text-zinc-500 mb-10">Премиум управление Instagram</p>

        <div className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-5 focus:outline-none focus:border-white/30 transition-colors"
          />
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-5 focus:outline-none focus:border-white/30 transition-colors"
          />

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <Button
            onClick={handleLogin}
            disabled={loading}
            size="lg"
            className="w-full py-7 text-lg mt-2"
          >
            {loading ? 'Вход...' : 'Войти'}
          </Button>
        </div>

        <p className="text-center text-xs text-zinc-600 mt-8">
          demo@instaguard.com / demo1234
        </p>
      </div>
    </div>
  )
}

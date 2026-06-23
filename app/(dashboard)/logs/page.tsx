'use client'

import { useState, useEffect } from 'react'
import { Clock, CheckCircle, AlertCircle } from 'lucide-react'

interface LogEntry {
  id: string
  timestamp: string
  account: string
  type: 'SEND_DM' | 'NEW_FOLLOWER' | 'ERROR' | 'SUCCESS'
  message: string
  status: 'success' | 'error' | 'info'
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: '1',
      timestamp: new Date().toISOString(),
      account: '@premium.brand',
      type: 'SEND_DM',
      message: 'Отправлено приветствие новому подписчику @user123',
      status: 'success',
    },
    {
      id: '2',
      timestamp: new Date(Date.now() - 1000 * 180).toISOString(),
      account: '@helper_parse',
      type: 'NEW_FOLLOWER',
      message: 'Обнаружен новый подписчик',
      status: 'info',
    },
    {
      id: '3',
      timestamp: new Date(Date.now() - 1000 * 420).toISOString(),
      account: '@premium.brand',
      type: 'ERROR',
      message: 'Instagram rate limit detected. Пауза 180 сек',
      status: 'error',
    },
  ])

  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        setLogs((prev) => [
          {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            account: '@premium.brand',
            type: 'SEND_DM',
            message: 'Отправлено follow-up сообщение',
            status: 'success',
          },
          ...prev,
        ].slice(0, 20))
      }
    }, 4500)
    return () => clearInterval(interval)
  }, [])

  const getStatusIcon = (status: string) => {
    if (status === 'success') return <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
    if (status === 'error')   return <AlertCircle  className="w-5 h-5 text-red-500 shrink-0" />
    return <Clock className="w-5 h-5 text-zinc-500 shrink-0" />
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-5xl font-semibold tracking-tighter">Журнал действий</h1>
        <p className="text-zinc-500 mt-3">Реальное время • Последние события</p>
      </div>

      <div className="glass rounded-3xl overflow-hidden">
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          {logs.map((log, index) => (
            <div
              key={log.id}
              className="border-b border-zinc-800 px-10 py-6 hover:bg-zinc-900/50 flex gap-6 items-start group"
            >
              <div className="mt-0.5">{getStatusIcon(log.status)}</div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-4 text-sm">
                  <span className="font-mono text-zinc-500">
                    {new Date(log.timestamp).toLocaleTimeString('ru-RU')}
                  </span>
                  <span className="text-white font-medium">{log.account}</span>
                  <span className="px-2.5 py-0.5 text-[10px] bg-zinc-800 rounded font-mono tracking-widest">
                    {log.type}
                  </span>
                </div>
                <p className="mt-2 text-zinc-300 leading-snug">{log.message}</p>
              </div>

              <div className="text-xs text-zinc-500 opacity-0 group-hover:opacity-100 transition-all font-mono shrink-0">
                #{String(index + 1).padStart(3, '0')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

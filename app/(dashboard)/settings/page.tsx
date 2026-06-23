'use client'

import { useState } from 'react'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    globalHourlyLimit: 180,
    globalDailyLimit: 1200,
    defaultDelayMin: 45,
    defaultDelayMax: 180,
    proxyEnabled: true,
    notifications: true,
    autoPauseOnChallenge: true,
  })

  const handleSave = () => {
    alert('Настройки сохранены (демо)')
  }

  return (
    <div className="max-w-3xl space-y-12">
      <div>
        <h1 className="text-5xl font-semibold tracking-tighter">Настройки</h1>
        <p className="text-zinc-500 mt-3">Глобальные параметры и безопасность</p>
      </div>

      <div className="space-y-10">
        {/* Лимиты */}
        <div className="glass rounded-3xl p-10">
          <h2 className="text-2xl font-semibold mb-8">Лимиты отправки</h2>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <label className="text-sm text-zinc-500 block mb-2">Лимит в час</label>
              <input
                type="number"
                value={settings.globalHourlyLimit}
                onChange={(e) => setSettings({ ...settings, globalHourlyLimit: parseInt(e.target.value) })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-xl focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="text-sm text-zinc-500 block mb-2">Лимит в день</label>
              <input
                type="number"
                value={settings.globalDailyLimit}
                onChange={(e) => setSettings({ ...settings, globalDailyLimit: parseInt(e.target.value) })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-xl focus:outline-none focus:border-white/30"
              />
            </div>
          </div>
        </div>

        {/* Задержки */}
        <div className="glass rounded-3xl p-10">
          <h2 className="text-2xl font-semibold mb-8">Рандомные задержки</h2>
          <div className="flex gap-8">
            <div className="flex-1">
              <label className="text-sm text-zinc-500 block mb-2">Минимум (секунды)</label>
              <input
                type="number"
                value={settings.defaultDelayMin}
                onChange={(e) => setSettings({ ...settings, defaultDelayMin: parseInt(e.target.value) })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-xl focus:outline-none focus:border-white/30"
              />
            </div>
            <div className="flex-1">
              <label className="text-sm text-zinc-500 block mb-2">Максимум (секунды)</label>
              <input
                type="number"
                value={settings.defaultDelayMax}
                onChange={(e) => setSettings({ ...settings, defaultDelayMax: parseInt(e.target.value) })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-4 text-xl focus:outline-none focus:border-white/30"
              />
            </div>
          </div>
        </div>

        {/* Безопасность */}
        <div className="glass rounded-3xl p-10 space-y-8">
          <h2 className="text-2xl font-semibold mb-2">Безопасность</h2>
          {[
            { key: 'proxyEnabled',           label: 'Включить прокси',          desc: 'Для всех аккаунтов' },
            { key: 'autoPauseOnChallenge',   label: 'Автопауза при Challenge',   desc: 'При блокировках Instagram' },
            { key: 'notifications',          label: 'Уведомления',              desc: 'Telegram / Email' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex justify-between items-center">
              <div>
                <div className="font-medium">{label}</div>
                <div className="text-sm text-zinc-500">{desc}</div>
              </div>
              <input
                type="checkbox"
                checked={settings[key as keyof typeof settings] as boolean}
                onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                className="w-6 h-6 accent-white cursor-pointer"
              />
            </div>
          ))}
        </div>
      </div>

      <Button onClick={handleSave} size="lg" className="w-full rounded-2xl py-7 text-lg">
        <Save className="mr-3 w-5 h-5" />
        Сохранить настройки
      </Button>
    </div>
  )
}

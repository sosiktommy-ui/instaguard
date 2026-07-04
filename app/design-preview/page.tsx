'use client'
// ВРЕМЕННАЯ страница для визуальной проверки дизайна — будет удалена.
import { Users, BarChart3, Globe, Layers, Settings as SettingsIcon, Send, CheckCircle2, AlertCircle, Zap, Eye, ShieldAlert, HelpCircle } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { IconTile } from '@/components/common/IconTile'
import { ReactiveMascot } from '@/components/common/ReactiveMascot'
import { TONE } from '@/lib/colors'

export default function Preview() {
  return (
    <div className="min-h-screen bg-canvas p-8 space-y-8">
      <PageHeader icon={BarChart3} color={TONE.warn} title="Статистика" subtitle="Сводка по всем аккаунтам и кампаниям" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Users} color={TONE.brand} value={12} label="Аккаунтов" delay={0} />
        <StatCard icon={Eye} color={TONE.alt} value={"1.2K"} label="Подписчиков" tip="пример" delay={60} />
        <StatCard icon={Zap} color={TONE.warn} value={5} label="Активных кампаний" delay={120} />
        <StatCard icon={Send} color={TONE.pink} value={348} label="Сработало" delay={180} />
        <StatCard icon={CheckCircle2} color={TONE.ok} value={290} label="Выполнено" delay={240} />
        <StatCard icon={AlertCircle} color={TONE.bad} value={2} label="Ошибок" delay={300} />
      </div>

      <PageHeader icon={SettingsIcon} color={TONE.brand} title="Настройки" subtitle="Правила безопасности и автоматизации">
        <button className="h-10 px-5 rounded-full bg-brand text-white text-[15px] font-medium">Кнопка</button>
      </PageHeader>
      <div className="max-w-2xl space-y-6">
        <div className="card card-3d gloss p-5 flex items-start gap-4">
          <IconTile icon={ShieldAlert} color={TONE.warn} size={40} />
          <div className="flex-1">
            <div className="font-semibold text-[15px]">Работать без прокси</div>
            <div className="text-[13px] text-subt mt-1 leading-relaxed">Пример строки настройки с объёмной иконкой.</div>
          </div>
        </div>
        <div className="card card-3d gloss p-5 flex items-center gap-3.5">
          <IconTile icon={HelpCircle} color={TONE.alt} size={40} />
          <div className="font-semibold text-[15px]">Что где находится</div>
        </div>
      </div>

      <div className="w-[280px] bg-white rounded-2xl border border-black/[0.06] p-3">
        <button className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[15px] font-medium text-subt hover:bg-brand/[0.06] hover:text-brand transition-all">
          <ReactiveMascot size={30} animated={false} className="shrink-0 -my-0.5" />
          <span className="flex-1 text-left">Обучение Reactive</span>
        </button>
      </div>
    </div>
  )
}

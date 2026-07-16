'use client'

import { useEffect, useState, useCallback } from 'react'
import { Users, Zap, Send, AlertCircle, Eye, CheckCircle2, Info, RefreshCw, BarChart3, Cpu, Radar, ShieldCheck } from 'lucide-react'
import { formatFollowers } from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { cn } from '@/lib/utils'
import { readStat, ACTION_KEYS } from '@/lib/stats'
import { humanizeLog, isDiagnostic } from '@/lib/logText'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { IconTile } from '@/components/common/IconTile'
import { CampaignMatrix } from '@/components/stats/CampaignMatrix'
import { FleetSafety } from '@/components/stats/FleetSafety'
import { Chart3D } from '@/components/stats/Chart3D'
import { TONE } from '@/lib/colors'

interface DbAccount { id: string; username: string; status: string; errorCount?: number; followerCount?: number; followers?: number | null; role?: string | null; limits?: unknown; proxy?: string | null; hasSession?: boolean | null; lastChecked?: string | null; createdAt?: string | null }
interface DbTrigger { id: string; name?: string; triggerType: string; isActive: boolean; fireCount?: number; stats?: any; actions?: any[]; responder?: { id: string; username: string } | null }
interface DbLog { id: string; level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS'; message: string; createdAt: string; account?: { username?: string } }

const DB_TYPE_LABELS: Record<string, string> = {
  NEW_FOLLOWER: 'Новая подписка',
  NEW_COMMENT: 'Комментарий',
  NEW_LIKE: 'Лайк',
  STORY_MENTION: 'Ответ на сторис',
}

function logIcon(level: DbLog['level']) {
  if (level === 'SUCCESS') return <CheckCircle2 className="w-4 h-4 text-ok shrink-0" />
  if (level === 'ERROR') return <AlertCircle className="w-4 h-4 text-bad shrink-0" />
  if (level === 'WARN') return <AlertCircle className="w-4 h-4 text-warn shrink-0" />
  return <Info className="w-4 h-4 text-subt shrink-0" />
}

function Stats() {
  const [accounts, setAccounts] = useState<DbAccount[]>([])
  const [triggers, setTriggers] = useState<DbTrigger[]>([])
  const [logs, setLogs] = useState<DbLog[]>([])
  const [loading, setLoading] = useState(true)
  const [bh, setBh] = useState<any>(null)   // здоровье браузерного воркера
  const [sh, setSh] = useState<any>(null)   // здоровье скрейпер-API
  const [st, setSt] = useState<any>(null)   // антидетект self-test (§11.2)
  const [stRun, setStRun] = useState(false)

  const runSelfTest = useCallback(async () => {
    setStRun(true); setSt(null)
    try {
      const r = await fetch('/api/selftest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      setSt(await r.json())
    } catch (e: any) {
      setSt({ error: e?.message ?? 'ошибка сети' })
    }
    setStRun(false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, t, l] = await Promise.all([fetch('/api/accounts'), fetch('/api/triggers'), fetch('/api/logs')])
      if (a.ok) setAccounts(await a.json())
      if (t.ok) setTriggers(await t.json())
      if (l.ok) setLogs(await l.json())
    } catch {}
    setLoading(false)
    // Здоровье автоматизации — не блокирует страницу (браузер-тест поднимает Chromium).
    fetch('/api/browser-health?test=1').then((r) => (r.ok ? r.json() : null)).then(setBh).catch(() => setBh({ configured: false }))
    fetch('/api/scraper-health?test=1').then((r) => (r.ok ? r.json() : null)).then(setSh).catch(() => setSh(null))
  }, [])

  useEffect(() => { load() }, [load])

  // Единый источник подписчиков (как на других экранах): реальные followers, иначе отслеженные
  const followersOf = (a: DbAccount) => a.followers ?? a.followerCount ?? 0
  const totalReach = accounts.reduce((s, a) => s + followersOf(a), 0)
  const totalRuns = triggers.reduce((s, t) => s + (t.fireCount ?? 0), 0)
  const totalDone = triggers.reduce((s, t) => s + ACTION_KEYS.reduce((ss, k) => ss + readStat(t.stats, k).done, 0), 0)
  const totalErrors = accounts.reduce((s, a) => s + (a.errorCount ?? 0), 0)
  const activeCampaigns = triggers.filter((t) => t.isActive).length

  const byType = Object.keys(DB_TYPE_LABELS).map((t) => ({
    type: t,
    label: DB_TYPE_LABELS[t],
    runs: triggers.filter((x) => x.triggerType === t).reduce((s, x) => s + (x.fireCount ?? 0), 0),
  }))
  const maxRuns = Math.max(1, ...byType.map((b) => b.runs))
  const topAccounts = [...accounts].sort((a, b) => followersOf(b) - followersOf(a)).slice(0, 5)

  // Данные для 3D-диаграммы (§13.13). Порядок массивов синхронизирован с public/stats3d/index.html:
  // campaigns = порядок DB_TYPE_LABELS; actions = порядок ACTION_KEYS [dm,like,follow,story,comment].
  const runsOf = (a: DbAccount) => triggers.filter((t) => t.responder?.id === a.id).reduce((s, t) => s + (t.fireCount ?? 0), 0)
  const chart3dData = {
    campaigns: byType.map((b) => b.runs),
    actions: ACTION_KEYS.map((k) => triggers.reduce((s, t) => s + readStat(t.stats, k).done, 0)),
    accounts: [...accounts]
      .map((a) => ({ label: `@${a.username}`, value: runsOf(a) }))
      .sort((x, y) => y.value - x.value)
      .slice(0, 6),
  }

  const cards = [
    { icon: Users, label: 'Аккаунтов', value: accounts.length, color: TONE.brand },
    { icon: Eye, label: 'Подписчиков', value: formatFollowers(totalReach), color: TONE.alt, tip: 'Сумма подписчиков по всем аккаунтам (реальное число из Instagram, если известно, иначе — по последнему отслеженному значению).' },
    { icon: Zap, label: 'Активных кампаний', value: activeCampaigns, color: TONE.warn, tip: 'Кампании со статусом «Вкл» прямо сейчас (из всех созданных, включая поставленные на паузу).' },
    { icon: Send, label: 'Сработало', value: totalRuns, color: TONE.pink, tip: 'Сколько раз кампании поймали событие (новый подписчик/комментарий/лайк/сторис) — попыток, а не обязательно успешных действий.' },
    { icon: CheckCircle2, label: 'Выполнено действий', value: totalDone, color: TONE.ok, tip: 'Сколько действий (DM, лайк, подписка, сторис, коммент) реально выполнилось. Может быть меньше «Сработало» — например, если личка закрыта или не прошла проверка подписки.' },
    { icon: AlertCircle, label: 'Ошибок', value: totalErrors, color: TONE.bad, tip: 'Ошибки подряд по аккаунтам (сбрасываются при успешной проверке). Много ошибок — повод проверить прокси или сессию аккаунта.' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader icon={BarChart3} color={TONE.warn} title="Статистика" subtitle="Сводка по всем аккаунтам и кампаниям" tourId="page">
        <button onClick={load} className="p-2 text-subt hover:text-ink transition-colors" title="Обновить">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(({ icon, label, value, color, tip }, i) => (
          <StatCard key={label} icon={icon} color={color} value={value} label={label} tip={tip} delay={i * 60} />
        ))}
      </div>

      {/* §13.4 — Ban-safety Score наружу: живой светофор защиты флота от бана */}
      <FleetSafety accounts={accounts} triggers={triggers} />

      {/* 3D-диаграмма срабатываний по типу кампании (§13.13). Ниже — тот же срез плоскими барами
          (всегда читаемые числа + запасной вид, если WebGPU/WebGL недоступны). */}
      <div className="card card-3d rise overflow-hidden p-0">
        <Chart3D data={chart3dData} height={460} />
      </div>

      {/* Здоровье автоматизации: браузерный воркер (эмуль, вход/действия/детект self-events) +
          HikerAPI — опциональная метрика числа подписчиков (НЕ детект; детект = self-events). */}
      <div className="card card-3d gloss p-6">
        <div className="font-semibold text-[15px] mb-4">Здоровье автоматизации</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-line/50 p-4 flex items-start gap-3">
            <IconTile icon={Cpu} color={TONE.brand} size={36} />
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium">Браузерный воркер (эмуль)</div>
              {(() => {
                if (!bh) return <div className="text-[12px] text-subt mt-0.5">проверяю…</div>
                if (bh.configured === false) return <div className="text-[12px] text-subt mt-0.5 leading-snug">⚪ не подключён — вход через legacy (задайте <code className="font-mono">BROWSER_WORKER_URL</code>)</div>
                if (bh.ok) return (
                  <div className="text-[12px] text-ok mt-0.5 leading-snug">
                    ✅ работает<span className="text-subt"> · Chromium {String(bh.chromium ?? '').split('.')[0] || '?'} · занято {bh.active ?? 0}/{bh.concurrency ?? '?'} · build {bh.build}</span>
                  </div>
                )
                return <div className="text-[12px] text-bad mt-0.5 leading-snug">🔴 не отвечает{bh.error ? `: ${bh.error}` : ''}</div>
              })()}
            </div>
          </div>
          <div className="rounded-2xl border border-line/50 p-4 flex items-start gap-3">
            <IconTile icon={Radar} color={TONE.pink} size={36} />
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium">Число подписчиков (API)</div>
              {(() => {
                if (!sh) return <div className="text-[12px] text-subt mt-0.5">проверяю…</div>
                if (sh.configured === false) return <div className="text-[12px] text-subt mt-0.5 leading-snug">⚪ не задан (<code className="font-mono">HIKER_API_KEY</code>) — на детект не влияет, скрыт лишь счётчик подписчиков</div>
                if (sh.ok || sh.alive) return <div className="text-[12px] text-ok mt-0.5">✅ работает</div>
                if (sh.configured) return <div className="text-[12px] text-bad mt-0.5 leading-snug">🔴 ошибка связи{sh.error ? `: ${sh.error}` : ''}</div>
                return <div className="text-[12px] text-subt mt-0.5">статус неизвестен</div>
              })()}
            </div>
          </div>
        </div>

        {/* Антидетект self-test (§11.2): «0 сигналов бота» через рабочий прокси */}
        <div className="mt-3 rounded-2xl border border-line/50 p-4">
          <div className="flex items-start gap-3">
            <IconTile icon={ShieldCheck} color={TONE.ok} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-[13.5px] font-medium">Антидетект-приёмка (сигналы бота)</div>
                <button onClick={runSelfTest} disabled={stRun}
                  className="text-[12px] font-medium px-2.5 py-1 rounded-lg bg-brand/10 text-brand hover:bg-brand/20 transition-colors disabled:opacity-50">
                  {stRun ? 'Проверяю… (до ~30с)' : 'Запустить тест'}
                </button>
              </div>
              <div className="text-[12px] text-subt mt-0.5 leading-snug">
                Поднимает браузер через рабочий прокси из пула и считает сигналы бота (WebGL, UA-платформа, WebRTC-утечка). Instagram не трогается — безопасно.
              </div>

              {st && (
                <div className="mt-3 text-[12px] leading-relaxed">
                  {st.error ? (
                    <div className="text-bad">🔴 {st.error}</div>
                  ) : (
                    <>
                      <div className={cn('text-[15px] font-semibold', (st.redCount ?? 1) === 0 ? 'text-ok' : 'text-bad')}>
                        {(st.redCount ?? 1) === 0 ? '✅ 0 сигналов бота — чисто' : `🔴 ${st.redCount} сигнал(ов) бота`}
                      </div>
                      {Array.isArray(st.red) && st.red.length > 0 && (
                        <ul className="mt-1 list-disc list-inside text-bad space-y-0.5">
                          {st.red.map((r: string, i: number) => <li key={i}>{r}</li>)}
                        </ul>
                      )}
                      {Array.isArray(st.warnings) && st.warnings.length > 0 && (
                        <ul className="mt-1 list-disc list-inside text-warn space-y-0.5">
                          {st.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                        </ul>
                      )}
                      <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-subt font-mono text-[11px]">
                        {st.exit && <div>exit-IP: {st.exit.ip ?? '?'} · {st.exit.country ?? '?'}</div>}
                        <div>прокси: {st.proxyUsed}{st.proxyAuto ? ' (авто)' : ''}</div>
                        {st.expected?.platform && <div>platform: {st.expected.platform} / UA: {st.expected.uaPlatform}</div>}
                        {st.expected?.locale && <div>locale/tz: {st.expected.locale} · {st.expected.timezoneId}</div>}
                        {st.expected?.glRenderer && <div className="sm:col-span-2 truncate">WebGL: {st.expected.glRenderer}</div>}
                        {Array.isArray(st.webrtcLeaks) && <div>WebRTC утечки: {st.webrtcLeaks.length === 0 ? 'нет ✅' : st.webrtcLeaks.join(', ')}</div>}
                        {st.build && <div>build: {st.build}</div>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card card-3d gloss p-6">
          <div className="font-semibold text-[15px] mb-5">Срабатывания по типу — числа</div>
          <div className="space-y-4">
            {byType.map((b) => (
              <div key={b.type}>
                <div className="flex justify-between text-[13px] mb-1.5">
                  <span className="text-ink/80">{b.label}</span>
                  <span className="font-semibold tabular-nums">{b.runs.toLocaleString('ru')}</span>
                </div>
                <div className="h-2.5 rounded-full bg-black/[0.05] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-brand to-[#42a5ff] transition-all"
                    style={{ width: `${(b.runs / maxRuns) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-3d gloss p-6">
          <div className="font-semibold text-[15px] mb-5">Топ аккаунтов по подписчикам</div>
          <div className="space-y-3">
            {topAccounts.map((a, i) => (
              <div key={a.id} className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-subt w-4">{i + 1}</span>
                <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold shrink-0">
                  {(a.username?.[0] ?? '?').toUpperCase()}
                </span>
                <span className="font-medium text-[14px] flex-1 truncate">@{a.username}</span>
                <span className="text-[13px] text-subt tabular-nums">{formatFollowers(followersOf(a))}</span>
              </div>
            ))}
            {topAccounts.length === 0 && <div className="py-6 text-center text-subt text-[13px]">Нет данных</div>}
          </div>
        </div>
      </div>

      <div className="card card-3d gloss p-6">
        <div className="font-semibold text-[15px] mb-4">Матрица выполнений</div>
        <CampaignMatrix triggers={triggers} accounts={accounts} />
      </div>

      <div className="card card-3d gloss p-6">
        <div className="font-semibold text-[15px] mb-4">Журнал событий</div>
        <div className="space-y-1">
          {logs.length === 0 && <div className="py-6 text-center text-subt text-[13px]">Пусто</div>}
          {logs.filter((l) => !isDiagnostic(l.message)).slice(0, 12).map((l) => (
            <div key={l.id} className="flex items-center gap-3 py-2.5 border-b border-black/[0.04] last:border-0">
              {logIcon(l.level)}
              <span className="text-[13px] text-ink/80 truncate flex-1">{humanizeLog(l.message)}</span>
              <span className="text-[12px] text-subt shrink-0">@{l.account?.username ?? '—'}</span>
              <span className="text-[11px] text-subt shrink-0 w-12 text-right tabular-nums">
                {new Date(l.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  return <ClientOnly><Stats /></ClientOnly>
}

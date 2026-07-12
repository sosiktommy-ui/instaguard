'use client'

import { useMemo } from 'react'
import { ShieldCheck, ShieldAlert, ShieldX, Wifi, KeyRound, AlertTriangle, Ban, Clock, Gauge, Activity, type LucideIcon } from 'lucide-react'
import { securityIndex } from '@/lib/safety'
import { IconTile } from '@/components/common/IconTile'
import { TONE, hexA, darken } from '@/lib/colors'

// §13.4 — «Ban-safety Score наружу»: индекс безопасности (lib/safety.ts) вынесен ЖИВЫМ
// светофором для всего флота. Показывает средний балл + разбивку по зонам + КОНКРЕТНО, что
// снижает безопасность (агрегировано по аккаунтам) — чтобы владелец видел, что чинить.
// Оформление — в едином 3D-языке с диаграммой/матрицей (card-3d, gloss, IconTile, пилюли).

export interface SafeAccount {
  id: string
  username: string
  status?: string | null
  errorCount?: number | null
  limits?: unknown
  proxy?: string | null
  hasSession?: boolean | null
  lastChecked?: string | Date | null
  createdAt?: string | Date | null
  role?: string | null
}
export interface SafeTrigger { fireCount?: number; responder?: { id: string } | null }

// Категоризация факторов риска в понятные группы (факторы несут числа — группируем по смыслу).
function riskCategory(label: string): { key: string; text: string; Icon: LucideIcon } {
  const l = label.toLowerCase()
  if (l.includes('заблокир')) return { key: 'blocked', text: 'Заблокирован Instagram', Icon: Ban }
  if (l.includes('challenge') || l.includes('подтвержд')) return { key: 'challenge', text: 'Нужно подтверждение входа', Icon: ShieldAlert }
  if (l.includes('паузе')) return { key: 'paused', text: 'На паузе', Icon: Clock }
  if (l.includes('сесси')) return { key: 'session', text: 'Нет активной сессии', Icon: KeyRound }
  if (l.includes('прокси')) return { key: 'proxy', text: 'Без прокси', Icon: Wifi }
  if (l.includes('ошибок')) return { key: 'errors', text: 'Ошибки подряд', Icon: AlertTriangle }
  if (l.includes('лимит')) return { key: 'limit', text: 'Дневной лимит близко к потолку', Icon: Gauge }
  if (l.includes('спам') || l.includes('срабатыван')) return { key: 'rate', text: 'Слишком частые срабатывания', Icon: Activity }
  if (l.includes('проверял')) return { key: 'stale', text: 'Давно не проверялся', Icon: Clock }
  return { key: 'other:' + l.slice(0, 24), text: label, Icon: AlertTriangle }
}

const zoneOf = (score: number) => score >= 80 ? 'safe' : score >= 60 ? 'norm' : score >= 35 ? 'risk' : 'danger'
const ZONE_META: Record<string, { label: string; color: string }> = {
  safe: { label: 'Защищён', color: TONE.ok },
  norm: { label: 'Норма', color: '#7bb84a' },
  risk: { label: 'Риск', color: TONE.warn },
  danger: { label: 'Опасно', color: TONE.bad },
}

export function FleetSafety({ accounts, triggers }: { accounts: SafeAccount[]; triggers: SafeTrigger[] }) {
  const model = useMemo(() => {
    const firesByAcc = new Map<string, number>()
    for (const t of triggers) {
      const id = t.responder?.id
      if (id) firesByAcc.set(id, (firesByAcc.get(id) ?? 0) + (t.fireCount ?? 0))
    }
    const rows = accounts.map((a) => {
      const sec = securityIndex(a, { totalFires: firesByAcc.get(a.id) ?? 0 })
      return { a, sec, zone: zoneOf(sec.score) }
    }).sort((x, y) => x.sec.score - y.sec.score) // самые рискованные сверху

    const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.sec.score, 0) / rows.length) : 100
    const zoneCounts = { safe: 0, norm: 0, risk: 0, danger: 0 } as Record<string, number>
    rows.forEach((r) => { zoneCounts[r.zone]++ })

    // Агрегируем факторы риска: категория → сколько аккаунтов задето + суммарный вес
    const riskMap = new Map<string, { text: string; Icon: LucideIcon; count: number; weight: number }>()
    rows.forEach((r) => {
      const seen = new Set<string>()
      r.sec.factors.filter((f) => !f.ok).forEach((f) => {
        const cat = riskCategory(f.label)
        if (seen.has(cat.key)) return // один аккаунт по одной категории считается один раз
        seen.add(cat.key)
        const cur = riskMap.get(cat.key) ?? { text: cat.text, Icon: cat.Icon, count: 0, weight: 0 }
        cur.count++; cur.weight += f.delta
        riskMap.set(cat.key, cur)
      })
    })
    const risks = [...riskMap.values()].sort((a, b) => b.weight - a.weight).slice(0, 5)

    return { rows, avg, zoneCounts, risks }
  }, [accounts, triggers])

  if (!model.rows.length) {
    return (
      <div className="card card-3d gloss p-6">
        <div className="font-semibold text-[15px] mb-1">Безопасность флота</div>
        <div className="text-subt text-[13px]">Пока нет аккаунтов — добавьте аккаунт, чтобы видеть индекс защиты от бана.</div>
      </div>
    )
  }

  const { avg, zoneCounts, risks, rows } = model
  const avgZone = zoneOf(avg)
  const avgColor = ZONE_META[avgZone].color
  const AvgIcon = avgZone === 'safe' ? ShieldCheck : avgZone === 'danger' ? ShieldX : ShieldAlert
  const atRisk = zoneCounts.risk + zoneCounts.danger

  return (
    <div className="card card-3d gloss p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className="font-semibold text-[15px]">Безопасность флота</div>
        <span className="text-[12px] text-subt">— защита аккаунтов от бана прямо сейчас</span>
      </div>

      <div className="grid lg:grid-cols-[auto_1fr] gap-6 items-start">
        {/* Светофор: средний балл флота */}
        <div className="flex items-center gap-4">
          <SafetyDial score={avg} color={avgColor} Icon={AvgIcon} />
          <div>
            <div className="text-[22px] font-bold leading-none" style={{ color: avgColor }}>{ZONE_META[avgZone].label}</div>
            <div className="text-[12px] text-subt mt-1">средний индекс по {rows.length} акк.</div>
            {atRisk > 0
              ? <div className="text-[12px] mt-2 font-medium" style={{ color: TONE.warn }}>⚠ {atRisk} в зоне риска</div>
              : <div className="text-[12px] mt-2 font-medium" style={{ color: TONE.ok }}>✓ все в безопасной зоне</div>}
          </div>
        </div>

        <div className="min-w-0">
          {/* Разбивка по зонам */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(['safe', 'norm', 'risk', 'danger'] as const).map((z) => (
              <ZonePill key={z} color={ZONE_META[z].color} label={ZONE_META[z].label} count={zoneCounts[z]} dim={zoneCounts[z] === 0} />
            ))}
          </div>

          {/* Что снижает безопасность */}
          {risks.length > 0 ? (
            <div>
              <div className="text-[12px] font-semibold text-ink/70 mb-2">Что снижает безопасность</div>
              <div className="flex flex-wrap gap-2">
                {risks.map((r, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 rounded-lg pl-2 pr-2.5 py-1 text-[12px] font-medium"
                    style={{ color: '#8a4b00', background: hexA(TONE.warn, 0.13), boxShadow: `inset 0 0 0 1px ${hexA(TONE.warn, 0.28)}` }}>
                    <r.Icon className="w-3.5 h-3.5" />{r.text}
                    <span className="ml-0.5 rounded-md px-1.5 text-[11px] font-bold tabular-nums"
                      style={{ color: '#fff', background: `linear-gradient(145deg, ${TONE.warn}, ${darken(TONE.warn)})` }}>{r.count}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-ok font-medium">Факторов риска не обнаружено — лимиты, прокси и сессии в порядке.</div>
          )}

          {/* Самые рискованные аккаунты */}
          {rows.some((r) => r.zone === 'risk' || r.zone === 'danger') && (
            <div className="mt-4">
              <div className="text-[12px] font-semibold text-ink/70 mb-2">Требуют внимания</div>
              <div className="flex flex-col gap-1.5">
                {rows.filter((r) => r.zone === 'risk' || r.zone === 'danger').slice(0, 4).map((r) => (
                  <div key={r.a.id} className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                      style={{ boxShadow: '0 2px 6px rgba(214,41,118,0.4), inset 0 1px 1px rgba(255,255,255,0.5)' }}>
                      {(r.a.username?.[0] ?? '?').toUpperCase()}
                    </span>
                    <span className="text-[13px] font-medium truncate max-w-[160px]">@{r.a.username}</span>
                    <ScoreChip score={r.sec.score} color={ZONE_META[r.zone].color} />
                    <span className="text-[11.5px] text-subt truncate">{r.sec.factors.find((f) => !f.ok)?.label ?? ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Круговой «спидометр» индекса (SVG-кольцо) — объёмный, в тон 3D.
function SafetyDial({ score, color, Icon }: { score: number; color: string; Icon: LucideIcon }) {
  const R = 34, C = 2 * Math.PI * R
  const off = C * (1 - Math.max(0, Math.min(100, score)) / 100)
  return (
    <div className="relative shrink-0" style={{ width: 92, height: 92 }}>
      <svg width="92" height="92" viewBox="0 0 92 92" className="-rotate-90">
        <circle cx="46" cy="46" r={R} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="9" />
        <circle cx="46" cy="46" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <Icon className="w-4 h-4 mb-0.5" style={{ color }} />
        <span className="text-[20px] font-bold leading-none tabular-nums" style={{ color }}>{score}</span>
      </div>
    </div>
  )
}

function ZonePill({ color, label, count, dim }: { color: string; label: string; count: number; dim: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl pl-2.5 pr-3 py-1.5" style={{ background: dim ? 'rgba(0,0,0,0.03)' : hexA(color, 0.1) }}>
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: dim ? '#c4c4cc' : `linear-gradient(145deg, ${color}, ${darken(color)})`, boxShadow: dim ? 'none' : `0 1px 3px ${hexA(color, 0.5)}` }} />
      <span className="text-[12.5px] font-medium" style={{ color: dim ? '#9a9aa2' : '#333' }}>{label}</span>
      <span className="text-[13px] font-bold tabular-nums" style={{ color: dim ? '#b4b4bd' : color }}>{count}</span>
    </span>
  )
}

function ScoreChip({ score, color }: { score: number; color: string }) {
  return (
    <span className="inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums shrink-0"
      style={{ color, background: hexA(color, 0.14), boxShadow: `inset 0 0 0 1px ${hexA(color, 0.3)}` }}>{score}</span>
  )
}

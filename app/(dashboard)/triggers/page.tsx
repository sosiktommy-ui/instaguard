'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  Search, Check, Trash2, Users, Zap, Send, Filter,
  Heart, MessageCircle, UserPlus, Clapperboard, RefreshCw,
  Plus, ChevronDown, ChevronUp, ToggleLeft, ToggleRight,
  Link2, Bookmark, FileText, X, UserCheck, Eye,
  Image as ImageIcon, Sparkles, HelpCircle, ChevronRight, ArrowLeft, Settings, Power, PauseCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/Tooltip'
import { TriggerType } from '@/lib/store'
import ClientOnly from '@/components/common/ClientOnly'
import { AddAccountModal } from '@/components/accounts/AddAccountModal'
import { SectionBar, type SectionItem } from '@/components/accounts/SectionBar'
import { DraftsStatus } from '@/components/accounts/DraftsStatus'
import { SecurityBadge } from '@/components/accounts/SecurityBadge'
import { useBreadcrumbs } from '@/lib/breadcrumbs'
import { cn } from '@/lib/utils'
import { readStat } from '@/lib/stats'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'

// Маленькая «?»-подсказка
function Hint({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <HelpCircle className="w-3.5 h-3.5 text-subt/60 hover:text-brand transition-colors cursor-help" />
    </Tooltip>
  )
}

// ── Метаданные типов триггеров (цвет, иконка, подпись) ────────────────────────
const TRIG_META = [
  { key: 'FOLLOW',      db: 'NEW_FOLLOWER',  label: 'Новая подписка',  desc: 'Основной триггер — ответ новым подписчикам', Icon: UserPlus,      color: '#663af1', soon: false },
  { key: 'COMMENT',     db: 'NEW_COMMENT',   label: 'Комментарий',     desc: 'Реакция на комментарии под постами',         Icon: MessageCircle, color: '#34c759', soon: false },
  { key: 'LIKE',        db: 'NEW_LIKE',      label: 'Лайк',            desc: 'Реакция на лайки ваших постов',              Icon: Heart,         color: '#ff2d92', soon: false },
  { key: 'STORY_REPLY', db: 'STORY_MENTION', label: 'Ответ на сторис', desc: 'Ответы и упоминания в сторис',               Icon: Clapperboard,  color: '#ff9f0a', soon: false },
] as const

type MetaKey = typeof TRIG_META[number]['key']
const META_BY_KEY = Object.fromEntries(TRIG_META.map((m) => [m.key, m])) as Record<MetaKey, typeof TRIG_META[number]>
const META_BY_DB = Object.fromEntries(TRIG_META.map((m) => [m.db, m])) as Record<string, typeof TRIG_META[number]>

// ── Цветовые помощники для 3D-свечения ───────────────────────────────────────
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
function darken(hex: string, f = 0.8) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

// ── 3D-иконка триггера (горит цветом, если активна; серая, если нет) ──────────
function TrigBadge({ meta, active, size = 30, title, tip = true }: {
  meta: typeof TRIG_META[number]; active: boolean; size?: number; title?: string; tip?: boolean
}) {
  const Icon = meta.Icon
  const node = (
    <span
      className="rounded-xl flex items-center justify-center transition-transform duration-200 shrink-0 hover:scale-105"
      style={
        active
          ? {
              width: size, height: size,
              background: `linear-gradient(145deg, ${meta.color} 0%, ${darken(meta.color)} 100%)`,
              boxShadow: `0 4px 12px ${hexA(meta.color, 0.55)}, 0 1px 2px ${hexA(meta.color, 0.5)}, inset 0 1.5px 1.5px rgba(255,255,255,0.55), inset 0 -2px 4px ${hexA(darken(meta.color, 0.6), 0.5)}`,
              color: '#fff',
            }
          : {
              width: size, height: size,
              background: 'linear-gradient(145deg, rgba(0,0,0,0.045), rgba(0,0,0,0.075))',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06), inset 0 -1px 1px rgba(255,255,255,0.5)',
              color: '#b0b0b5',
            }
      }
    >
      <Icon style={{ width: size * 0.52, height: size * 0.52 }} />
    </span>
  )
  if (!tip) return node
  return (
    <Tooltip content={title ?? `${meta.label} — ${active ? 'включён для этого аккаунта' : 'выключен'}`}>
      {node}
    </Tooltip>
  )
}

// Плавный счётчик цифр
function useCountUp(value: number, dur = 900) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    let start: number | null = null
    const tick = (ts: number) => {
      if (start === null) start = ts
      const p = Math.min(1, (ts - start) / dur)
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, dur])
  return n
}

// Объёмная карточка статистики
function StatCard({ icon: Icon, color, value, label, tip, delay = 0 }: {
  icon: any; color: string; value: number; label: string; tip: string; delay?: number
}) {
  const n = useCountUp(value)
  return (
    <div className="card card-3d gloss rise px-5 py-4 flex items-center gap-3 relative overflow-hidden" style={{ animationDelay: `${delay}ms` }}>
      <div className="absolute right-3 top-3 z-10"><Hint text={tip} /></div>
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
        style={{ background: `linear-gradient(145deg, ${color}, ${darken(color)})`, boxShadow: `0 5px 16px ${hexA(color, 0.5)}, inset 0 1.5px 1px rgba(255,255,255,0.5), inset 0 -2px 4px ${hexA(darken(color, 0.6), 0.5)}` }}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <div className="text-[24px] font-semibold tracking-tighter leading-none tabular-nums">{n.toLocaleString('ru')}</div>
        <div className="text-[12px] text-subt mt-1">{label}</div>
      </div>
    </div>
  )
}

// ── Типы данных из БД ─────────────────────────────────────────────────────────
interface DbAccount {
  id: string
  username: string
  status: 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE'
  role?: string
  errorCount?: number
  followers?: number | null      // реальное число подписчиков
  followerCount?: number         // отслеживается в базе
  sectionId?: string | null      // раздел/подраздел (папка)
  limits?: unknown               // дневные счётчики (для индекса безопасности)
  proxy?: string | null          // прокси (для индекса безопасности)
}
interface DbTrigger {
  id: string
  name: string
  triggerType: string
  isActive: boolean
  fireCount: number
  stats?: Record<string, number | { fired: number; done: number }> | null   // счётчики по действиям (fired/done, легаси — число)
  actions: any[]
  conditions?: any
  createdAt: string
  responder: { id: string; username: string }
}

type PlateState = 'green' | 'blue' | 'red' | 'yellow'
function plateState(acc: DbAccount, activeCount: number): PlateState {
  if (acc.status === 'BLOCKED' || acc.status === 'CHALLENGE') return 'red'
  if ((acc.errorCount ?? 0) > 0) return 'yellow'
  if (acc.status === 'ACTIVE' && activeCount > 0) return 'green'
  return 'blue'
}
const PLATE_STYLE: Record<PlateState, string> = {
  green:  'border-ok/40 bg-ok/[0.06]',
  blue:   'border-brand/30 bg-brand/[0.05]',
  red:    'border-bad/40 bg-bad/[0.06]',
  yellow: 'border-warn/45 bg-warn/[0.07]',
}
const PLATE_DOT: Record<PlateState, string> = { green: 'bg-ok', blue: 'bg-brand', red: 'bg-bad', yellow: 'bg-warn' }
const PLATE_LABEL: Record<PlateState, string> = { green: 'Активно', blue: 'Готов', red: 'Проблема', yellow: 'Ошибки' }
const PLATE_TIP: Record<PlateState, string> = {
  green: 'Аккаунт активен, на нём есть включённые кампании — работает',
  blue: 'Аккаунт готов, но включённых кампаний пока нет',
  red: 'Проблема: бан, ограничение или нужен повторный вход в аккаунт',
  yellow: 'Были ошибки при выполнении действий — загляните в «Логи»',
}

// ── Черновик триггера (используется и для шаблонов) ───────────────────────────
type MatchMode = 'all' | 'specific'
type GateMode = 'followed_by' | 'mutual'

interface Draft {
  type: TriggerType
  // действия (подписка): DM / лайк поста / подписка в ответ
  actDM: boolean; actLike: boolean; actFollow: boolean
  // действия (комментарий): лайк коммента / ответ в комментариях
  actLikeComment: boolean; actCommentReply: boolean
  // сторис (общее для всех событий)
  actStories: boolean; storyView: boolean; storyLike: boolean
  // проверка подписки перед DM (комментарий/лайк/сторис)
  dmGate: boolean; dmGateMode: GateMode; cmtGateText: string
  name: string; message: string
  customOn: boolean
  linkOn: boolean; linkText: string; linkUrl: string
  image: string
  delayMin: number; delayMax: number
  // сигнал / сопоставление фраз (для комментария — общий; в подписке не используется)
  dmMatchMode: MatchMode; dmPhrases: string; dmExact: boolean
  commentReplies: string[]
}

const DEFAULT_DRAFT: Draft = {
  type: 'FOLLOW',
  actDM: true, actLike: false, actFollow: false,
  actLikeComment: false, actCommentReply: false,
  actStories: false, storyView: true, storyLike: false,
  dmGate: false, dmGateMode: 'followed_by', cmtGateText: 'Подпишись, чтобы я смог написать тебе в директ 💌',
  name: '',
  message: 'Привет, @{{username}}! Вижу, ты заинтересован в наших мероприятиях. Скажи, чем могу помочь? 🙌',
  customOn: false,
  linkOn: false, linkText: '', linkUrl: '',
  image: '',
  delayMin: 45, delayMax: 180,
  dmMatchMode: 'all', dmPhrases: '', dmExact: false,
  commentReplies: ['', '', '', '', ''],
}

function splitPhrases(s: string): string[] {
  return s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)
}
function buildSignal(d: Draft) {
  return { mode: d.dmMatchMode, phrases: splitPhrases(d.dmPhrases), exact: d.dmExact }
}

function buildActions(d: Draft): any[] {
  const actions: any[] = []
  const msg = () => ({
    type: 'SEND_MESSAGE', enabled: true, templates: [d.message],
    delayMin: d.delayMin, delayMax: d.delayMax,
    link: d.customOn && d.linkOn ? { enabled: true, text: d.linkText, url: d.linkUrl } : undefined,
    image: d.image ? { enabled: true, url: d.image } : undefined,
    // Гейт подписки: для комментария — с текстом-приглашением; для лайка/сторис — просто пропуск DM
    gate: d.dmGate ? { mode: d.dmGateMode, inviteText: d.type === 'COMMENT' ? d.cmtGateText : undefined } : undefined,
  })
  const stories = () => ({ type: 'VIEW_STORIES', enabled: true, like: d.storyLike })

  if (d.type === 'COMMENT') {
    if (d.actDM) actions.push(msg())
    if (d.actCommentReply) actions.push({ type: 'REPLY_COMMENT', enabled: true, replies: d.commentReplies.map((x) => x.trim()).filter(Boolean) })
    // «Лайк» в комментарии = зайти к автору и лайкнуть его посты
    if (d.actLikeComment) actions.push({ type: 'LIKE_MEDIA', enabled: true })
    if (d.actFollow) actions.push({ type: 'FOLLOW_BACK', enabled: true })
    if (d.actStories && (d.storyView || d.storyLike)) actions.push(stories())
    return actions
  }

  // FOLLOW / LIKE / STORY
  if (d.actDM) actions.push(msg())
  if (d.actLike) actions.push({ type: 'LIKE_MEDIA', enabled: true })
  if (d.actFollow) actions.push({ type: 'FOLLOW_BACK', enabled: true })
  if (d.actStories && (d.storyView || d.storyLike)) actions.push(stories())
  return actions
}

// Обратное преобразование: сохранённая кампания → черновик для формы (редактирование).
function draftFromTrigger(t: DbTrigger): Draft {
  const on = (a: any) => a && a.enabled !== false
  const acts = (t.actions ?? []) as any[]
  const type = (META_BY_DB[t.triggerType]?.key ?? 'FOLLOW') as TriggerType
  const isComment = type === 'COMMENT'
  const msg = acts.find((a) => a.type === 'SEND_MESSAGE' && on(a))
  const reply = acts.find((a) => a.type === 'REPLY_COMMENT' && on(a))
  const legacyGate = acts.find((a) => a.type === 'COMMENT_GATE' && on(a))
  const likeMedia = acts.some((a) => a.type === 'LIKE_MEDIA' && on(a))
  const follow = acts.some((a) => a.type === 'FOLLOW_BACK' && on(a))
  const story = acts.find((a) => a.type === 'VIEW_STORIES' && on(a))
  const gate = msg?.gate ?? (legacyGate ? { mode: 'followed_by', inviteText: legacyGate.text ?? '' } : null)
  const cond = (t.conditions ?? {}) as any
  const replies: string[] = (reply?.replies ?? []).filter(Boolean)
  while (replies.length < 5) replies.push('')

  return {
    ...DEFAULT_DRAFT,
    type,
    actDM: Boolean(msg),
    actLike: !isComment && likeMedia,
    actLikeComment: isComment && likeMedia,
    actFollow: follow,
    actCommentReply: Boolean(reply),
    actStories: Boolean(story),
    storyView: story ? true : DEFAULT_DRAFT.storyView,
    storyLike: Boolean(story?.like),
    dmGate: Boolean(gate),
    dmGateMode: (gate?.mode === 'mutual' ? 'mutual' : 'followed_by'),
    cmtGateText: gate?.inviteText || DEFAULT_DRAFT.cmtGateText,
    name: t.name,
    message: msg?.templates?.[0] ?? DEFAULT_DRAFT.message,
    customOn: Boolean(msg?.link?.enabled),
    linkOn: Boolean(msg?.link?.enabled),
    linkText: msg?.link?.text ?? '',
    linkUrl: msg?.link?.url ?? '',
    image: msg?.image?.enabled ? (msg.image.url ?? '') : '',
    delayMin: msg?.delayMin ?? DEFAULT_DRAFT.delayMin,
    delayMax: msg?.delayMax ?? DEFAULT_DRAFT.delayMax,
    dmMatchMode: cond.mode === 'specific' ? 'specific' : 'all',
    dmPhrases: Array.isArray(cond.phrases) ? cond.phrases.join('\n') : '',
    dmExact: Boolean(cond.exact),
    commentReplies: replies,
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Карточка существующего триггера
// ════════════════════════════════════════════════════════════════════════════
function TriggerCard({ trigger, onToggle, onDelete, index = 0 }: {
  trigger: DbTrigger; onToggle: () => void; onDelete: () => void; index?: number
}) {
  const meta = META_BY_DB[trigger.triggerType]
  const actions = trigger.actions ?? []
  const isOn = (a: any) => a && a.enabled !== false
  const msg = actions.find((a: any) => a.type === 'SEND_MESSAGE' && isOn(a))
  const reply = actions.find((a: any) => a.type === 'REPLY_COMMENT' && isOn(a))
  const hasLike = actions.some((a: any) => a.type === 'LIKE_MEDIA' && isOn(a))
  const hasLikeComment = actions.some((a: any) => a.type === 'LIKE_COMMENT' && isOn(a))
  const hasFollow = actions.some((a: any) => a.type === 'FOLLOW_BACK' && isOn(a))
  const hasGate = Boolean(msg?.gate) || actions.some((a: any) => a.type === 'COMMENT_GATE' && isOn(a))
  const storiesAct = actions.find((a: any) => a.type === 'VIEW_STORIES' && isOn(a))
  const isComment = trigger.triggerType === 'NEW_COMMENT'
  const sigSpecific = isComment && trigger.conditions?.mode === 'specific'
  const msgText: string = msg?.templates?.[0] ?? ''
  const delayMin: number = msg?.delayMin ?? 45
  const delayMax: number = msg?.delayMax ?? 180

  const badge = (color: string, Icon: any, label: string, tip?: string) => {
    const el = (
      <span className="text-[10.5px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1" style={{ background: hexA(color, 0.12), color }}>
        <Icon className="w-3 h-3" /> {label}
      </span>
    )
    return tip ? <Tooltip content={tip}>{el}</Tooltip> : el
  }

  return (
    <div className={cn('card card-3d rise p-4 flex flex-col gap-3 transition-all', !trigger.isActive && 'opacity-55')} style={{ animationDelay: `${index * 70}ms` }}>
      <div className="flex items-start gap-3">
        {meta
          ? <TrigBadge meta={meta} active={trigger.isActive} size={40} />
          : <div className="w-10 h-10 rounded-xl bg-black/5 flex items-center justify-center"><Zap className="w-5 h-5 text-subt" /></div>}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14px] truncate">{trigger.name}</div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: hexA(meta?.color ?? '#888', 0.12), color: meta?.color ?? '#888' }}>
              {meta?.label ?? trigger.triggerType}
            </span>
            <span className="text-[11px] text-subt">@{trigger.responder.username}</span>
          </div>
        </div>
        <button onClick={onToggle} className={cn(
          'flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-xl shrink-0 transition-colors',
          trigger.isActive ? 'bg-ok/10 text-ok hover:bg-ok/20' : 'bg-black/[0.05] text-subt hover:bg-black/[0.08]'
        )}>
          {trigger.isActive ? <><ToggleRight className="w-3.5 h-3.5" /> Вкл</> : <><ToggleLeft className="w-3.5 h-3.5" /> Выкл</>}
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {sigSpecific && badge('#34c759', Filter, 'фразы', 'Реагирует только на конкретные фразы (Сигнал)')}
        {hasGate && badge('#663af1', UserCheck, 'проверка подписки', 'Если автор не подписан — бот пишет приглашение в комментарии и не шлёт DM')}
        {msg && badge('#663af1', Send, 'DM', 'Отправляет личное сообщение в директ')}
        {msg?.link?.enabled && badge('#663af1', Link2, 'ссылка', 'В конец сообщения добавляется кликабельная ссылка')}
        {msg?.image?.enabled && badge('#663af1', ImageIcon, 'фото', 'К сообщению прикрепляется картинка')}
        {reply && badge('#34c759', MessageCircle, `коммент ×${(reply.replies ?? []).filter(Boolean).length}`, 'Отвечает в комментариях случайным из вариантов')}
        {hasLikeComment && badge('#ff2d92', Heart, 'лайк коммента', 'Лайкает сам комментарий')}
        {hasLike && badge('#ff2d92', Heart, isComment ? 'лайк постов' : 'лайк', isComment ? 'Заходит к автору и лайкает его посты' : 'Лайкает последний пост подписчика')}
        {hasFollow && badge('#34c759', UserCheck, 'подписка', 'Подписывается на пользователя в ответ')}
        {storiesAct && badge('#ff9f0a', Clapperboard, storiesAct.like ? 'сторис + лайк' : 'сторис', storiesAct.like ? 'Просматривает и лайкает сторис пользователя' : 'Просматривает сторис пользователя')}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-canvas rounded-xl px-3 py-2 text-center">
          <div className="text-[15px] font-semibold text-ok">{trigger.fireCount ?? 0}</div>
          <div className="text-[10px] text-subt mt-0.5">срабатываний</div>
        </div>
        <div className="bg-canvas rounded-xl px-3 py-2 text-center">
          <div className="text-[12px] font-medium text-ink">{delayMin}–{delayMax}с</div>
          <div className="text-[10px] text-subt mt-0.5">задержка</div>
        </div>
      </div>

      {msgText && <div className="text-[12px] text-subt bg-canvas rounded-xl px-3 py-2 leading-relaxed line-clamp-2">{msgText}</div>}

      <div className="flex justify-end pt-1 border-t border-black/[0.04]">
        <button onClick={onDelete} className="flex items-center gap-1.5 text-[12px] text-subt hover:text-bad transition-colors">
          <Trash2 className="w-3.5 h-3.5" /> Удалить
        </button>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Мелкие UI-кирпичи
// ════════════════════════════════════════════════════════════════════════════
function CheckRow({ on, onChange, icon: Icon, label, disabled }: {
  on: boolean; onChange: (v: boolean) => void; icon: any; label: string; disabled?: boolean
}) {
  return (
    <button onClick={() => !disabled && onChange(!on)} disabled={disabled}
      className={cn('w-full flex items-center gap-2.5 py-1.5 text-left', disabled && 'opacity-40')}>
      <span className={cn('w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors',
        on ? 'bg-brand border-brand' : 'border-line')}>
        {on && <Check className="w-2.5 h-2.5 text-white" />}
      </span>
      <Icon className={cn('w-3.5 h-3.5', on ? 'text-brand' : 'text-subt')} />
      <span className={cn('text-[12.5px]', on ? 'font-medium text-ink' : 'text-subt')}>{label}</span>
    </button>
  )
}

// Сворачиваемая группа (аккордеон)
function Group({ title, icon: Icon, accent = '#663af1', defaultOpen = true, children }: {
  title: string; icon?: any; accent?: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl border border-line/60 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2.5 bg-canvas/60 hover:bg-canvas transition-colors">
        {Icon && <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: hexA(accent, 0.12) }}><Icon className="w-3.5 h-3.5" style={{ color: accent }} /></span>}
        <span className="text-[12.5px] font-semibold">{title}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-subt ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 text-subt ml-auto" />}
      </button>
      {open && <div className="p-3 space-y-2.5">{children}</div>}
    </div>
  )
}

// Сопоставление фраз: на все слова / конкретные (+ точное совпадение)
function MatchConfig({ mode, phrases, exact, onMode, onPhrases, onExact }: {
  mode: MatchMode; phrases: string; exact: boolean
  onMode: (m: MatchMode) => void; onPhrases: (s: string) => void; onExact: (b: boolean) => void
}) {
  return (
    <div className="space-y-2">
      <div className="segment w-full">
        <button onClick={() => onMode('all')}
          className={cn('flex-1 py-1.5 rounded-xl text-[12px] font-medium transition-colors', mode === 'all' ? 'bg-white shadow-sm text-ink' : 'text-subt')}>
          На все слова
        </button>
        <button onClick={() => onMode('specific')}
          className={cn('flex-1 py-1.5 rounded-xl text-[12px] font-medium transition-colors', mode === 'specific' ? 'bg-white shadow-sm text-ink' : 'text-subt')}>
          Конкретные фразы
        </button>
      </div>
      {mode === 'specific' && (
        <>
          <textarea value={phrases} onChange={(e) => onPhrases(e.target.value)}
            className="field h-16 resize-none py-2 text-[12px]" placeholder="Фразы — по одной на строку (напр. Guest list)" />
          <CheckRow on={exact} onChange={onExact} icon={Filter} label="Только точная фраза" />
          {!exact && (
            <div className="text-[10.5px] text-subt leading-snug">
              Без точного совпадения бот реагирует и на «gueSt List», и на «suees liss» (опечатки, регистр)
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Варианты ответа в комментариях (минимум 5)
function CommentReplies({ list, onChange }: { list: string[]; onChange: (l: string[]) => void }) {
  const filled = list.filter((x) => x.trim()).length
  const setAt = (i: number, v: string) => onChange(list.map((x, idx) => idx === i ? v : x))
  const add = () => onChange([...list, ''])
  const remove = (i: number) => { if (list.length > 5) onChange(list.filter((_, idx) => idx !== i)) }
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-medium text-subt">
          Варианты ответа <span className={cn(filled < 5 ? 'text-bad' : 'text-ok')}>({filled}/5 мин.)</span>
        </div>
        <button onClick={add} className="text-[11px] font-medium text-brand hover:underline">+ добавить</button>
      </div>
      <div className="space-y-1.5">
        {list.map((v, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input value={v} onChange={(e) => setAt(i, e.target.value)}
              className="field py-1.5 text-[12px] flex-1" placeholder={`Вариант ${i + 1}`} />
            <button onClick={() => remove(i)} disabled={list.length <= 5}
              className="text-subt hover:text-bad p-1 disabled:opacity-25 disabled:hover:text-subt"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <div className="text-[10.5px] text-subt mt-1">Бот выбирает случайный вариант — для естественности</div>
    </div>
  )
}

// Блок «Сообщение»: картинка сверху → текст → кастомный текст (везде одинаково)
function MessageBlock({ d, set, fileRef, onPickImage }: {
  d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void
  fileRef: React.RefObject<HTMLInputElement>; onPickImage: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <>
      {/* 1. Картинка — сверху */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-subt"><ImageIcon className="w-3 h-3" /> Картинка</div>
          {d.image && <button onClick={() => set('image', '')} className="text-[11px] text-bad hover:underline">Убрать</button>}
        </div>
        {d.image ? (
          <img src={d.image} alt="" className="w-full max-h-40 object-cover rounded-2xl border border-line/60" />
        ) : (
          <button onClick={() => fileRef.current?.click()}
            className="w-full py-3 rounded-2xl border border-dashed border-line text-[12px] text-subt hover:border-brand hover:text-brand transition-colors">
            + Загрузить изображение
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
      </div>

      {/* 2. Текст — снизу */}
      <div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-subt mb-1.5"><Send className="w-3 h-3" /> Текст сообщения</div>
        <textarea value={d.message} onChange={(e) => set('message', e.target.value)}
          className="field h-20 resize-none text-[13px] leading-relaxed" placeholder="Используйте {{username}}" />
      </div>

      {/* 3. Кастомный текст — в самом низу */}
      <button onClick={() => set('customOn', !d.customOn)}
        className={cn('flex items-center justify-center gap-1.5 py-2 w-full rounded-2xl border text-[12.5px] font-medium transition-all',
          d.customOn ? 'border-brand bg-brand/5 text-brand' : 'border-line/60 text-subt hover:border-line')}>
        <Sparkles className="w-3.5 h-3.5" /> {d.customOn ? 'Кастомный текст включён' : 'Кастомный текст'}
      </button>
      {d.customOn && (
        <div className="rounded-2xl border border-line/60 p-3 space-y-2 bg-canvas/50">
          <CheckRow on={d.linkOn} onChange={(v) => set('linkOn', v)} icon={Link2} label="Ссылка-кнопка" />
          {d.linkOn && (
            <div className="space-y-1.5 pl-6">
              <input value={d.linkText} onChange={(e) => set('linkText', e.target.value)} className="field py-1.5 text-[12px]" placeholder="Текст (напр. «Записаться»)" />
              <input value={d.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} className="field py-1.5 text-[12px]" placeholder="https://…" />
              {d.linkUrl && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand text-white text-[12px] font-medium">
                  <Link2 className="w-3 h-3" /> {d.linkText || d.linkUrl}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// Гейт подписки перед DM (комментарий/лайк/сторис). Для комментария — с текстом-приглашением.
function GateBlock({ d, set }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void }) {
  const isComment = d.type === 'COMMENT'
  return (
    <div className={cn('rounded-2xl border-2 p-3 transition-all', d.dmGate ? 'border-brand bg-brand/5' : 'border-line/70')}>
      <button onClick={() => set('dmGate', !d.dmGate)} className="w-full flex items-center gap-2.5 text-left">
        <span className={cn('w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0', d.dmGate ? 'bg-brand border-brand' : 'border-line')}>
          {d.dmGate && <Check className="w-3 h-3 text-white" />}
        </span>
        <UserCheck className="w-4 h-4" style={{ color: d.dmGate ? '#663af1' : '#6e6e73' }} />
        <span className="text-[13px] font-semibold">Проверять подписку перед DM</span>
      </button>
      {d.dmGate && (
        <div className="mt-2.5 pl-7 space-y-2">
          <div className="segment w-full">
            <button onClick={() => set('dmGateMode', 'followed_by')}
              className={cn('flex-1 py-1.5 rounded-xl text-[12px] font-medium transition-colors', d.dmGateMode === 'followed_by' ? 'bg-white shadow-sm text-ink' : 'text-subt')}>
              Подписан на нас
            </button>
            <button onClick={() => set('dmGateMode', 'mutual')}
              className={cn('flex-1 py-1.5 rounded-xl text-[12px] font-medium transition-colors', d.dmGateMode === 'mutual' ? 'bg-white shadow-sm text-ink' : 'text-subt')}>
              Взаимная подписка
            </button>
          </div>
          {isComment ? (
            <>
              <div className="text-[10.5px] text-subt leading-snug">Если условие НЕ выполнено — бот пишет приглашение в комментарии и НЕ шлёт DM. Если выполнено — отвечает и шлёт DM.</div>
              <textarea value={d.cmtGateText} onChange={(e) => set('cmtGateText', e.target.value)}
                className="field h-14 resize-none py-1.5 text-[12px]" placeholder="Текст для неподписанных (напр. «Подпишись, чтобы получить DM 💌»)" />
            </>
          ) : (
            <div className="text-[10.5px] text-subt leading-snug">Если условие НЕ выполнено — DM просто пропускается. Лайк / подписка / сторис (если включены) всё равно выполнятся.</div>
          )}
        </div>
      )}
    </div>
  )
}

// Группа «Сторис»: просмотр + лайк
function StoriesBlock({ d, set }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void }) {
  return (
    <Group title="Сторис" icon={Clapperboard} accent="#ff9f0a" defaultOpen={false}>
      <CheckRow on={d.storyView} onChange={(v) => set('storyView', v)} icon={Eye} label="Просмотреть сторис пользователя" />
      <CheckRow on={d.storyLike} onChange={(v) => { set('storyLike', v); if (v) set('storyView', true) }} icon={Heart} label="Пролайкать просмотренные сторис" />
    </Group>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Форма создания триггера
// ════════════════════════════════════════════════════════════════════════════
interface FormApi { open: () => void; load: (d: Draft) => void; openFor: (id: string) => void; edit: (t: DbTrigger) => void }

function CreateForm({
  dbAccounts, dbTriggers, loadingAccounts, onCreated, onEdited, formRef, lockedAccountId, startOpen = false,
}: {
  dbAccounts: DbAccount[]
  dbTriggers: DbTrigger[]
  loadingAccounts: boolean
  onCreated: () => void
  onEdited?: (id: string) => void
  formRef: React.MutableRefObject<FormApi | null>
  lockedAccountId?: string
  startOpen?: boolean
}) {
  const [open, setOpen] = useState(startOpen)
  const [editId, setEditId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>(lockedAccountId ? [lockedAccountId] : [])
  const [search, setSearch] = useState('')
  const [d, setD] = useState<Draft>(DEFAULT_DRAFT)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const [tplName, setTplName] = useState('')
  const [tplSaving, setTplSaving] = useState(false)
  const [showTplSave, setShowTplSave] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)

  const activeByAccount = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const t of dbTriggers) {
      if (!t.isActive) continue
      if (!m.has(t.responder.id)) m.set(t.responder.id, new Set())
      m.get(t.responder.id)!.add(t.triggerType)
    }
    return m
  }, [dbTriggers])

  useEffect(() => {
    formRef.current = {
      open: () => { setEditId(null); setOpen(true) },
      load: (draft: Draft) => { setEditId(null); setD({ ...DEFAULT_DRAFT, ...draft }); setOpen(true); setSaveMsg(null) },
      openFor: (id: string) => { setEditId(null); setSelected([id]); setD({ ...DEFAULT_DRAFT }); setOpen(true); setSaveMsg(null) },
      edit: (t: DbTrigger) => { setEditId(t.id); setSelected([t.responder.id]); setD(draftFromTrigger(t)); setOpen(true); setSaveMsg(null) },
    }
  }, [formRef])

  // Внутри аккаунта (lockedAccountId) форма всегда работает с этим аккаунтом.
  // React переиспользует инстанс между уровнями, поэтому синхронизируем выбор явно,
  // иначе после перехода/сохранения selected пуст → «Выберите аккаунты».
  useEffect(() => {
    if (lockedAccountId) setSelected([lockedAccountId])
  }, [lockedAccountId])

  const hideAccounts = Boolean(lockedAccountId) || Boolean(editId)

  const filtered = useMemo(
    () => dbAccounts.filter((a) => a.username.toLowerCase().includes(search.toLowerCase())),
    [dbAccounts, search]
  )
  const allSelected = filtered.length > 0 && filtered.every((a) => selected.includes(a.id))
  const toggleAll = () => setSelected(allSelected ? [] : filtered.map((a) => a.id))
  const toggleOne = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

  const isComment = d.type === 'COMMENT'
  const matchOk = d.dmMatchMode === 'all' || splitPhrases(d.dmPhrases).length > 0
  const repliesFilled = d.commentReplies.filter((x) => x.trim()).length

  // Для комментария «ответ в комментариях» и «проверка подписки» — под-настройки Директа,
  // поэтому самостоятельными действиями не считаются.
  const anyAction = isComment
    ? (d.actDM || d.actLikeComment || d.actFollow || d.actStories)
    : (d.actDM || d.actLike || d.actFollow || d.actStories)
  const dmOk = !d.actDM || d.message.trim() !== ''
  const crOk = !isComment || !d.actCommentReply || repliesFilled >= 5
  const gateOk = !isComment || !d.dmGate || d.cmtGateText.trim() !== ''
  const sigOk = !isComment || matchOk
  const storiesOk = !d.actStories || d.storyView || d.storyLike
  const canSave = selected.length > 0 && d.name.trim() !== '' && anyAction && dmOk && crOk && gateOk && sigOk && storiesOk

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setSaveMsg({ text: 'Картинка больше 2 МБ', ok: false }); return }
    const reader = new FileReader()
    reader.onload = () => set('image', reader.result as string)
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true); setSaveMsg(null)
    try {
      const conditions = isComment ? buildSignal(d) : []
      if (editId) {
        // Редактирование: кампания уже остановлена (гейт §D1). isActive:false — на всякий случай.
        const res = await fetch(`/api/triggers/${editId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: d.name.trim(), conditions, actions: buildActions(d), isActive: false }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) {
          const savedId = editId
          setOpen(false); setEditId(null)
          onEdited?.(savedId)   // родитель спросит: включить/пауза + обнулить/сохранить статистику
        } else {
          setSaveMsg({ text: data.error ?? 'Ошибка', ok: false })
        }
      } else {
        const res = await fetch('/api/triggers', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: d.name.trim(), accountIds: selected, type: d.type, conditions, actions: buildActions(d) }),
        })
        const data = await res.json()
        if (res.ok) {
          setSaveMsg({ text: `Создано кампаний: ${data.count}`, ok: true })
          // внутри аккаунта оставляем его выбранным, иначе сброс в пусто
          setSelected(lockedAccountId ? [lockedAccountId] : []); setD({ ...DEFAULT_DRAFT }); onCreated()
        } else {
          setSaveMsg({ text: data.error ?? 'Ошибка', ok: false })
        }
      }
    } catch {
      setSaveMsg({ text: 'Ошибка сети', ok: false })
    } finally {
      setSaving(false)
    }
  }

  const saveTemplate = async () => {
    if (!tplName.trim()) return
    setTplSaving(true)
    try {
      const res = await fetch('/api/templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tplName.trim(), draft: d }),
      })
      if (res.ok) {
        setSaveMsg({ text: 'Шаблон сохранён', ok: true })
        setShowTplSave(false); setTplName(''); onCreated()
      } else {
        const data = await res.json()
        setSaveMsg({ text: data.error ?? 'Ошибка', ok: false })
      }
    } catch {
      setSaveMsg({ text: 'Ошибка сети', ok: false })
    } finally {
      setTplSaving(false)
    }
  }

  // Чипы действий зависят от события
  const chips = isComment
    ? [
        { k: 'actDM' as const,          icon: Send,         label: 'Директ',   color: '#663af1', tip: 'Личное сообщение автору комментария + ответ в комментариях (настраивается ниже)' },
        { k: 'actLikeComment' as const, icon: Heart,        label: 'Лайк',     color: '#ff2d92', tip: 'Зайти на профиль автора комментария и пролайкать его последние посты' },
        { k: 'actFollow' as const,      icon: UserCheck,    label: 'Подписка', color: '#34c759', tip: 'Подписаться на автора комментария' },
        { k: 'actStories' as const,     icon: Clapperboard, label: 'Сторис',   color: '#ff9f0a', tip: 'Просмотреть и (по желанию) пролайкать сторис автора комментария' },
      ]
    : [
        { k: 'actDM' as const,      icon: Send,         label: 'Директ',   color: '#663af1', tip: 'Отправить личное сообщение новому подписчику' },
        { k: 'actLike' as const,    icon: Heart,        label: 'Лайк',     color: '#ff2d92', tip: 'Лайкнуть последний пост нового подписчика' },
        { k: 'actFollow' as const,  icon: UserCheck,    label: 'Подписка', color: '#34c759', tip: 'Подписаться в ответ на нового подписчика' },
        { k: 'actStories' as const, icon: Clapperboard, label: 'Сторис',   color: '#ff9f0a', tip: 'Просмотреть и (по желанию) пролайкать сторис подписчика' },
      ]

  const closeEdit = () => { setEditId(null); setOpen(false); setD({ ...DEFAULT_DRAFT }); setSaveMsg(null) }

  // Тело формы (шаги) — переиспользуется в двух оболочках: попап (редактирование) и карточка снизу (создание).
  const body = (
          <div className={cn('grid gap-5', hideAccounts ? 'lg:grid-cols-2' : 'lg:grid-cols-3')}>

            {/* ── Шаг 1 — аккаунты (скрыт при редактировании и при создании для конкретного аккаунта) ── */}
            {!hideAccounts && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">1</span>
                  Аккаунты
                  <Hint text="Цвет плашки = состояние аккаунта (зелёный — работает, синий — готов, жёлтый — ошибки, красный — проблема). 4 иконки показывают, какие кампании уже включены: горят цветом — вкл, серые — выкл." />
                </span>
                <button onClick={toggleAll} className="text-[12px] text-brand hover:underline">{allSelected ? 'Снять' : 'Все'}</button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-subt" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск…" className="field pl-9 py-2 text-[13px]" />
              </div>
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {loadingAccounts ? (
                  <div className="py-6 text-center text-subt text-[12px]">Загрузка…</div>
                ) : filtered.length === 0 ? (
                  <div className="py-6 text-center text-subt text-[12px]">
                    {dbAccounts.length === 0
                      ? <><a href="/accounts" className="text-brand hover:underline">Добавьте аккаунт</a> сначала</>
                      : 'Ничего не найдено'}
                  </div>
                ) : filtered.map((a) => {
                  const on = selected.includes(a.id)
                  const activeTypes = activeByAccount.get(a.id) ?? new Set<string>()
                  const ps = plateState(a, activeTypes.size)
                  return (
                    <button key={a.id} onClick={() => toggleOne(a.id)}
                      className={cn('w-full flex flex-col gap-2 p-2.5 rounded-2xl text-left border transition-all',
                        PLATE_STYLE[ps], on ? 'ring-2 ring-brand/30' : 'hover:brightness-[0.99]')}>
                      <div className="flex items-center gap-2.5">
                        <span className={cn('w-4 h-4 rounded-md border flex items-center justify-center shrink-0',
                          on ? 'bg-brand border-brand' : 'border-line bg-white')}>
                          {on && <Check className="w-2.5 h-2.5 text-white" />}
                        </span>
                        <span className="font-medium text-[13px] truncate">@{a.username}</span>
                        <span className="ml-auto shrink-0">
                          <Tooltip content={PLATE_TIP[ps]}>
                            <span className="flex items-center gap-1.5 cursor-help">
                              <span className={cn('w-1.5 h-1.5 rounded-full', PLATE_DOT[ps])} />
                              <span className="text-[10.5px] text-subt">{PLATE_LABEL[ps]}</span>
                            </span>
                          </Tooltip>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 pl-6" onClick={(e) => e.stopPropagation()}>
                        {TRIG_META.map((m) => (
                          <TrigBadge key={m.key} meta={m} active={activeTypes.has(m.db)} size={26}
                            title={`${m.label} — ${activeTypes.has(m.db) ? 'включён на этом аккаунте' : 'выключен'}`} />
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
            )}

            {/* ── Шаг 2 — событие ──────────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">2</span>
                Событие
              </span>
              {editId && <div className="text-[11px] text-subt -mt-1">Тип события нельзя менять при редактировании — создайте новую кампанию.</div>}
              <div className="space-y-2">
                {TRIG_META.filter((m) => !editId || d.type === m.key).map((m) => {
                  const on = d.type === m.key
                  if (m.soon) {
                    return (
                      <div key={m.key} title="Скоро" className="w-full flex items-center gap-3 p-3 rounded-2xl border border-line/50 text-left opacity-55 cursor-not-allowed select-none">
                        <TrigBadge meta={m} active={false} size={38} tip={false} />
                        <span className="min-w-0">
                          <span className="block font-medium text-[13px] flex items-center gap-1.5">{m.label}
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-warn/15 text-warn">СКОРО</span>
                          </span>
                          <span className="block text-[11px] text-subt">{m.desc}</span>
                        </span>
                      </div>
                    )
                  }
                  return (
                    <button key={m.key} onClick={() => { if (editId) return; set('type', m.key) }}
                      className={cn('w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition-all duration-200',
                        on ? 'bg-white' : 'border-line/60 hover:border-line hover:bg-white/60')}
                      style={on ? { borderColor: m.color, boxShadow: `0 8px 20px ${hexA(m.color, 0.18)}, inset 0 1px 0 rgba(255,255,255,0.7)` } : undefined}>
                      <TrigBadge meta={m} active={on} size={38} tip={false} />
                      <span className="min-w-0">
                        <span className="block font-medium text-[13px]">{m.label}</span>
                        <span className="block text-[11px] text-subt">{m.desc}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── Шаг 3 — настройка ────────────────────────────────────────── */}
            <div className="flex flex-col gap-3">
              <span className="text-[13px] font-semibold flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">3</span>
                Настройка
              </span>

              {/* Действия (чипы) */}
              <div>
                <div className="text-[11px] font-medium text-subt mb-1.5 flex items-center gap-1.5">Действие <Hint text="Можно выбрать несколько действий сразу. Наведи на иконку, чтобы узнать, что делает каждое." /></div>
                <div className="grid grid-cols-4 gap-2">
                  {chips.map(({ k, icon: Icon, label, color, tip }) => {
                    const on = d[k]
                    return (
                      <Tooltip key={k} content={tip} className="flex">
                        <button onClick={() => set(k, !on)}
                          className={cn('w-full flex flex-col items-center gap-1.5 py-2.5 rounded-2xl border transition-all duration-200 active:scale-95',
                            on ? 'bg-white' : 'border-line/60 text-subt hover:border-line')}
                          style={on ? { borderColor: color, boxShadow: `0 5px 14px ${hexA(color, 0.2)}, inset 0 1px 0 rgba(255,255,255,0.7)` } : undefined}>
                          <span className="rounded-xl flex items-center justify-center transition-transform" style={on ? { width: 30, height: 30, background: `linear-gradient(145deg, ${color}, ${darken(color)})`, boxShadow: `0 3px 9px ${hexA(color, 0.5)}, inset 0 1px 1px rgba(255,255,255,0.5)`, color: '#fff' } : { width: 30, height: 30 }}>
                            <Icon className="w-4 h-4" style={on ? undefined : { color: '#9ca3af' }} />
                          </span>
                          <span className="text-[11px] font-medium" style={on ? { color } : undefined}>{label}</span>
                        </button>
                      </Tooltip>
                    )
                  })}
                </div>
                {isComment && d.actLikeComment && <div className="text-[10.5px] text-subt mt-1.5">↳ Бот зайдёт к автору комментария и пролайкает его посты (если есть)</div>}
                {isComment && d.actFollow && <div className="text-[10.5px] text-subt mt-1">↳ Подписаться на автора комментария</div>}
              </div>

              <input value={d.name} onChange={(e) => set('name', e.target.value)} className="field py-2 text-[13px]" placeholder="Название кампании" />

              {/* ════ КОММЕНТАРИЙ ════ */}
              {isComment ? (
                <>
                  {/* Проверка подписки — выше сигнала (часть директа) */}
                  {d.actDM && <GateBlock d={d} set={set} />}

                  {/* Группа «Сигнал» — на что реагировать (общая для всего триггера) */}
                  <Group title="Сигнал — на что реагировать" icon={Filter} accent="#6a7df9" defaultOpen={false}>
                    <MatchConfig
                      mode={d.dmMatchMode} phrases={d.dmPhrases} exact={d.dmExact}
                      onMode={(m) => set('dmMatchMode', m)} onPhrases={(s) => set('dmPhrases', s)} onExact={(b) => set('dmExact', b)}
                    />
                  </Group>

                  {d.actDM && (
                    <>
                      {/* Галочка «Ответ в комментариях» — между сигналом и сообщением */}
                      <div className={cn('rounded-2xl border p-2.5 transition-all', d.actCommentReply ? 'border-ok/50 bg-ok/[0.06]' : 'border-line/60')}>
                        <button onClick={() => set('actCommentReply', !d.actCommentReply)} className="w-full flex items-center gap-2.5 text-left">
                          <span className={cn('w-4 h-4 rounded-md border flex items-center justify-center shrink-0', d.actCommentReply ? 'bg-ok border-ok' : 'border-line')}>
                            {d.actCommentReply && <Check className="w-2.5 h-2.5 text-white" />}
                          </span>
                          <MessageCircle className="w-3.5 h-3.5" style={{ color: d.actCommentReply ? '#34c759' : '#6e6e73' }} />
                          <span className="text-[12.5px] font-medium">Ответ в комментариях</span>
                        </button>
                      </div>

                      {d.actCommentReply && (
                        <Group title="Комментарии" icon={MessageCircle} accent="#34c759" defaultOpen={false}>
                          <CommentReplies list={d.commentReplies} onChange={(l) => set('commentReplies', l)} />
                        </Group>
                      )}

                      {/* Группа «Сообщение» (директ) */}
                      <Group title="Сообщение (директ)" icon={Send} defaultOpen={false}>
                        <MessageBlock d={d} set={set} fileRef={fileRef} onPickImage={onPickImage} />
                      </Group>
                    </>
                  )}

                  {d.actStories && <StoriesBlock d={d} set={set} />}
                </>
              ) : (
                /* ════ ПОДПИСКА / ЛАЙК / СТОРИС ════ */
                <>
                  {/* Гейт подписки — для Лайка/Сторис (у подписчика он не нужен: он уже подписан) */}
                  {d.actDM && (d.type === 'LIKE' || d.type === 'STORY_REPLY') && <GateBlock d={d} set={set} />}
                  {d.actDM && (
                    <Group title="Сообщение" icon={Send} defaultOpen={false}>
                      <MessageBlock d={d} set={set} fileRef={fileRef} onPickImage={onPickImage} />
                    </Group>
                  )}
                  {d.actFollow && d.type === 'FOLLOW' && <div className="text-[10.5px] text-subt -mt-1">↳ Подписаться в ответ на нового подписчика</div>}
                  {d.actStories && <StoriesBlock d={d} set={set} />}
                </>
              )}

              {/* Задержки */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[11px] font-medium text-subt mb-1">Задержка от (сек)</div>
                  <input type="number" value={d.delayMin} onChange={(e) => set('delayMin', +e.target.value)} className="field py-2 text-[13px]" />
                </div>
                <div>
                  <div className="text-[11px] font-medium text-subt mb-1">до (сек)</div>
                  <input type="number" value={d.delayMax} onChange={(e) => set('delayMax', +e.target.value)} className="field py-2 text-[13px]" />
                </div>
              </div>

              {saveMsg && <div className={cn('text-[12px] text-center', saveMsg.ok ? 'text-ok' : 'text-bad')}>{saveMsg.text}</div>}

              {/* Сохранение шаблона */}
              {showTplSave ? (
                <div className="flex gap-2">
                  <input value={tplName} onChange={(e) => setTplName(e.target.value)} autoFocus
                    className="field py-2 text-[13px]" placeholder="Название шаблона" />
                  <Button variant="secondary" onClick={saveTemplate} disabled={!tplName.trim() || tplSaving}>{tplSaving ? '…' : 'OK'}</Button>
                  <Button variant="ghost" onClick={() => setShowTplSave(false)}><X className="w-4 h-4" /></Button>
                </div>
              ) : (
                <button onClick={() => setShowTplSave(true)}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-2xl border border-line/60 text-[12.5px] font-medium text-subt hover:border-brand hover:text-brand transition-all">
                  <Bookmark className="w-3.5 h-3.5" /> Сохранить как шаблон
                </button>
              )}

              <Button className="w-full mt-1 bg-gradient-to-r from-brand via-[#9b66ff] to-brand text-white hover:brightness-105" onClick={save} disabled={!canSave || saving}>
                <Zap className="w-3.5 h-3.5" fill="white" />
                {saving ? 'Сохранение…'
                  : selected.length === 0 ? 'Выберите аккаунты'
                  : !d.name.trim() ? 'Введите название'
                  : !anyAction ? 'Выберите действие'
                  : !sigOk ? 'Заполните фразы сигнала'
                  : !dmOk ? 'Заполните текст DM'
                  : !gateOk ? 'Заполните текст для неподписанных'
                  : !crOk ? 'Нужно минимум 5 вариантов ответа'
                  : !storiesOk ? 'Отметьте действие со сторис'
                  : editId ? 'Сохранить изменения'
                  : `Создать для ${selected.length} акк.`}
              </Button>
            </div>
          </div>
  )

  // Редактирование — во всплывающем попапе (чтобы не путать с формой снизу).
  if (editId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={closeEdit}>
        <div className="card w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-scale-in" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.05] sticky top-0 bg-card z-10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center"><Settings className="w-4 h-4 text-brand" /></div>
              <span className="font-semibold text-[15px]">Редактирование кампании</span>
            </div>
            <button onClick={closeEdit} className="text-subt hover:text-ink" aria-label="Закрыть"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-5">{body}</div>
        </div>
      </div>
    )
  }

  // Создание — раскрывающаяся карточка снизу.
  return (
    <div className="card overflow-hidden">
      <button data-tour="create" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-black/[0.02] transition-colors">
        <div className="flex items-center gap-3 text-left">
          <div className="w-8 h-8 rounded-xl bg-brand/10 flex items-center justify-center shrink-0"><Plus className="w-4 h-4 text-brand" /></div>
          <div>
            <span className="font-semibold text-[15px] block">Создать кампанию</span>
            <span className="text-[12px] text-subt">Выберите аккаунт, событие и что делать — бот запустит автодействия</span>
          </div>
        </div>
        <span className="flex items-center gap-2 shrink-0">
          {!open && <span className="hidden sm:inline text-[12px] font-medium text-brand">Нажмите, чтобы настроить</span>}
          {open ? <ChevronUp className="w-4 h-4 text-subt" /> : <ChevronDown className="w-4 h-4 text-brand" />}
        </span>
      </button>
      {open && <div className="border-t border-black/[0.05] p-5">{body}</div>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Панель шаблонов
// ════════════════════════════════════════════════════════════════════════════
interface DbTemplate { id: string; name: string; usageCount: number; draft: Draft | null }

function TemplatesDrawer({ templates, loading, onClose, onApply, onDelete, onReload }: {
  templates: DbTemplate[]; loading: boolean
  onClose: () => void
  onApply: (d: Draft) => void
  onDelete: (id: string) => void
  onReload: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-card shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06]">
          <div className="flex items-center gap-2 font-semibold text-[15px]"><FileText className="w-4 h-4 text-brand" /> Шаблоны</div>
          <div className="flex items-center gap-1">
            <button onClick={onReload} className="p-1.5 text-subt hover:text-ink"><RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /></button>
            <button onClick={onClose} className="p-1.5 text-subt hover:text-ink"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-12 text-center text-subt text-[13px]">Загрузка…</div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center text-subt text-[13px]">Нет сохранённых шаблонов.<br />Создайте кампанию и нажмите «Сохранить как шаблон».</div>
          ) : templates.map((t) => {
            const meta = t.draft ? META_BY_KEY[t.draft.type] : undefined
            return (
              <div key={t.id} className="card-flat p-3 flex items-center gap-3">
                {meta ? <TrigBadge meta={meta} active size={36} /> : <div className="w-9 h-9 rounded-xl bg-black/5" />}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13px] truncate">{t.name}</div>
                  <div className="text-[11px] text-subt truncate">{t.draft?.message || meta?.label || '—'}</div>
                </div>
                {t.draft && <Button size="sm" variant="secondary" onClick={() => { onApply(t.draft!); onClose() }}>Применить</Button>}
                <button onClick={() => onDelete(t.id)} className="p-1.5 text-subt hover:text-bad"><Trash2 className="w-4 h-4" /></button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Действия триггера (по категориям + счётчики + настройки)
// ════════════════════════════════════════════════════════════════════════════
interface ActionRow { key: string; label: string; color: string; Icon: any; fired: number; done: number; settings: string[] }

// Раскладывает триггер на действия по категориям + перечисляет включённые настройки каждого.
// fired = «сработало» (попыток), done = «выполнено» (успехов) — из stats (см. lib/stats).
function describeActions(trigger: DbTrigger): ActionRow[] {
  const on = (a: any) => a && a.enabled !== false
  const acts = trigger.actions ?? []
  const stats = trigger.stats ?? {}
  const isComment = trigger.triggerType === 'NEW_COMMENT'
  const rows: ActionRow[] = []

  const dm = acts.find((a: any) => a.type === 'SEND_MESSAGE' && on(a))
  const legacyGate = acts.find((a: any) => a.type === 'COMMENT_GATE' && on(a))
  if (dm) {
    const set: string[] = []
    if (dm.link?.enabled) set.push('ссылка')
    if (dm.image?.enabled) set.push('фото')
    const gate = dm.gate ?? (legacyGate ? { mode: 'followed_by' } : null)
    if (gate) set.push(gate.mode === 'mutual' ? 'взаимная подписка' : 'проверка подписки')
    const st = readStat(stats, 'dm')
    rows.push({ key: 'dm', label: 'DM', color: '#663af1', Icon: Send, fired: st.fired, done: st.done, settings: set })
  }

  const reply = acts.find((a: any) => a.type === 'REPLY_COMMENT' && on(a))
  if (reply) {
    const n = (reply.replies ?? []).filter(Boolean).length
    const st = readStat(stats, 'comment')
    rows.push({ key: 'comment', label: 'Коммент', color: '#34c759', Icon: MessageCircle, fired: st.fired, done: st.done, settings: [`${n} вар.`] })
  }

  const likeMedia = acts.some((a: any) => a.type === 'LIKE_MEDIA' && on(a))
  const likeComment = acts.some((a: any) => a.type === 'LIKE_COMMENT' && on(a))
  if (likeMedia || likeComment) {
    const set: string[] = []
    if (likeMedia) set.push(isComment ? 'посты автора' : 'последний пост')
    if (likeComment) set.push('коммент')
    const st = readStat(stats, 'like')
    rows.push({ key: 'like', label: 'Лайк', color: '#ff2d92', Icon: Heart, fired: st.fired, done: st.done, settings: set })
  }

  if (acts.some((a: any) => a.type === 'FOLLOW_BACK' && on(a))) {
    const st = readStat(stats, 'follow')
    rows.push({ key: 'follow', label: 'Подписка', color: '#34c759', Icon: UserCheck, fired: st.fired, done: st.done, settings: [] })
  }

  const story = acts.find((a: any) => a.type === 'VIEW_STORIES' && on(a))
  if (story) {
    const st = readStat(stats, 'story')
    rows.push({ key: 'story', label: 'Сторис', color: '#ff9f0a', Icon: Clapperboard, fired: st.fired, done: st.done, settings: [story.like ? 'просмотр + лайк' : 'просмотр'] })
  }
  return rows
}

// Описание «Сигнала» (на что реагирует триггер-комментарий)
function describeSignal(trigger: DbTrigger): string | null {
  if (trigger.triggerType !== 'NEW_COMMENT') return null
  const c = (trigger.conditions ?? {}) as any
  if (c.mode !== 'specific') return 'на все слова'
  const phrases: string[] = (c.phrases ?? []).filter(Boolean)
  if (!phrases.length) return 'на все слова'
  const shown = phrases.slice(0, 2).join(', ')
  return `фразы: ${shown}${phrases.length > 2 ? ` +${phrases.length - 2}` : ''}${c.exact ? ' (точно)' : ''}`
}


// Детали конкретного действия (раскрываются по клику)
function ActionDetail({ trigger, k, onEdit }: { trigger: DbTrigger; k: string; onEdit?: () => void }) {
  const on = (a: any) => a && a.enabled !== false
  const acts = trigger.actions ?? []
  const isComment = trigger.triggerType === 'NEW_COMMENT'
  const box = 'text-[11.5px] text-subt bg-canvas rounded-xl px-3 py-2.5 leading-relaxed space-y-1.5 animate-fade-in'

  // Честная статистика действия: сработало (попыток) vs выполнено (успехов)
  const stat = readStat(trigger.stats, k)
  const gap = stat.fired - stat.done
  const summary = (
    <div className="flex items-center gap-2.5 flex-wrap text-[11px] pb-1.5 border-b border-black/[0.05]">
      <span className="text-ink/70">Сработало <span className="font-semibold tabular-nums">{stat.fired.toLocaleString('ru')}</span></span>
      <span className="text-ok">Выполнено <span className="font-semibold tabular-nums">{stat.done.toLocaleString('ru')}</span></span>
      {gap > 0 && (
        <Tooltip content="Триггер сработал, но действие не выполнилось: закрытая личка, нет поста для лайка, не прошла подписка или дневной лимит.">
          <span className="text-bad cursor-help">не выполнено <span className="font-semibold tabular-nums">{gap.toLocaleString('ru')}</span></span>
        </Tooltip>
      )}
    </div>
  )

  let body: React.ReactNode = null
  if (k === 'dm') {
    const dm = acts.find((a: any) => a.type === 'SEND_MESSAGE' && on(a))
    const legacyGate = acts.find((a: any) => a.type === 'COMMENT_GATE' && on(a))
    const gate = dm?.gate ?? (legacyGate ? { mode: 'followed_by', inviteText: legacyGate.text } : null)
    body = (
      <>
        {dm?.templates?.[0] && <div className="text-ink/80">«{dm.templates[0]}»</div>}
        {dm?.link?.enabled && <div className="flex items-center gap-1 text-brand"><Link2 className="w-3 h-3 shrink-0" /> {dm.link.text || 'Ссылка'} <span className="text-subt truncate">→ {dm.link.url}</span></div>}
        {dm?.image?.enabled && dm.image.url && <img src={dm.image.url} alt="" className="w-full max-h-32 object-cover rounded-lg border border-line/60" />}
        {gate && <div className="flex items-center gap-1"><UserCheck className="w-3 h-3 shrink-0 text-brand" /> Проверка подписки{gate.mode === 'mutual' ? ' (взаимная)' : ''}{gate.inviteText ? ` · неподписанным: «${gate.inviteText}»` : ''}</div>}
        <div className="text-[10.5px] text-subt/70">Задержка отправки: {dm?.delayMin ?? 45}–{dm?.delayMax ?? 180}с</div>
      </>
    )
  } else if (k === 'comment') {
    const reply = acts.find((a: any) => a.type === 'REPLY_COMMENT' && on(a))
    const variants: string[] = (reply?.replies ?? []).filter(Boolean)
    body = (
      <>
        <div className="font-medium text-ink/70">Варианты ответа — {variants.length} (бот выбирает случайный):</div>
        <ol className="list-decimal ml-4 space-y-0.5">{variants.map((v, i) => <li key={i}>{v}</li>)}</ol>
      </>
    )
  } else if (k === 'like') {
    const lm = acts.some((a: any) => a.type === 'LIKE_MEDIA' && on(a))
    const lc = acts.some((a: any) => a.type === 'LIKE_COMMENT' && on(a))
    body = (
      <>
        {lm && <div className="flex items-center gap-1"><Heart className="w-3 h-3 shrink-0 text-[#ff2d92]" /> Лайкает {isComment ? 'последние посты автора комментария' : 'последний пост подписчика'}</div>}
        {lc && <div className="flex items-center gap-1"><Heart className="w-3 h-3 shrink-0 text-[#ff2d92]" /> Лайкает сам комментарий</div>}
      </>
    )
  } else if (k === 'follow') {
    body = <div className="flex items-center gap-1"><UserCheck className="w-3 h-3 shrink-0 text-ok" /> Подписывается на {isComment ? 'автора комментария' : 'нового подписчика'}</div>
  } else if (k === 'story') {
    const st = acts.find((a: any) => a.type === 'VIEW_STORIES' && on(a))
    body = <div className="flex items-center gap-1"><Clapperboard className="w-3 h-3 shrink-0 text-[#ff9f0a]" /> Просматривает сторис{st?.like ? ' и ставит лайк' : ''}</div>
  }

  return (
    <div className={box}>
      {summary}
      {body}
      {onEdit && (
        <button onClick={onEdit} className="flex items-center gap-1 text-[11px] font-medium text-brand hover:underline pt-1">
          <Settings className="w-3 h-3" /> Изменить это действие
        </button>
      )}
    </div>
  )
}

// ── Компактная карточка кампании (триггера) ─────────────────────────────────
function CampaignCard({ trigger, onToggle, onEdit, onDelete, index = 0 }: {
  trigger: DbTrigger; onToggle: () => void; onEdit: () => void; onDelete: () => void; index?: number
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const meta = META_BY_DB[trigger.triggerType]
  const rows = describeActions(trigger)
  const signal = describeSignal(trigger)
  const firedTotal = trigger.fireCount ?? 0   // сколько раз кампания сработала

  const cond = (trigger.conditions ?? {}) as any
  const signalPhrases: string[] = (cond.phrases ?? []).filter(Boolean)
  const signalExpandable = Boolean(signal) && cond.mode === 'specific' && signalPhrases.length > 0
  const signalOpen = openKey === 'signal'

  return (
    <div className={cn('card card-3d rise p-3.5 flex flex-col gap-3', !trigger.isActive && 'opacity-55')} style={{ animationDelay: `${index * 60}ms` }}>
      {/* Шапка: только название кампании + вкл/выкл (без аватарки и дубля типа) */}
      <div className="flex items-center gap-2.5">
        <div className="font-semibold text-[14.5px] truncate flex-1 min-w-0">{trigger.name}</div>
        <button onClick={onToggle} className={cn('flex items-center gap-1 text-[11.5px] font-medium px-2.5 py-1 rounded-lg shrink-0 transition-colors',
          trigger.isActive ? 'bg-ok/10 text-ok hover:bg-ok/20' : 'bg-black/[0.05] text-subt hover:bg-black/[0.08]')}>
          {trigger.isActive ? <><ToggleRight className="w-3.5 h-3.5" /> Вкл</> : <><ToggleLeft className="w-3.5 h-3.5" /> Выкл</>}
        </button>
      </div>

      {/* ── БЛОК «ТРИГГЕР» — что запускает кампанию (ярлык-шапка как у «ДЕЙСТВИЯ», без аватарки) ── */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: hexA(meta?.color ?? '#8e8e93', 0.3) }}>
        <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1"
          style={{ background: hexA(meta?.color ?? '#8e8e93', 0.12), color: meta?.color ?? '#8e8e93' }}>
          Триггер <Hint text="Событие, которое запускает кампанию (новая подписка / комментарий / лайк / сторис)." />
        </div>
        <div className="px-2.5 py-2">
          <div className="flex items-center gap-2">
            {meta && (
              <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: hexA(meta.color, 0.12) }}>
                <meta.Icon className="w-3 h-3" style={{ color: meta.color }} strokeWidth={2.4} />
              </span>
            )}
            <span className="text-[13px] font-semibold truncate flex-1 min-w-0">{meta?.label ?? trigger.triggerType}</span>
            <span className="text-[11px] text-subt shrink-0">сработал <span className="font-semibold text-ink tabular-nums">{firedTotal.toLocaleString('ru')}</span> раз</span>
          </div>
          {signal && (
            <div className="mt-2">
              <button onClick={() => signalExpandable && setOpenKey(signalOpen ? null : 'signal')}
                className={cn('w-full flex items-center gap-1.5 text-[11.5px] text-subt px-2 py-1.5 rounded-lg text-left bg-black/[0.03]', signalExpandable && (signalOpen ? 'bg-black/[0.05]' : 'hover:bg-black/[0.05]'))}>
                <Filter className="w-3.5 h-3.5 text-[#6a7df9] shrink-0" />
                <span className="font-medium text-ink/70">Сигнал:</span> <span className="flex-1 truncate">{signal}</span>
                {signalExpandable && <ChevronDown className={cn('w-4 h-4 text-subt shrink-0 transition-transform', signalOpen && 'rotate-180')} />}
              </button>
              {signalOpen && (
                <div className="text-[11.5px] text-subt bg-black/[0.03] rounded-lg px-3 py-2.5 space-y-0.5 animate-fade-in mt-1">
                  <div className="font-medium text-ink/70">Реагирует на фразы{cond.exact ? ' (точное совпадение)' : ' (с опечатками)'}:</div>
                  <ul className="list-disc ml-4">{signalPhrases.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── БЛОК «ДЕЙСТВИЯ» — таблица: что делает + сработало/выполнено ── */}
      <div className="rounded-xl border border-ok/30 overflow-hidden">
        <div className="px-2.5 py-1 bg-ok/10 text-[10px] font-semibold uppercase tracking-wider text-ok flex items-center gap-1">
          Действия <Hint text="Что бот делает при срабатывании. «Сраб.» — сколько раз пытался, «Вып.» — сколько получилось. Нажми на строку — подробности." />
        </div>
        {rows.length === 0 ? (
          <div className="px-2.5 py-3 text-[11.5px] text-subt text-center">Действий нет</div>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_2.4rem_2.4rem] gap-x-2 px-2.5 py-1 text-[10px] text-subt/70 border-b border-line/40">
              <span>Действие</span>
              <span className="text-right">Сраб.</span>
              <span className="text-right">Вып.</span>
            </div>
            {rows.map((r) => {
              const isOpen = openKey === r.key
              const short = r.done < r.fired
              return (
                <div key={r.key} className="border-b border-line/30 last:border-0">
                  <button onClick={() => setOpenKey(isOpen ? null : r.key)}
                    className={cn('w-full grid grid-cols-[1fr_2.4rem_2.4rem] gap-x-2 items-center px-2.5 py-1.5 text-left transition-colors',
                      isOpen ? 'bg-black/[0.04]' : 'hover:bg-black/[0.03]')}>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: hexA(r.color, 0.12) }}>
                        <r.Icon className="w-3 h-3" style={{ color: r.color }} strokeWidth={2.4} />
                      </span>
                      <span className="text-[12px] truncate">{r.label}</span>
                      <ChevronDown className={cn('w-3.5 h-3.5 text-subt shrink-0 transition-transform', isOpen && 'rotate-180')} />
                    </span>
                    <span className="text-[12px] tabular-nums text-subt text-right">{r.fired}</span>
                    <span className={cn('text-[12px] tabular-nums font-semibold text-right', short ? 'text-bad' : r.done > 0 ? 'text-ok' : 'text-subt')}>{r.done}</span>
                  </button>
                  {isOpen && <div className="px-2.5 pb-2"><ActionDetail trigger={trigger} k={r.key} onEdit={onEdit} /></div>}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Футер */}
      <div className="flex items-center justify-between pt-1 border-t border-black/[0.04]">
        <button onClick={onEdit} className="flex items-center gap-1 text-[11.5px] text-subt hover:text-brand transition-colors">
          <Settings className="w-3.5 h-3.5" /> Изменить
        </button>
        <button onClick={onDelete} className="flex items-center gap-1 text-[11.5px] text-subt hover:text-bad transition-colors">
          <Trash2 className="w-3.5 h-3.5" /> Удалить
        </button>
      </div>
    </div>
  )
}

// ── Карточка аккаунта (уровень 1) ───────────────────────────────────────────
function AccountCard({ acc, campaigns, activeTypes, onOpen, index = 0 }: {
  acc: DbAccount; campaigns: DbTrigger[]; activeTypes: Set<string>; onOpen: () => void; index?: number
}) {
  const active = campaigns.filter((t) => t.isActive).length
  const paused = campaigns.length - active
  const fires = campaigns.reduce((s, t) => s + (t.fireCount ?? 0), 0)
  const ps = plateState(acc, active)
  const followers = acc.followers ?? acc.followerCount ?? 0
  const activeMetas = TRIG_META.filter((m) => activeTypes.has(m.db))
  return (
    <button onClick={onOpen}
      className={cn('group card card-3d rise text-left p-4 flex flex-col gap-3 w-full border', PLATE_STYLE[ps])}
      style={{ animationDelay: `${index * 70}ms` }}>
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-2xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white font-semibold shrink-0">
          {(acc.username?.[0] ?? '?').toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14px] truncate">@{acc.username}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn('w-1.5 h-1.5 rounded-full', PLATE_DOT[ps])} />
            <span className="text-[10.5px] text-subt">{PLATE_LABEL[ps]}</span>
            <SecurityBadge acc={acc} />
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-subt shrink-0" />
      </div>

      {/* Иконки триггеров: свёрнуто — только активные типы; при наведении раскрываются все */}
      <div className="min-h-[22px] flex items-center">
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {activeMetas.length
            ? activeMetas.map((m) => <TrigBadge key={m.key} meta={m} active size={22} tip={false} />)
            : <span className="text-[10.5px] text-subt">Нет активных триггеров</span>}
        </div>
        <div className="hidden group-hover:flex items-center gap-1.5">
          {TRIG_META.map((m) => <TrigBadge key={m.key} meta={m} active={activeTypes.has(m.db)} size={22} tip={false} />)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-canvas rounded-xl px-2 py-2 text-center">
          <div className="flex items-center justify-center gap-1 leading-none">
            <span className="text-[16px] font-semibold tracking-tighter text-ok">{active}</span>
            <span className="text-subt text-[12px]">/</span>
            <span className="text-[16px] font-semibold tracking-tighter text-subt">{paused}</span>
          </div>
          <div className="text-[10px] text-subt mt-1">Активн. · пауза</div>
        </div>
        <div className="bg-canvas rounded-xl px-2 py-2 text-center">
          <div className="text-[16px] font-semibold tracking-tighter leading-none">{followers.toLocaleString('ru')}</div>
          <div className="text-[10px] text-subt mt-1">Подписчиков</div>
        </div>
        <div className="bg-canvas rounded-xl px-2 py-2 text-center">
          <div className="text-[16px] font-semibold tracking-tighter leading-none text-ok">{fires.toLocaleString('ru')}</div>
          <div className="text-[10px] text-subt mt-1">Срабатываний</div>
        </div>
      </div>
    </button>
  )
}

// Диалог после сохранения правок (§D1): 1) включить/пауза → 2) обнулить/сохранить статистику.
// Закрытие окна (по фону) → статистика сохраняется по умолчанию.
function PostEditDialog({ name, onFinish }: { name: string; onFinish: (opts: { resume: boolean; reset: boolean }) => void }) {
  const [step, setStep] = useState<'power' | 'stats'>('power')
  const [resume, setResume] = useState(false)   // при закрытии на шаге power — остаётся на паузе (безопасно)
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={() => onFinish({ resume, reset: false })}>
      <div className="card w-full max-w-sm p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        {step === 'power' ? (
          <>
            <div className="font-semibold text-[16px] tracking-tight">Изменения сохранены</div>
            <div className="text-[13px] text-subt mt-1 leading-relaxed">Кампания «{name}» сейчас на паузе. Включить её обратно или оставить на паузе?</div>
            <div className="flex gap-2 mt-5">
              <Button variant="secondary" className="flex-1" onClick={() => { setResume(false); setStep('stats') }}>
                <PauseCircle className="w-4 h-4" /> На паузе
              </Button>
              <Button className="flex-1" onClick={() => { setResume(true); setStep('stats') }}>
                <Power className="w-4 h-4" /> Включить
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="font-semibold text-[16px] tracking-tight">Статистика кампании</div>
            <div className="text-[13px] text-subt mt-1 leading-relaxed">Обнулить статистику (срабатывания и счётчики действий) или продолжить накопленную? Закроете окно — статистика сохранится.</div>
            <div className="flex gap-2 mt-5">
              <Button variant="secondary" className="flex-1" onClick={() => onFinish({ resume, reset: false })}>Продолжить</Button>
              <Button variant="danger" className="flex-1" onClick={() => onFinish({ resume, reset: true })}>Обнулить</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Главный экран
// ════════════════════════════════════════════════════════════════════════════
function TriggersScreen() {
  const [dbAccounts, setDbAccounts] = useState<DbAccount[]>([])
  const [dbTriggers, setDbTriggers] = useState<DbTrigger[]>([])
  const [templates, setTemplates] = useState<DbTemplate[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [loadingTriggers, setLoadingTriggers] = useState(true)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [sections, setSections] = useState<SectionItem[]>([])
  const [selSection, setSelSection] = useState('')
  const [selSub, setSelSub] = useState('')

  const formApi = useRef<FormApi | null>(null)
  const [selId, setSelId] = useState<string | null>(null)

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    try { const res = await fetch('/api/accounts'); if (res.ok) setDbAccounts(await res.json()) } catch {}
    setLoadingAccounts(false)
  }, [])
  const loadTriggers = useCallback(async () => {
    setLoadingTriggers(true)
    try { const res = await fetch('/api/triggers'); if (res.ok) setDbTriggers(await res.json()) } catch {}
    setLoadingTriggers(false)
  }, [])
  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true)
    try { const res = await fetch('/api/templates'); if (res.ok) setTemplates(await res.json()) } catch {}
    setLoadingTemplates(false)
  }, [])
  const loadSections = useCallback(async () => {
    try { const res = await fetch('/api/sections'); if (res.ok) setSections(await res.json()) } catch {}
  }, [])

  useEffect(() => { loadAccounts(); loadTriggers(); loadTemplates(); loadSections() }, [loadAccounts, loadTriggers, loadTemplates, loadSections])

  // Открыть сразу конкретный аккаунт, если пришли со страницы «Аккаунты» (?account=<id>)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('account')
    if (p) setSelId(p)
  }, [])

  // Редактирование кампании (§D1) и подтверждения удаления (§D2)
  const [stopGate, setStopGate] = useState<DbTrigger | null>(null)   // «останови перед правкой»
  const [postEdit, setPostEdit] = useState<DbTrigger | null>(null)   // «включить/пауза + обнулить/сохранить»
  const [confirmDel, setConfirmDel] = useState<DbTrigger | null>(null)

  const deleteTrigger = async (id: string) => {
    await fetch(`/api/triggers/${id}`, { method: 'DELETE' })
    setDbTriggers((prev) => prev.filter((t) => t.id !== id))
  }
  const toggleTrigger = async (id: string, isActive: boolean) => {
    await fetch(`/api/triggers/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    setDbTriggers((prev) => prev.map((t) => t.id === id ? { ...t, isActive: !isActive } : t))
  }

  // Клик по «шестерёнке»: запущенную кампанию сначала просим остановить.
  const requestEditCampaign = (t: DbTrigger) => {
    if (t.isActive) setStopGate(t)
    else formApi.current?.edit(t)
  }
  const confirmStopAndEdit = async () => {
    const t = stopGate
    if (!t) return
    await fetch(`/api/triggers/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    }).catch(() => null)
    setDbTriggers((prev) => prev.map((x) => x.id === t.id ? { ...x, isActive: false } : x))
    setStopGate(null)
    formApi.current?.edit({ ...t, isActive: false })
  }
  // После сохранения правок — родитель спрашивает включить/пауза + обнулить/сохранить статистику.
  const onCampaignEdited = (id: string) => {
    setPostEdit(dbTriggers.find((t) => t.id === id) ?? null)
    loadTriggers()
  }
  const finishPostEdit = async ({ resume, reset }: { resume: boolean; reset: boolean }) => {
    const t = postEdit
    setPostEdit(null)
    if (!t) return
    await fetch(`/api/triggers/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: resume, ...(reset ? { resetStats: true } : {}) }),
    }).catch(() => null)
    loadTriggers()
  }
  const doDeleteCampaign = async () => {
    const t = confirmDel
    setConfirmDel(null)
    if (t) await deleteTrigger(t.id)
  }
  const deleteTemplate = async (id: string) => {
    await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  const totalFires = dbTriggers.reduce((s, t) => s + (t.fireCount ?? 0), 0)
  const campaignsFor = (id: string) => dbTriggers.filter((t) => t.responder?.id === id)
  const activeByAccount = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const t of dbTriggers) {
      if (!t.isActive) continue
      if (!m.has(t.responder.id)) m.set(t.responder.id, new Set())
      m.get(t.responder.id)!.add(t.triggerType)
    }
    return m
  }, [dbTriggers])

  const selAcc = selId ? dbAccounts.find((a) => a.id === selId) : null
  const selCampaigns = selId ? campaignsFor(selId) : []

  // Хлебные крошки в шапке: «Рекламные кампании / @аккаунт» при провале внутрь
  const { setCrumbs } = useBreadcrumbs()
  const selUsername = selAcc?.username
  useEffect(() => {
    if (selId && selUsername) {
      setCrumbs([
        { label: 'Рекламные кампании', onClick: () => setSelId(null) },
        { label: '@' + selUsername },
      ])
    } else {
      setCrumbs([])
    }
    return () => setCrumbs([])
  }, [selId, selUsername, setCrumbs])

  // Фильтр аккаунтов по выбранному разделу/подразделу (план §C2)
  const childIds = useMemo(
    () => new Set(sections.filter((s) => s.parentId === selSection).map((s) => s.id)),
    [sections, selSection]
  )
  const visibleAccounts = useMemo(() => {
    if (!selSection) return dbAccounts
    if (selSub) return dbAccounts.filter((a) => a.sectionId === selSub)
    return dbAccounts.filter((a) => a.sectionId === selSection || childIds.has(a.sectionId ?? ''))
  }, [dbAccounts, selSection, selSub, childIds])

  const templatesBtn = (
    <button onClick={() => { setShowTemplates(true); loadTemplates() }}
      className="flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-xl bg-black/[0.05] text-ink hover:bg-black/[0.08] transition-colors">
      <FileText className="w-3.5 h-3.5" /> Шаблоны
    </button>
  )

  // ── Уровень 2: кампании выбранного аккаунта ────────────────────────────────
  if (selAcc) {
    const active = selCampaigns.filter((t) => t.isActive).length
    const fires = selCampaigns.reduce((s, t) => s + (t.fireCount ?? 0), 0)
    const followers = selAcc.followers ?? selAcc.followerCount ?? 0
    return (
      <div className="space-y-5 pb-24">
        {/* Хлебные крошки */}
        <div className="flex items-center gap-2 text-[13px]">
          <button onClick={() => setSelId(null)} className="flex items-center gap-1.5 text-subt hover:text-ink transition-colors">
            <ArrowLeft className="w-4 h-4" /> Аккаунты
          </button>
          <span className="text-line">/</span>
          <span className="font-medium text-ink">@{selAcc.username}</span>
        </div>

        {/* Шапка аккаунта */}
        <div className="card gloss p-5 flex items-center gap-4">
          <span className="w-14 h-14 rounded-3xl bg-gradient-to-br from-[#feda75] via-[#d62976] to-[#4f5bd5] flex items-center justify-center text-white text-[22px] font-semibold shrink-0">
            {(selAcc.username?.[0] ?? '?').toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[18px] tracking-tight truncate">@{selAcc.username}</div>
            <div className="text-[12px] text-subt">{PLATE_LABEL[plateState(selAcc, active)]}</div>
          </div>
          <div className="hidden sm:grid grid-cols-3 gap-3">
            {[['Кампаний', selCampaigns.length], ['Подписчиков', followers], ['Срабатываний', fires]].map(([l, v]) => (
              <div key={l} className="text-center px-3">
                <div className="text-[20px] font-semibold tracking-tighter leading-none">{Number(v).toLocaleString('ru')}</div>
                <div className="text-[11px] text-subt mt-1">{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Кампании */}
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold text-subt uppercase tracking-wider">Кампании ({selCampaigns.length})</div>
          <div className="flex items-center gap-2">
            {templatesBtn}
            <Button size="sm" onClick={() => formApi.current?.openFor(selAcc.id)}>
              <Plus className="w-3.5 h-3.5" /> Кампания
            </Button>
          </div>
        </div>

        {selCampaigns.length === 0 ? (
          <div className="card py-12 flex flex-col items-center gap-3 text-center px-6">
            <div className="w-14 h-14 rounded-3xl bg-brand/8 flex items-center justify-center"><Zap className="w-7 h-7 text-brand/50" /></div>
            <div className="font-semibold text-[15px] text-ink/70">Кампаний пока нет</div>
            <div className="text-[13px] text-subt max-w-xs">Нажми «Кампания», чтобы запустить рекламную кампанию на этом аккаунте</div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {selCampaigns.map((t, i) => (
              <CampaignCard key={t.id} trigger={t} index={i}
                onToggle={() => toggleTrigger(t.id, t.isActive)}
                onEdit={() => requestEditCampaign(t)}
                onDelete={() => setConfirmDel(t)} />
            ))}
          </div>
        )}

        <CreateForm
          dbAccounts={dbAccounts}
          dbTriggers={dbTriggers}
          loadingAccounts={loadingAccounts}
          onCreated={() => { loadTriggers(); loadTemplates() }}
          onEdited={onCampaignEdited}
          formRef={formApi}
          lockedAccountId={selAcc.id}
        />

        {showTemplates && (
          <TemplatesDrawer templates={templates} loading={loadingTemplates}
            onClose={() => setShowTemplates(false)} onApply={(d) => formApi.current?.load(d)}
            onDelete={deleteTemplate} onReload={loadTemplates} />
        )}

        <ConfirmDialog
          open={Boolean(stopGate)}
          danger={false}
          title="Сначала остановить кампанию"
          message={`«${stopGate?.name ?? ''}» сейчас запущена. Редактировать можно только остановленную кампанию — остановить и открыть редактирование?`}
          confirmLabel="Остановить и редактировать"
          cancelLabel="Отмена"
          onConfirm={confirmStopAndEdit}
          onCancel={() => setStopGate(null)}
        />
        {postEdit && <PostEditDialog name={postEdit.name} onFinish={finishPostEdit} />}
        <ConfirmDialog
          open={Boolean(confirmDel)}
          title="Удалить кампанию?"
          message={`«${confirmDel?.name ?? ''}» и её статистика будут удалены безвозвратно.`}
          confirmLabel="Удалить"
          onConfirm={doDeleteCampaign}
          onCancel={() => setConfirmDel(null)}
        />
      </div>
    )
  }

  // ── Уровень 1: главный экран ───────────────────────────────────────────────
  // Порядок (план B2): 1) создание кампании — наверх; 2) аккаунты; 3) «+ Аккаунт» → попап; 4) сводка.
  return (
    <div className="space-y-5 pb-24">
      {/* 1. Создание кампании — главное действие (раскрыто по умолчанию) */}
      <div>
        <CreateForm
          dbAccounts={dbAccounts}
          dbTriggers={dbTriggers}
          loadingAccounts={loadingAccounts}
          onCreated={() => { loadTriggers(); loadTemplates() }}
          onEdited={onCampaignEdited}
          formRef={formApi}
          startOpen
        />
      </div>

      {/* 2. Аккаунты */}
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-brand" />
          <span className="font-semibold text-[15px]">Аккаунты</span>
          <span className="text-[12px] text-subt">({visibleAccounts.length}{visibleAccounts.length !== dbAccounts.length ? ` из ${dbAccounts.length}` : ''})</span>
          <Hint text="Нажми на аккаунт, чтобы провалиться в его рекламные кампании" />
        </div>
        <div className="flex items-center gap-2">
          {templatesBtn}
          <button onClick={() => { loadAccounts(); loadTriggers(); loadSections() }} className="p-1.5 text-subt hover:text-ink transition-colors" title="Обновить">
            <RefreshCw className={cn('w-4 h-4', (loadingAccounts || loadingTriggers) && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Статистика черновых (без баннера — предупреждение живёт на вкладке «Аккаунты») */}
      <DraftsStatus showBanner={false} />

      {/* Разделы/подразделы (папки) + фильтр — план §C2 */}
      <div data-tour="sections">
        <SectionBar sections={sections} selSection={selSection} selSub={selSub}
          onSelect={(sec, sub) => { setSelSection(sec); setSelSub(sub) }} onReload={loadSections} />
      </div>

      {loadingAccounts ? (
        <div className="card py-12 text-center text-subt text-[13px]">Загрузка…</div>
      ) : dbAccounts.length === 0 ? (
        <div className="card py-14 flex flex-col items-center gap-3 text-center px-6">
          <div className="w-14 h-14 rounded-3xl bg-brand/8 flex items-center justify-center"><Users className="w-7 h-7 text-brand/50" /></div>
          <div className="font-semibold text-[16px] tracking-tight text-ink/70">Нет аккаунтов</div>
          <div className="text-[13px] text-subt max-w-xs">Подключите первый аккаунт, чтобы запускать по нему кампании</div>
          <span data-tour="add-account">
            <Button size="sm" className="mt-1" onClick={() => setShowAdd(true)}>
              <Plus className="w-3.5 h-3.5" /> Аккаунт
            </Button>
          </span>
        </div>
      ) : visibleAccounts.length === 0 ? (
        <div className="card py-12 flex flex-col items-center gap-2 text-center px-6">
          <div className="text-[13px] text-subt">В этом разделе пока нет аккаунтов</div>
          <button onClick={() => { setSelSection(''); setSelSub('') }} className="text-[12.5px] text-brand hover:underline">Показать все</button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleAccounts.map((acc, i) => (
            <AccountCard key={acc.id} acc={acc} index={i}
              campaigns={campaignsFor(acc.id)}
              activeTypes={activeByAccount.get(acc.id) ?? new Set<string>()}
              onOpen={() => setSelId(acc.id)} />
          ))}
        </div>
      )}

      {/* 3. «+ Аккаунт» — под списком, открывает попап (не уводит на вкладку) */}
      {!loadingAccounts && dbAccounts.length > 0 && (
        <button onClick={() => setShowAdd(true)} data-tour="add-account"
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-3xl border border-dashed border-line text-subt hover:text-brand hover:border-brand/50 hover:bg-brand/[0.03] transition-colors text-[13.5px] font-medium">
          <Plus className="w-4 h-4" /> Аккаунт
        </button>
      )}

      {/* 4. Сводка */}
      <div className="grid grid-cols-3 gap-3 pt-1">
        <StatCard icon={Users} color="#663af1" value={dbAccounts.length} label="Аккаунтов" tip="Всего подключённых Instagram-аккаунтов" delay={0} />
        <StatCard icon={Zap} color="#6a7df9" value={dbTriggers.length} label="Кампаний" tip="Всего рекламных кампаний по всем аккаунтам" delay={90} />
        <StatCard icon={Send} color="#34c759" value={totalFires} label="Срабатываний" tip="Сколько раз кампании сработали (поймано событий) по всем аккаунтам. Сколько действий реально выполнено — на вкладке «Статистика» и в деталях кампании." delay={180} />
      </div>

      {showTemplates && (
        <TemplatesDrawer templates={templates} loading={loadingTemplates}
          onClose={() => setShowTemplates(false)} onApply={(d) => formApi.current?.load(d)}
          onDelete={deleteTemplate} onReload={loadTemplates} />
      )}

      {showAdd && (
        <AddAccountModal onClose={() => setShowAdd(false)}
          onAdded={() => { loadAccounts(); loadTriggers(); loadSections() }} />
      )}
    </div>
  )
}

export default function Page() {
  return <ClientOnly><TriggersScreen /></ClientOnly>
}

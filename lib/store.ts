'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ---------- Types ----------

export type AccountStatus = 'ACTIVE' | 'PAUSED' | 'BLOCKED'

export interface Account {
  id: string
  username: string
  fullName?: string
  followers: number
  status: AccountStatus
  createdAt: string
}

export type TriggerType = 'FOLLOW' | 'COMMENT' | 'LIKE' | 'STORY_REPLY'
export type ConditionType = 'KEYWORDS' | 'USERNAME_LIST' | 'MIN_FOLLOWERS'

export interface Condition {
  type: ConditionType
  value: string
}

export interface TriggerAccount {
  accountId: string
  active: boolean
  runs: number
  errors: number
}

export interface Trigger {
  id: string
  name: string
  accounts: TriggerAccount[]
  type: TriggerType
  conditions: Condition[]
  message: string
  delayMin: number
  delayMax: number
  createdAt: string
}

export interface Response {
  id: string
  triggerId: string
  accountId: string
  target: string
  message: string
  timestamp: string
}

export interface Template {
  id: string
  name: string
  content: string
}

export type ProxyStatus = 'CHECKING' | 'CONNECTED' | 'ERROR'

export interface Proxy {
  id: string
  raw: string
  protocol: 'http' | 'socks5'
  host: string
  port: number
  username?: string
  password?: string
  status: ProxyStatus
  latency?: number
  createdAt: string
}

export interface DraftAccount {
  id: string
  username: string
  proxyId?: string
  createdAt: string
}

export type LogLevel = 'SUCCESS' | 'INFO' | 'ERROR'

export interface LogEntry {
  id: string
  timestamp: string
  account: string
  level: LogLevel
  message: string
}

// ---------- Labels & helpers ----------

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  FOLLOW: 'Новая подписка',
  COMMENT: 'Комментарий',
  LIKE: 'Лайк',
  STORY_REPLY: 'Ответ на сторис',
}

export const TRIGGER_DESC: Record<TriggerType, string> = {
  FOLLOW: 'Основной триггер — ответ новым подписчикам',
  COMMENT: 'Реакция на комментарии под постами',
  LIKE: 'Когда кто-то ставит лайк',
  STORY_REPLY: 'Когда отвечают на вашу историю',
}

export const CONDITION_LABELS: Record<ConditionType, string> = {
  KEYWORDS: 'Содержит ключевые слова',
  USERNAME_LIST: 'Username из списка',
  MIN_FOLLOWERS: 'Минимум подписчиков',
}

export function formatFollowers(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace('.0', '') + 'K'
  return String(n)
}

export const triggerRuns = (t: Trigger) => t.accounts.reduce((s, a) => s + a.runs, 0)
export const triggerErrors = (t: Trigger) => t.accounts.reduce((s, a) => s + a.errors, 0)
export const triggerIsActive = (t: Trigger) => t.accounts.some((a) => a.active)

const uid = () => Math.random().toString(36).slice(2, 10)

const NAME_POOL = ['alex', 'maria', 'dmitry', 'kate', 'ivan', 'sofia', 'max', 'lena', 'nick', 'olga', 'andrew', 'julia', 'pavel', 'anna']
const randomUser = () => '@' + NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)] + '_' + Math.floor(1000 + Math.random() * 8999)

/** Parse a proxy string in common formats. */
export function parseProxy(raw: string): Omit<Proxy, 'id' | 'status' | 'createdAt'> | null {
  let s = raw.trim()
  if (!s) return null
  let protocol: 'http' | 'socks5' = 'http'
  const schemeMatch = s.match(/^(https?|socks5):\/\//i)
  if (schemeMatch) {
    protocol = schemeMatch[1].toLowerCase().startsWith('socks') ? 'socks5' : 'http'
    s = s.replace(/^[a-z0-9]+:\/\//i, '')
  }
  let username: string | undefined
  let password: string | undefined
  let host: string
  let portStr: string

  if (s.includes('@')) {
    // user:pass@host:port
    const [cred, hostPart] = s.split('@')
    const [u, p] = cred.split(':')
    username = u; password = p
    const hp = hostPart.split(':')
    host = hp[0]; portStr = hp[1]
  } else {
    const parts = s.split(':')
    host = parts[0]; portStr = parts[1]
    if (parts.length >= 4) { username = parts[2]; password = parts[3] }
  }

  const port = parseInt(portStr, 10)
  if (!host || !port || isNaN(port)) return null
  return { raw, protocol, host, port, username, password }
}

// ---------- Store ----------

interface StoreState {
  accounts: Account[]
  triggers: Trigger[]
  responses: Response[]
  templates: Template[]
  proxies: Proxy[]
  draftAccounts: DraftAccount[]
  logs: LogEntry[]

  addAccount: (a: Pick<Account, 'username' | 'fullName' | 'followers'>) => void
  removeAccount: (id: string) => void
  toggleAccountStatus: (id: string) => void

  addTrigger: (t: Omit<Trigger, 'id' | 'createdAt' | 'accounts'> & { accountIds: string[] }) => void
  removeTrigger: (id: string) => void
  toggleTriggerAccount: (triggerId: string, accountId: string) => void
  setTriggerAccountsActive: (triggerId: string, active: boolean) => void

  addProxy: (raw: string) => string | null
  updateProxy: (id: string, patch: Partial<Proxy>) => void
  removeProxy: (id: string) => void
  addDraftAccount: (username: string, proxyId?: string) => void
  removeDraftAccount: (id: string) => void
  assignProxy: (draftId: string, proxyId?: string) => void

  tick: () => void
  log: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void
  clearLogs: () => void
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      accounts: [],
      triggers: [],
      responses: [],
      templates: [
        { id: 'tpl1', name: 'Приветствие', content: 'Привет, @{{username}}! Вижу, ты заинтересован в наших мероприятиях. Скажи, чем могу помочь? 🙌' },
        { id: 'tpl2', name: 'Ответ на комментарий', content: 'Спасибо за интерес! Написал детали в личные сообщения 💬' },
        { id: 'tpl3', name: 'Follow-up', content: 'Ещё раз привет! Подскажи, остались ли вопросы?' },
      ],
      proxies: [],
      draftAccounts: [],
      logs: [],

      addAccount: (a) =>
        set((s) => {
          get().log({ account: `@${a.username}`, level: 'SUCCESS', message: 'Аккаунт подключён' })
          return { accounts: [...s.accounts, { ...a, id: uid(), status: 'ACTIVE', createdAt: new Date().toISOString() }] }
        }),
      removeAccount: (id) =>
        set((s) => ({
          accounts: s.accounts.filter((x) => x.id !== id),
          triggers: s.triggers.map((t) => ({ ...t, accounts: t.accounts.filter((a) => a.accountId !== id) })),
        })),
      toggleAccountStatus: (id) =>
        set((s) => ({
          accounts: s.accounts.map((x) => (x.id === id ? { ...x, status: x.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } : x)),
        })),

      addTrigger: ({ accountIds, ...t }) =>
        set((s) => {
          get().log({ account: 'system', level: 'SUCCESS', message: `Запущен триггер «${t.name}» на ${accountIds.length} акк.` })
          return {
            triggers: [
              ...s.triggers,
              { ...t, id: uid(), createdAt: new Date().toISOString(), accounts: accountIds.map((accountId) => ({ accountId, active: true, runs: 0, errors: 0 })) },
            ],
          }
        }),
      removeTrigger: (id) =>
        set((s) => ({ triggers: s.triggers.filter((x) => x.id !== id), responses: s.responses.filter((r) => r.triggerId !== id) })),
      toggleTriggerAccount: (triggerId, accountId) =>
        set((s) => ({
          triggers: s.triggers.map((t) =>
            t.id === triggerId ? { ...t, accounts: t.accounts.map((a) => (a.accountId === accountId ? { ...a, active: !a.active } : a)) } : t
          ),
        })),
      setTriggerAccountsActive: (triggerId, active) =>
        set((s) => ({
          triggers: s.triggers.map((t) => (t.id === triggerId ? { ...t, accounts: t.accounts.map((a) => ({ ...a, active })) } : t)),
        })),

      addProxy: (raw) => {
        const parsed = parseProxy(raw)
        if (!parsed) return null
        const id = uid()
        set((s) => ({ proxies: [...s.proxies, { ...parsed, id, status: 'CHECKING', createdAt: new Date().toISOString() }] }))
        return id
      },
      updateProxy: (id, patch) => set((s) => ({ proxies: s.proxies.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removeProxy: (id) =>
        set((s) => ({
          proxies: s.proxies.filter((p) => p.id !== id),
          draftAccounts: s.draftAccounts.map((d) => (d.proxyId === id ? { ...d, proxyId: undefined } : d)),
        })),
      addDraftAccount: (username, proxyId) =>
        set((s) => ({ draftAccounts: [...s.draftAccounts, { id: uid(), username: username.replace(/^@/, ''), proxyId, createdAt: new Date().toISOString() }] })),
      removeDraftAccount: (id) => set((s) => ({ draftAccounts: s.draftAccounts.filter((d) => d.id !== id) })),
      assignProxy: (draftId, proxyId) =>
        set((s) => ({ draftAccounts: s.draftAccounts.map((d) => (d.id === draftId ? { ...d, proxyId } : d)) })),

      tick: () =>
        set((s) => {
          if (!s.triggers.some(triggerIsActive)) return {}
          const newResponses = [...s.responses]
          const newLogs = [...s.logs]
          const triggers = s.triggers.map((t) => {
            if (!triggerIsActive(t)) return t
            const accounts = t.accounts.map((a) => {
              if (a.active && Math.random() < 0.45) {
                const target = randomUser()
                const acc = s.accounts.find((x) => x.id === a.accountId)
                newResponses.unshift({ id: uid(), triggerId: t.id, accountId: a.accountId, target, message: t.message, timestamp: new Date().toISOString() })
                newLogs.unshift({ id: uid(), timestamp: new Date().toISOString(), account: acc ? `@${acc.username}` : '@—', level: 'SUCCESS', message: `Ответ отправлен ${target}` })
                return { ...a, runs: a.runs + 1 }
              }
              return a
            })
            return { ...t, accounts }
          })
          return { triggers, responses: newResponses.slice(0, 300), logs: newLogs.slice(0, 80) }
        }),

      log: (entry) => set((s) => ({ logs: [{ ...entry, id: uid(), timestamp: new Date().toISOString() }, ...s.logs].slice(0, 80) })),
      clearLogs: () => set({ logs: [] }),
    }),
    {
      name: 'instaguard-store',
      version: 4,
      migrate: () => ({}) as Partial<StoreState>,
    }
  )
)

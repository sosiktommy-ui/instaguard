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
  proxy?: string
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

// Derived helpers
export const triggerRuns = (t: Trigger) => t.accounts.reduce((s, a) => s + a.runs, 0)
export const triggerErrors = (t: Trigger) => t.accounts.reduce((s, a) => s + a.errors, 0)
export const triggerIsActive = (t: Trigger) => t.accounts.some((a) => a.active)

export interface Template {
  id: string
  name: string
  content: string
}

export type LogLevel = 'SUCCESS' | 'INFO' | 'ERROR'

export interface LogEntry {
  id: string
  timestamp: string
  account: string
  level: LogLevel
  message: string
}

// ---------- Labels ----------

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

const uid = () => Math.random().toString(36).slice(2, 10)

// ---------- Seed ----------

const seedAccounts: Account[] = [
  { id: 'a1', username: 'premium.brand', fullName: 'Premium Brand', followers: 184200, status: 'ACTIVE', createdAt: new Date().toISOString() },
  { id: 'a2', username: 'lifestyle.daily', fullName: 'Lifestyle Daily', followers: 92500, status: 'ACTIVE', createdAt: new Date().toISOString() },
  { id: 'a3', username: 'fit.coach.ru', fullName: 'Fit Coach', followers: 47800, status: 'ACTIVE', createdAt: new Date().toISOString() },
]

const seedTriggers: Trigger[] = [
  {
    id: 't1',
    name: 'Приветствие новым подписчикам',
    accounts: [
      { accountId: 'a1', active: true, runs: 1240, errors: 12 },
      { accountId: 'a2', active: true, runs: 640, errors: 3 },
      { accountId: 'a3', active: false, runs: 210, errors: 1 },
    ],
    type: 'FOLLOW',
    conditions: [],
    message: 'Привет, @{{username}}! Вижу, ты заинтересован в наших мероприятиях. Скажи, чем могу помочь? 🙌',
    delayMin: 45,
    delayMax: 180,
    createdAt: new Date().toISOString(),
  },
  {
    id: 't2',
    name: 'Ответ на вопрос в комментариях',
    accounts: [
      { accountId: 'a1', active: true, runs: 500, errors: 2 },
      { accountId: 'a2', active: false, runs: 370, errors: 2 },
    ],
    type: 'COMMENT',
    conditions: [{ type: 'KEYWORDS', value: 'цена, сколько, купить' }],
    message: 'Спасибо за интерес! Написал детали в личные сообщения 💬',
    delayMin: 30,
    delayMax: 120,
    createdAt: new Date().toISOString(),
  },
]

const seedTemplates: Template[] = [
  { id: 'tpl1', name: 'Приветствие', content: 'Привет, @{{username}}! Спасибо, что подписался 🙌' },
  { id: 'tpl2', name: 'Ответ на комментарий', content: 'Рад, что понравилось! 🔥 Есть вопросы по продукту?' },
  { id: 'tpl3', name: 'Follow-up', content: 'Ещё раз привет! Интересует что-то конкретное?' },
]

const seedLogs: LogEntry[] = [
  { id: uid(), timestamp: new Date().toISOString(), account: '@premium.brand', level: 'SUCCESS', message: 'Отправлено приветствие новому подписчику @user_3924' },
  { id: uid(), timestamp: new Date(Date.now() - 60000).toISOString(), account: '@lifestyle.daily', level: 'SUCCESS', message: 'Ответ на комментарий @maria_k отправлен' },
  { id: uid(), timestamp: new Date(Date.now() - 180000).toISOString(), account: '@premium.brand', level: 'INFO', message: 'Обнаружен новый подписчик @alex.travel' },
  { id: uid(), timestamp: new Date(Date.now() - 420000).toISOString(), account: '@fit.coach.ru', level: 'ERROR', message: 'Instagram rate limit. Пауза 180 сек' },
]

// ---------- Store ----------

interface StoreState {
  accounts: Account[]
  triggers: Trigger[]
  templates: Template[]
  logs: LogEntry[]

  addAccount: (a: Pick<Account, 'username' | 'fullName' | 'followers'>) => void
  removeAccount: (id: string) => void
  toggleAccountStatus: (id: string) => void

  addTrigger: (t: Omit<Trigger, 'id' | 'createdAt' | 'accounts'> & { accountIds: string[] }) => void
  removeTrigger: (id: string) => void
  toggleTriggerAccount: (triggerId: string, accountId: string) => void
  setTriggerAccountsActive: (triggerId: string, active: boolean) => void

  log: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void
  clearLogs: () => void
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      accounts: seedAccounts,
      triggers: seedTriggers,
      templates: seedTemplates,
      logs: seedLogs,

      addAccount: (a) =>
        set((s) => {
          get().log({ account: `@${a.username}`, level: 'SUCCESS', message: 'Аккаунт подключён' })
          return {
            accounts: [
              ...s.accounts,
              { ...a, id: uid(), status: 'ACTIVE', createdAt: new Date().toISOString() },
            ],
          }
        }),
      removeAccount: (id) =>
        set((s) => ({
          accounts: s.accounts.filter((x) => x.id !== id),
          triggers: s.triggers.map((t) => ({ ...t, accounts: t.accounts.filter((a) => a.accountId !== id) })),
        })),
      toggleAccountStatus: (id) =>
        set((s) => ({
          accounts: s.accounts.map((x) =>
            x.id === id ? { ...x, status: x.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } : x
          ),
        })),

      addTrigger: ({ accountIds, ...t }) =>
        set((s) => {
          get().log({ account: 'system', level: 'SUCCESS', message: `Запущен триггер «${t.name}» на ${accountIds.length} акк.` })
          return {
            triggers: [
              ...s.triggers,
              {
                ...t,
                id: uid(),
                createdAt: new Date().toISOString(),
                accounts: accountIds.map((accountId) => ({ accountId, active: true, runs: 0, errors: 0 })),
              },
            ],
          }
        }),
      removeTrigger: (id) => set((s) => ({ triggers: s.triggers.filter((x) => x.id !== id) })),
      toggleTriggerAccount: (triggerId, accountId) =>
        set((s) => ({
          triggers: s.triggers.map((t) =>
            t.id === triggerId
              ? { ...t, accounts: t.accounts.map((a) => (a.accountId === accountId ? { ...a, active: !a.active } : a)) }
              : t
          ),
        })),
      setTriggerAccountsActive: (triggerId, active) =>
        set((s) => ({
          triggers: s.triggers.map((t) =>
            t.id === triggerId ? { ...t, accounts: t.accounts.map((a) => ({ ...a, active })) } : t
          ),
        })),

      log: (entry) =>
        set((s) => ({
          logs: [{ ...entry, id: uid(), timestamp: new Date().toISOString() }, ...s.logs].slice(0, 60),
        })),
      clearLogs: () => set({ logs: [] }),
    }),
    {
      name: 'instaguard-store',
      version: 3,
      // Schema changed incompatibly between versions → discard stale persisted state.
      migrate: () => ({}) as Partial<StoreState>,
    }
  )
)

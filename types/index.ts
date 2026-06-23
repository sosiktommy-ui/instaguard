export type { User, InstagramAccount, TriggerRule, Template, Log, Event, Snapshot } from '@prisma/client';

export type AccountRole = 'RESPONDER' | 'HELPER' | 'BOTH';
export type AccountStatus = 'ACTIVE' | 'PAUSED' | 'BLOCKED' | 'CHALLENGE';
export type EventType = 'NEW_FOLLOWER' | 'NEW_COMMENT' | 'NEW_LIKE' | 'NEW_DIRECT_MESSAGE' | 'STORY_MENTION';
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface TriggerConditions {
  keywords?: string[];
  regex?: string;
  whitelist?: string[];
  blacklist?: string[];
  minFollowers?: number;
  maxFollowers?: number;
  timeWindow?: { from: string; to: string };
}

export interface TriggerAction {
  type: 'SEND_MESSAGE' | 'FOLLOW' | 'LIKE_LAST_POST';
  templates?: string[];
  delay?: { min: number; max: number };
}

export interface AccountLimits {
  hourlyLimit?: number;
  dailyLimit?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

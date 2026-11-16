import type { D1Database, Env } from '../env';
import { HttpError } from '../http';
import type { AiKind } from './types';

/**
 * The daily limit. Every AI call is counted before it is made, by kind and by
 * day (UTC). A call over the limit is refused without reaching the provider,
 * so a leaked app key cannot run up a bill.
 *
 * The counts hold no personal data, only numbers. "Erase" leaves them alone:
 * otherwise erasing would also reset the limit.
 */

/** Calls allowed per day across all kinds, unless AI_DAILY_LIMIT says otherwise. */
export const DEFAULT_DAILY_LIMIT = 120;

export interface Today {
  /** Calls made today, all kinds together. */
  used: number;
  limit: number;
}

export function dayOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function overallLimit(env: Env): number {
  const set = Number(env.AI_DAILY_LIMIT);
  return Number.isInteger(set) && set >= 0 ? set : DEFAULT_DAILY_LIMIT;
}

export async function usedToday(db: D1Database, now: Date): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(SUM(calls), 0) AS calls FROM ai_usage WHERE day = ?`).bind(dayOf(now)).first<{ calls: number }>();
  return row?.calls ?? 0;
}

/** Counts one call, or throws when today's limit for the kind or for everything is used up. */
export async function countCall(env: Env, kind: AiKind, now: Date): Promise<Today> {
  const day = dayOf(now);
  const limit = overallLimit(env);
  const rows = await env.DB.prepare(`SELECT kind, calls FROM ai_usage WHERE day = ?`).bind(day).all<{ kind: string; calls: number }>();
  const total = rows.results.reduce((sum, row) => sum + row.calls, 0);
  const ofKind = rows.results.find((row) => row.kind === kind.name)?.calls ?? 0;
  if (total >= limit || ofKind >= kind.dailyLimit) {
    throw new HttpError(429, 'Today\'s limit for AI requests is used up. It starts again tomorrow.', {
      code: 'daily-limit',
      today: { used: total, limit },
    });
  }
  await env.DB.prepare(
    `INSERT INTO ai_usage (day, kind, calls, input_tokens, output_tokens) VALUES (?, ?, 1, 0, 0)
     ON CONFLICT (day, kind) DO UPDATE SET calls = calls + 1`,
  )
    .bind(day, kind.name)
    .run();
  return { used: total + 1, limit };
}

/** Adds what a finished call cost, so the owner can see it. */
export async function recordTokens(db: D1Database, kind: AiKind, now: Date, inputTokens: number, outputTokens: number): Promise<void> {
  await db
    .prepare(`UPDATE ai_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE day = ? AND kind = ?`)
    .bind(inputTokens, outputTokens, dayOf(now), kind.name)
    .run();
}

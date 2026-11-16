import { callServer, ServerError } from './server';

/**
 * AI requests. They go to the small server, which holds the provider's key
 * and passes on only a few fixed kinds of request (server/ai). The app never
 * holds the key and never talks to the provider itself.
 */

export interface AiToday {
  /** Calls made today, all kinds together. */
  used: number;
  limit: number;
}

export interface AiAnswer<T> {
  result: T;
  /** The model that answered. */
  model: string;
  today: AiToday;
}

export interface AiStatus {
  /** False until the AI key is set in Cloudflare. */
  ready: boolean;
  kinds: { name: string; model: string; dailyLimit: number }[];
  today: AiToday;
}

/** Why an AI request failed, when the server said. */
export type AiErrorCode = 'no-ai-key' | 'daily-limit' | 'refused' | 'ai-failed' | 'ai-busy' | 'ai-key-rejected' | 'unknown-kind';

/**
 * Sends one request of a fixed kind and returns the model's answer.
 * Throws a ServerError. Its `body.code` says why, see AiErrorCode.
 */
export async function readWithAi<T>(kind: string, body: unknown): Promise<AiAnswer<T>> {
  const response = await callServer(`/ai/${kind}`, { method: 'POST', body });
  const answer = (await response.json()) as AiAnswer<T>;
  return { result: answer.result, model: answer.model, today: answer.today };
}

export async function getAiStatus(): Promise<AiStatus> {
  return (await (await callServer('/ai')).json()) as AiStatus;
}

export function aiErrorCode(error: unknown): AiErrorCode | undefined {
  return error instanceof ServerError && typeof error.body.code === 'string' ? (error.body.code as AiErrorCode) : undefined;
}

/** A failed AI request in words for the owner. */
export function aiErrorMessage(error: unknown): string {
  if (!(error instanceof ServerError)) return 'The AI request did not work. Try again.';
  if (error.status === 0) return error.message;
  switch (aiErrorCode(error)) {
    case 'no-ai-key':
      return 'AI is not set up on your server yet. Fill in the tags by hand, or add the AI key in Cloudflare (Settings has the steps).';
    case 'daily-limit':
      return "Today's limit for AI requests is used up. Fill in the tags by hand, or try again tomorrow.";
    case 'refused':
      return 'The AI model declined to read this one. Fill in the tags by hand.';
    default:
      // A server from before the AI route answers 404 with no code.
      if (error.status === 404) return 'Your server does not have the AI route yet. It arrives with the next update.';
      return error.message;
  }
}

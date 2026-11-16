import type { Env, Fetch } from '../env';
import { HttpError, json, readJson } from '../http';
import { callClaude, hasAiKey, modelFor, textOf } from './claude';
import { KINDS } from './kinds';
import { countCall, overallLimit, recordTokens, usedToday } from './usage';

/**
 * AI requests. The server holds the provider's key and passes on only the
 * fixed kinds of request listed in kinds.ts.
 *
 * It keeps nothing of what passes through: no photo, no page text, no answer.
 * Only the day's counts are stored.
 */

/** GET /api/ai: whether AI is set up, what it can do, and today's count. */
export async function aiStatus(env: Env, now: Date): Promise<Response> {
  return json({
    ready: hasAiKey(env),
    kinds: KINDS.map((kind) => ({ name: kind.name, model: modelFor(env, kind), dailyLimit: kind.dailyLimit })),
    today: { used: await usedToday(env.DB, now), limit: overallLimit(env) },
  });
}

/** POST /api/ai/:kind, with that kind's data as JSON. */
export async function postAi(env: Env, fetcher: Fetch, name: string, request: Request, now: Date): Promise<Response> {
  const kind = KINDS.find((k) => k.name === name);
  if (!kind) throw new HttpError(404, 'The server does not know that kind of AI request.', { code: 'unknown-kind' });
  if (!hasAiKey(env)) throw new HttpError(503, 'The server has no AI key yet.', { code: 'no-ai-key' });

  // Check the request before counting it, so a bad one costs nothing.
  const content = kind.buildContent(await readJson(request, kind.maxBodyChars));
  const today = await countCall(env, kind, now);

  const message = await callClaude(env, fetcher, kind, content);
  const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
  await recordTokens(env.DB, kind, now, usage.inputTokens, usage.outputTokens);

  if (message.stop_reason === 'refusal') {
    throw new HttpError(422, 'The AI model declined to read this one.', { code: 'refused' });
  }

  let result: unknown;
  if (kind.toResult) {
    result = kind.toResult(message);
  } else {
    if (message.stop_reason === 'max_tokens') throw new HttpError(502, 'The AI answer was cut short. Try again.', { code: 'ai-failed' });
    try {
      result = JSON.parse(textOf(message));
    } catch {
      throw new HttpError(502, 'The AI answer was not readable. Try again.', { code: 'ai-failed' });
    }
  }
  return json({ kind: kind.name, model: message.model, result, usage, today });
}

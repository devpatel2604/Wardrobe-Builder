import Anthropic from '@anthropic-ai/sdk';
import type { Env, Fetch } from '../env';
import { HttpError } from '../http';
import type { AiKind } from './types';

/**
 * The one place that talks to the AI provider (Anthropic).
 *
 * The key is a Cloudflare secret, ANTHROPIC_API_KEY. It never reaches the
 * app, and nothing the app sends is kept or logged here.
 */

/** Models that have no server-side fallback: the request must not ask for one. */
const NO_FALLBACK = /^claude-haiku-/;

/** A model name the owner may set for a kind. Anything else is ignored. */
const MODEL_NAME = /^claude-[a-z0-9-]{3,40}$/;

/**
 * The model for a kind. The owner can set another one without a code change,
 * to compare models: a Cloudflare variable AI_MODELS such as
 * "piece-photo=claude-sonnet-5-5, piece-page=claude-haiku-5-5".
 */
export function modelFor(env: Env, kind: AiKind): string {
  for (const part of (env.AI_MODELS ?? '').split(',')) {
    const [name, model] = part.split('=').map((s) => s.trim());
    if (name === kind.name && model && MODEL_NAME.test(model)) return model;
  }
  return kind.model;
}

export function hasAiKey(env: Env): boolean {
  return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;
}

function client(env: Env, fetcher: Fetch): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY!.trim(),
    // Fixed here, so no setting of the machine it runs on can send the key anywhere else.
    baseURL: 'https://api.anthropic.com',
    // Outside calls go through the server's own fetch, so tests can stand in for the network.
    fetch: (input, init) => fetcher(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init as RequestInit),
    maxRetries: 1,
    timeout: 90_000,
  });
}

/** Sends one request of a kind and returns the model's whole answer. */
export async function callClaude(
  env: Env,
  fetcher: Fetch,
  kind: AiKind,
  content: Anthropic.Beta.BetaContentBlockParam[],
): Promise<Anthropic.Beta.BetaMessage> {
  const model = modelFor(env, kind);
  const betas: Anthropic.Beta.AnthropicBeta[] = [];
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: kind.maxTokens,
    system: kind.system,
    messages: [{ role: 'user', content }],
    output_config: {
      effort: kind.effort,
      ...(kind.schema ? { format: { type: 'json_schema', schema: kind.schema } } : {}),
    },
    ...(kind.tools ? { tools: kind.tools } : {}),
  };
  // If the model's safety check declines a request by mistake, the provider
  // re-runs it on the model it recommends for that case, inside the same call.
  if (!NO_FALLBACK.test(model)) {
    betas.push('server-side-fallback-2026-07-01');
    params.fallbacks = 'default';
  }
  try {
    return await client(env, fetcher).beta.messages.create({ ...params, ...(betas.length ? { betas } : {}) });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(502, 'The AI provider did not accept the server\'s key. Check ANTHROPIC_API_KEY in Cloudflare.', { code: 'ai-key-rejected' });
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new HttpError(502, 'The AI provider is busy. Try again in a minute.', { code: 'ai-busy' });
    }
    if (error instanceof Anthropic.BadRequestError) {
      // Shown to the owner on purpose: the usual causes are an empty balance or a model name that is not offered.
      console.warn('AI request refused', kind.name, error.status, error.message);
      throw new HttpError(502, `The AI provider refused the request: ${error.message}`.slice(0, 300), { code: 'ai-failed' });
    }
    if (error instanceof Anthropic.APIError) {
      console.warn('AI request failed', kind.name, error.status);
      throw new HttpError(502, 'The AI provider did not answer. Try again.', { code: 'ai-failed' });
    }
    throw error;
  }
}

/** The text the model wrote, without its thinking. */
export function textOf(message: Anthropic.Beta.BetaMessage): string {
  let text = '';
  for (const block of message.content) if (block.type === 'text') text += block.text;
  return text;
}

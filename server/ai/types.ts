import type Anthropic from '@anthropic-ai/sdk';
import { HttpError } from '../http';

/**
 * One fixed kind of AI request.
 *
 * The app never sends a prompt, a model name or a tool. It names a kind and
 * sends that kind's data. Everything else is written here on the server, so
 * someone holding a leaked app key can only run these few small jobs, each a
 * limited number of times a day.
 *
 * To add a kind: write a file next to this one that exports an AiKind, and
 * add it to the list in kinds.ts.
 */
export interface AiKind {
  /** The last part of the address: POST /api/ai/<name>. Lower case, digits and hyphens. */
  name: string;
  /** The model that answers, unless the owner set another for this kind (see AI_MODELS in env.ts). */
  model: string;
  effort: 'low' | 'medium' | 'high';
  /** The most the model may write, thinking included. */
  maxTokens: number;
  /** Calls allowed per day (UTC) for this kind alone. */
  dailyLimit: number;
  /** The largest request body the route accepts for this kind, in characters. */
  maxBodyChars: number;
  system: string;
  /**
   * The JSON schema of the answer. With it, the model's answer is guaranteed
   * to be JSON of this shape, and the route returns it parsed as `result`.
   * Every object needs "additionalProperties": false and every key in "required".
   */
  schema?: Record<string, unknown>;
  /** Tools the model may use, such as the provider's own web search. */
  tools?: Anthropic.Beta.BetaToolUnion[];
  /** Checks the request and builds what the model is shown. Throw HttpError(400, ...) on bad input. */
  buildContent(body: Record<string, unknown>): Anthropic.Beta.BetaContentBlockParam[];
  /**
   * Turns the model's whole answer into `result`. Only for kinds that need
   * more than the parsed JSON, such as the links a web search found.
   */
  toResult?(message: Anthropic.Beta.BetaMessage): unknown;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** About 1.1 MB of picture. The app shrinks a photo well below this before sending. */
export const MAX_IMAGE_CHARS = 1_500_000;

/** Checks one { mediaType, data } picture from the app and turns it into what the model is shown. */
export function imageBlock(value: unknown): Anthropic.Beta.BetaImageBlockParam {
  const image = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const mediaType = IMAGE_TYPES.find((type) => type === image.mediaType);
  const data = image.data;
  if (!mediaType || typeof data !== 'string' || data.length === 0) throw new HttpError(400, 'The picture was not readable.');
  if (data.length > MAX_IMAGE_CHARS) throw new HttpError(413, 'That picture is too large.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, 'The picture was not readable.');
  return { type: 'image', source: { type: 'base64', media_type: mediaType satisfies ImageType, data } };
}

/** Reads the `images` list of a request: between `min` and `max` pictures. */
export function imageBlocks(value: unknown, min: number, max: number): Anthropic.Beta.BetaImageBlockParam[] {
  const list = value === undefined ? [] : value;
  if (!Array.isArray(list) || list.length < min || list.length > max) {
    throw new HttpError(400, max === 1 ? 'Send one picture.' : `Send ${min} to ${max} pictures.`);
  }
  return list.map(imageBlock);
}

/** A short piece of text from the request, or undefined. Longer text is refused, never cut. */
export function textField(value: unknown, maxChars: number, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `The ${name} was not readable.`);
  const text = value.trim();
  if (text.length > maxChars) throw new HttpError(413, `The ${name} is too long.`);
  return text || undefined;
}

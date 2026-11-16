import type { Env } from './env';

/** An error with a status code and a message that is safe to show. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// Sent with every answer. Nothing the server returns should be cached,
// indexed, or read as anything but what it says it is.
const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...COMMON_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { ...COMMON_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, ...error.extra }, error.status);
  console.error('Unexpected error', error);
  return json({ error: 'The server hit a problem.' }, 500);
}

/** A key shorter than this is too easy to guess, so the server will not run with it. */
export const MIN_KEY_LENGTH = 20;

export function serverIsReady(env: Env): boolean {
  return typeof env.APP_KEY === 'string' && env.APP_KEY.trim().length >= MIN_KEY_LENGTH;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Compares two strings without giving away, by timing, where they differ. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** Lets the request through only when it carries the app key. */
export async function requireAppKey(request: Request, env: Env): Promise<void> {
  if (!serverIsReady(env)) throw new HttpError(503, 'The server has no app key yet.');
  const header = request.headers.get('Authorization') ?? '';
  const sent = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!sent || !(await sameSecret(sent, env.APP_KEY!.trim()))) throw new HttpError(401, 'That app key is not right.');
}

export async function readJson(request: Request, maxChars: number): Promise<Record<string, unknown>> {
  const body = await readText(request, maxChars);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HttpError(400, 'The request was not readable.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new HttpError(400, 'The request was not readable.');
  return parsed as Record<string, unknown>;
}

export async function readText(request: Request, maxChars: number): Promise<string> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxChars) throw new HttpError(413, 'That is too large.');
  const body = await request.text();
  if (body.length > maxChars) throw new HttpError(413, 'That is too large.');
  return body;
}

/** Ids come from the app. Keep them to a plain alphabet so they are safe anywhere. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

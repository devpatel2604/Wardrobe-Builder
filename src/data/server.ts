import { db } from './db';

/**
 * The link to the small server (the /api routes at the app's own address).
 * The server answers only requests that carry the app key, which is kept in
 * the saved-settings table. That table is never part of a backup or export.
 */
const APP_KEY = 'server.appKey';

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deleteMeta(...keys: string[]): Promise<void> {
  await db.meta.bulkDelete(keys);
}

/** A failed call. status is 0 when the server could not be reached at all. */
export class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function getAppKey(): Promise<string | undefined> {
  return getMeta(APP_KEY);
}

interface CallOptions {
  method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  /** A string is sent as it is. Anything else is sent as JSON. */
  body?: unknown;
  /** Defaults to the saved app key. */
  key?: string;
}

/** Calls the server and returns its answer, or throws a ServerError. */
export async function callServer(path: string, options: CallOptions = {}): Promise<Response> {
  const key = options.key ?? (await getAppKey());
  if (!key) throw new ServerError(0, 'This phone is not connected to your server.');
  const isText = typeof options.body === 'string';
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(options.body === undefined ? {} : { 'Content-Type': isText ? 'text/plain' : 'application/json' }),
      },
      body: options.body === undefined ? undefined : isText ? (options.body as string) : JSON.stringify(options.body),
    });
  } catch {
    throw new ServerError(0, 'The server could not be reached. Check your connection and try again.');
  }
  if (response.ok) return response;
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const message =
    response.status === 401
      ? 'That app key is not right.'
      : typeof body.error === 'string'
        ? body.error
        : `The server answered with an error (${response.status}).`;
  throw new ServerError(response.status, message, body);
}

export type ServerKind =
  | 'ready' // a server is here and has its app key
  | 'no-key' // a server is here, but no app key has been set in Cloudflare
  | 'none' // this address serves the app's files only
  | 'unreachable';

/** Finds out, without a key, whether this address has a server behind it. */
export async function findServer(): Promise<ServerKind> {
  let response: Response;
  try {
    response = await fetch('/api/health');
  } catch {
    return 'unreachable';
  }
  // A files-only host answers every unknown path with the app's own page.
  const body = (await response.json().catch(() => null)) as { app?: unknown; ready?: unknown } | null;
  if (!response.ok || body?.app !== 'wardrobe-builder') return 'none';
  return body.ready === true ? 'ready' : 'no-key';
}

export interface ServerStatus {
  backups: { count: number; latestAt: string | null };
  reminders: number;
  /** The key the phone subscribes to alerts with. */
  pushKey: string;
}

export async function getServerStatus(key?: string): Promise<ServerStatus> {
  return (await (await callServer('/status', { key })).json()) as ServerStatus;
}

/** Checks the key against the server and, if it is right, saves it on this phone. */
export async function connectServer(key: string): Promise<ServerStatus> {
  const trimmed = key.trim();
  if (!trimmed) throw new ServerError(0, 'Enter your app key.');
  const status = await getServerStatus(trimmed);
  await setMeta(APP_KEY, trimmed);
  return status;
}

/** Forgets the app key on this phone. Nothing on the server changes. */
export async function disconnectServer(): Promise<void> {
  await deleteMeta(APP_KEY);
}

/** Deletes everything the server holds: backups, alert addresses and its own keys. */
export async function eraseServerData(): Promise<void> {
  await callServer('/data', { method: 'DELETE' });
}

// No 0, 1, l or o, so the key is easy to read back and type.
const KEY_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** A new random app key, such as "k7wq-m2xn-...", strong enough to stand alone. */
export function makeAppKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = Array.from(bytes, (byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length]!);
  return (chars.join('').match(/.{4}/g) ?? []).join('-');
}

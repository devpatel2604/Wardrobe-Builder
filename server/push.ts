import type { D1Database, Fetch } from './env';
import { getConfig, keepConfig } from './schema';

/**
 * Web push: how a server sends an alert to a phone.
 *
 * Two standards are involved. VAPID (RFC 8292) signs each request so the
 * push service (Apple's, for an iPhone) knows which server is sending. The
 * message itself is encrypted for the phone (RFC 8291, "aes128gcm"), so the
 * push service passes it along without being able to read it.
 *
 * Everything uses the Web Crypto built into the Workers runtime. There is no
 * library, and the work is a few milliseconds.
 */

export interface PushSubscription {
  endpoint: string;
  /** The phone's public key, base64url. */
  p256dh: string;
  /** A shared secret the phone made, base64url. */
  auth: string;
}

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url. The app subscribes with this. */
  publicKey: string;
  privateJwk: JsonWebKey;
}

/** Bytes held in ordinary memory, which is what Web Crypto accepts. */
type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Bytes {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicKey = toBase64Url((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { publicKey, privateJwk };
}

/**
 * The server's signing keys, made on first use and kept in the database.
 * They only prove which server sent an alert. They unlock nothing else.
 */
export async function getVapidKeys(db: D1Database): Promise<VapidKeys> {
  const stored = await getConfig(db, 'vapid');
  if (stored) return JSON.parse(stored) as VapidKeys;
  // If two requests get here at once, both end up with the same keys.
  return JSON.parse(await keepConfig(db, 'vapid', JSON.stringify(await generateVapidKeys()))) as VapidKeys;
}

async function vapidToken(keys: VapidKeys, audience: string, subject: string, now: Date): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  // Apple refuses a token that lasts more than a day. Twelve hours is plenty.
  const claims = { aud: audience, exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60, sub: subject };
  const unsigned = `${header}.${toBase64Url(encoder.encode(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned));
  return `${unsigned}.${toBase64Url(signature)}`;
}

async function hkdf(salt: Bytes, keyMaterial: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', keyMaterial, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypts a message for one phone, in the "aes128gcm" form of RFC 8291. */
export async function encryptPayload(
  subscription: PushSubscription,
  payload: Bytes,
  // Tests pass fixed values here. Real calls make fresh random ones.
  fixed: { salt?: Bytes; localKeys?: CryptoKeyPair } = {},
): Promise<Bytes> {
  const phonePublic = fromBase64Url(subscription.p256dh);
  const authSecret = fromBase64Url(subscription.auth);
  if (phonePublic.length !== 65 || authSecret.length !== 16) throw new Error('The alert address is not usable.');

  const localKeys =
    fixed.localKeys ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const localPublic = new Uint8Array((await crypto.subtle.exportKey('raw', localKeys.publicKey)) as ArrayBuffer);
  const phoneKey = await crypto.subtle.importKey('raw', phonePublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: phoneKey }, localKeys.privateKey, 256));

  const keyInfo = concat(encoder.encode('WebPush: info\0'), phonePublic, localPublic);
  const inputKey = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, inputKey, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, inputKey, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt']);
  // The byte 0x02 marks the end of the only record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(payload, new Uint8Array([2]))));

  // Header: salt, record size (4096, big-endian), key length, the server's key.
  const recordSize = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, recordSize, new Uint8Array([localPublic.length]), localPublic, sealed);
}

export interface PushMessage {
  subscription: PushSubscription;
  payload: string;
  /** A web address that identifies the sender to the push service. */
  subject: string;
  /** Seconds the push service keeps trying if the phone is off. */
  ttlSeconds: number;
  now: Date;
}

export async function buildPushRequest(keys: VapidKeys, message: PushMessage): Promise<{ url: string; init: RequestInit }> {
  const body = await encryptPayload(message.subscription, encoder.encode(message.payload));
  const audience = new URL(message.subscription.endpoint).origin;
  const token = await vapidToken(keys, audience, message.subject, message.now);
  return {
    url: message.subscription.endpoint,
    init: {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${token}, k=${keys.publicKey}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(message.ttlSeconds),
        Urgency: 'normal',
      },
      body,
    },
  };
}

export type PushOutcome =
  | { ok: true; status: number }
  /** gone: the phone no longer accepts alerts at this address, so forget it. */
  | { ok: false; status: number; gone: boolean; detail: string };

export async function sendPush(fetcher: Fetch, keys: VapidKeys, message: PushMessage): Promise<PushOutcome> {
  const { url, init } = await buildPushRequest(keys, message);
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (error) {
    return { ok: false, status: 0, gone: false, detail: error instanceof Error ? error.message : 'network error' };
  }
  if (response.ok) return { ok: true, status: response.status };
  const detail = (await response.text().catch(() => '')).slice(0, 200);
  return { ok: false, status: response.status, gone: response.status === 404 || response.status === 410, detail };
}

/**
 * The alert in the "declarative" form (web_push: 8030). An iPhone on iOS 18.4
 * or later shows it by itself. Older ones hand it to the app's service
 * worker, which reads the same fields (public/push-sw.js).
 */
export function alertPayload(alert: { title: string; body: string; navigate: string; tag: string }): string {
  return JSON.stringify({ web_push: 8030, notification: { title: alert.title, body: alert.body, navigate: alert.navigate, tag: alert.tag } });
}

/** Push services the server will talk to. Anything else is refused. */
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

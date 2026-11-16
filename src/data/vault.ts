import { fromBase64, toBase64 } from './backup';

/**
 * Encryption for the automatic backup. Everything is encrypted on the phone
 * before it is uploaded, with a key made from the recovery code. The server
 * never sees the code, so it stores a backup it cannot read.
 *
 * The cipher is AES-256-GCM from the browser's own Web Crypto.
 */

// Crockford's base32: no I, L, O or U, so a code survives being read aloud or
// typed by hand.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BYTES = 32;
const CODE_CHARS = Math.ceil((CODE_BYTES * 8) / 5); // 52

function encodeBase32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase32(text: string): Uint8Array<ArrayBuffer> | undefined {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return undefined;
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** A new recovery code: 256 random bits, shown as 13 groups of four characters. */
export function newRecoveryCode(): string {
  return formatRecoveryCode(encodeBase32(crypto.getRandomValues(new Uint8Array(CODE_BYTES))));
}

function formatRecoveryCode(plain: string): string {
  return (plain.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * Tidies a code someone typed: any case, with or without the dashes, and
 * with the letters people mix up (O for 0, I or L for 1) put right.
 * Returns undefined when it cannot be a recovery code.
 */
export function normalizeRecoveryCode(input: string): string | undefined {
  const plain = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (plain.length !== CODE_CHARS) return undefined;
  const bytes = decodeBase32(plain);
  if (!bytes || bytes.length !== CODE_BYTES) return undefined;
  return formatRecoveryCode(plain);
}

const encoder = new TextEncoder();

/** Turns a recovery code into the key that locks and unlocks the backup. */
export async function keyFromRecoveryCode(code: string): Promise<CryptoKey> {
  const normal = normalizeRecoveryCode(code);
  const secret = normal && decodeBase32(normal.replace(/-/g, ''));
  if (!secret) throw new Error('That recovery code is not complete. It has 52 letters and numbers.');
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('wardrobe-builder backup v1'), info: encoder.encode('aes-256-gcm') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const VERSION = 1;
const IV_BYTES = 12;

/**
 * Encrypts bytes and returns them as base64 text. The label says what the
 * item is (a snapshot, or one named photo). It is checked on the way back,
 * so one stored item cannot be passed off as another.
 */
export async function seal(key: CryptoKey, label: string, bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(label) }, key, bytes));
  const out = new Uint8Array(1 + IV_BYTES + sealed.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(sealed, 1 + IV_BYTES);
  return toBase64(out.buffer);
}

/** Thrown when an item will not open: the wrong recovery code, or damaged data. */
export class CannotOpenError extends Error {
  constructor() {
    super('That recovery code does not open this backup.');
  }
}

export async function open(key: CryptoKey, label: string, text: string): Promise<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(fromBase64(text));
  } catch {
    throw new CannotOpenError();
  }
  if (bytes.length < 1 + IV_BYTES + 16 || bytes[0] !== VERSION) throw new CannotOpenError();
  try {
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(1, 1 + IV_BYTES), additionalData: encoder.encode(label) },
      key,
      bytes.subarray(1 + IV_BYTES),
    );
  } catch {
    throw new CannotOpenError();
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

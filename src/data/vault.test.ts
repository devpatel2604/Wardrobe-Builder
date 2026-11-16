import { describe, expect, it } from 'vitest';
import { CannotOpenError, keyFromRecoveryCode, newRecoveryCode, normalizeRecoveryCode, open, seal } from './vault';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer));

describe('recovery codes', () => {
  it('makes a different 52-character code each time, in groups of four', () => {
    const a = newRecoveryCode();
    const b = newRecoveryCode();
    expect(a).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(a).not.toBe(b);
    expect(normalizeRecoveryCode(a)).toBe(a);
  });

  it('accepts a code typed in lower case, without dashes, or with look-alike letters', () => {
    const code = '0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ-0123-4567-89AB-CDEF-GHJ0';
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code);
    expect(normalizeRecoveryCode(code.replace(/0/g, 'O').replace(/1/g, 'l'))).toBe(code);
  });

  it('turns away text that cannot be a code', () => {
    expect(normalizeRecoveryCode('')).toBeUndefined();
    expect(normalizeRecoveryCode('ABCD-EFGH')).toBeUndefined();
    expect(normalizeRecoveryCode(`${newRecoveryCode()}-ABCD`)).toBeUndefined();
    expect(normalizeRecoveryCode(newRecoveryCode().replace(/.$/, 'U'))).toBeUndefined();
  });
});

describe('sealing', () => {
  it('opens what it sealed, and only with the same code', async () => {
    const code = newRecoveryCode();
    const key = await keyFromRecoveryCode(code);
    const sealed = await seal(key, 'snapshot', bytes(1, 2, 3, 250));
    expect(text(await open(key, 'snapshot', sealed))).toEqual([1, 2, 3, 250]);
    // The same code typed back in opens it too.
    expect(text(await open(await keyFromRecoveryCode(code.toLowerCase()), 'snapshot', sealed))).toEqual([1, 2, 3, 250]);
    await expect(open(await keyFromRecoveryCode(newRecoveryCode()), 'snapshot', sealed)).rejects.toBeInstanceOf(CannotOpenError);
  });

  it('does not leave the contents readable in what is uploaded', async () => {
    const key = await keyFromRecoveryCode(newRecoveryCode());
    const secret = new TextEncoder().encode('Navy zip cardigan, size M');
    const a = await seal(key, 'snapshot', secret);
    const b = await seal(key, 'snapshot', secret);
    expect(atob(a)).not.toContain('Navy');
    expect(a).not.toBe(b);
  });

  it('refuses an item offered under another name, or one that was changed', async () => {
    const key = await keyFromRecoveryCode(newRecoveryCode());
    const sealed = await seal(key, 'photo:a', bytes(9, 9, 9));
    await expect(open(key, 'photo:b', sealed)).rejects.toBeInstanceOf(CannotOpenError);
    const raw = atob(sealed);
    const changed = btoa(raw.slice(0, -1) + String.fromCharCode(raw.charCodeAt(raw.length - 1) ^ 1));
    await expect(open(key, 'photo:a', changed)).rejects.toBeInstanceOf(CannotOpenError);
    await expect(open(key, 'photo:a', 'not base64 at all!')).rejects.toBeInstanceOf(CannotOpenError);
    await expect(open(key, 'photo:a', '')).rejects.toBeInstanceOf(CannotOpenError);
  });

  it('turns away an incomplete code', async () => {
    await expect(keyFromRecoveryCode('ABCD')).rejects.toThrow('not complete');
  });
});

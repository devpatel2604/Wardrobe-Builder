// @vitest-environment node
import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { alertPayload, buildPushRequest, fromBase64Url, generateVapidKeys, isPushEndpoint, toBase64Url } from './push';
import { makePhone } from './testPhone';

describe('web push', () => {
  it('encrypts a message that only the phone can open', async () => {
    const keys = await generateVapidKeys();
    const phone = makePhone();
    const payload = alertPayload({ title: 'Tomorrow is an office day', body: '35°F at 7 am, dry. Tap for your outfit.', navigate: 'https://app.example/', tag: 't' });
    const { url, init } = await buildPushRequest(keys, {
      subscription: phone.subscription,
      payload,
      subject: 'https://app.example',
      ttlSeconds: 600,
      now: new Date('2026-01-05T00:00:00Z'),
    });
    expect(url).toBe(phone.subscription.endpoint);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Encoding']).toBe('aes128gcm');
    expect(headers.TTL).toBe('600');

    expect(phone.open(init.body as Uint8Array)).toBe(payload);
    expect(JSON.parse(payload)).toEqual({
      web_push: 8030,
      notification: { title: 'Tomorrow is an office day', body: '35°F at 7 am, dry. Tap for your outfit.', navigate: 'https://app.example/', tag: 't' },
    });

    // A different phone cannot open it.
    expect(() => makePhone().open(init.body as Uint8Array)).toThrow();
  });

  it('signs the request so the push service knows the sender', async () => {
    const keys = await generateVapidKeys();
    const phone = makePhone('https://web.push.apple.com/some/long/path');
    const now = new Date('2026-01-05T00:00:00Z');
    const { init } = await buildPushRequest(keys, { subscription: phone.subscription, payload: 'hi', subject: 'https://app.example', ttlSeconds: 60, now });
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec((init.headers as Record<string, string>).Authorization!);
    expect(match).not.toBeNull();
    const [, header, claims, signature, key] = match!;
    expect(key).toBe(keys.publicKey);
    expect(JSON.parse(Buffer.from(fromBase64Url(header!)).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(Buffer.from(fromBase64Url(claims!)).toString())).toEqual({
      aud: 'https://web.push.apple.com',
      exp: now.getTime() / 1000 + 12 * 60 * 60,
      sub: 'https://app.example',
    });

    const point = fromBase64Url(keys.publicKey);
    expect(point.length).toBe(65);
    const publicKey = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: toBase64Url(point.subarray(1, 33)), y: toBase64Url(point.subarray(33)) },
      format: 'jwk',
    });
    const signed = Buffer.from(`${header}.${claims}`);
    expect(verify('sha256', signed, { key: publicKey, dsaEncoding: 'ieee-p1363' }, fromBase64Url(signature!))).toBe(true);
  });

  it('uses a fresh key and salt for every message', async () => {
    const keys = await generateVapidKeys();
    const phone = makePhone();
    const message = { subscription: phone.subscription, payload: 'same', subject: 'https://app.example', ttlSeconds: 60, now: new Date() };
    const a = (await buildPushRequest(keys, message)).init.body as Uint8Array;
    const b = (await buildPushRequest(keys, message)).init.body as Uint8Array;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(phone.open(a)).toBe('same');
    expect(phone.open(b)).toBe('same');
  });

  it('talks only to known push services', () => {
    expect(isPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(isPushEndpoint('http://web.push.apple.com/abc')).toBe(false);
    expect(isPushEndpoint('https://web.push.apple.com.evil.example/abc')).toBe(false);
    expect(isPushEndpoint('https://evil.example/web.push.apple.com')).toBe(false);
    expect(isPushEndpoint('https://user@web.push.apple.com/abc')).toBe(false);
    expect(isPushEndpoint('https://web.push.apple.com:8443/abc')).toBe(false);
    expect(isPushEndpoint('https://localhost/abc')).toBe(false);
    expect(isPushEndpoint(42)).toBe(false);
  });
});

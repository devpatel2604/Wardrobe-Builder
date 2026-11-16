import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { toBase64Url } from './push';

/**
 * A stand-in for the phone: it makes the keys a phone would make, and opens
 * a message the way RFC 8291 says a phone does. It is written with Node's
 * own crypto, not the Web Crypto the server uses, so the two check each other.
 */
export function makePhone(endpoint = 'https://web.push.apple.com/QOabc123') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
  const one = Buffer.from([1]);

  return {
    subscription: { endpoint, p256dh: toBase64Url(ecdh.getPublicKey()), auth: toBase64Url(auth) },
    open(body: Uint8Array): string {
      const message = Buffer.from(body);
      const salt = message.subarray(0, 16);
      const recordSize = message.readUInt32BE(16);
      const keyLength = message.readUInt8(20);
      const serverPublic = message.subarray(21, 21 + keyLength);
      const sealed = message.subarray(21 + keyLength);
      if (recordSize !== 4096 || keyLength !== 65 || sealed.length > recordSize) throw new Error('The message header is wrong.');

      const shared = ecdh.computeSecret(serverPublic);
      const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPublic]);
      const inputKey = hmac(hmac(auth, shared), Buffer.concat([info, one]));
      const prk = hmac(salt, inputKey);
      const contentKey = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), one])).subarray(0, 16);
      const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), one])).subarray(0, 12);

      const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce);
      decipher.setAuthTag(sealed.subarray(sealed.length - 16));
      const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
      if (plain.at(-1) !== 2) throw new Error('The message has no end marker.');
      return plain.subarray(0, -1).toString('utf8');
    },
  };
}

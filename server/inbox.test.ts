// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_ITEMS } from './inbox';
import { startTestServer, TEST_KEY, type TestServer } from './testing';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
}, 30_000);
afterAll(() => server.close());
beforeEach(() => server.reset());

const now = new Date('2026-02-03T15:00:00Z');

/** A stand-in picture: not a real PNG, the server only stores the bytes. */
function picture(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) % 256;
  return bytes;
}

function form(fields: Record<string, string>, file?: { bytes: Uint8Array<ArrayBuffer>; type: string }): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  if (file) data.set('file', new Blob([file.bytes], { type: file.type }), 'shared.png');
  return data;
}

interface Listed {
  id: string;
  kind: string;
  receivedAt: string;
  url?: string;
  title?: string;
  text?: string;
  file?: { type: string; size: number };
}

async function listed(): Promise<Listed[]> {
  return ((await (await server.call('GET', '/api/inbox')).json()) as { items: Listed[] }).items;
}

describe('the inbox', () => {
  it('refuses anything without the app key, in words the Shortcut can show', async () => {
    const none = await server.call('POST', '/api/inbox', { key: null, body: form({ kind: 'link', url: 'https://example.com/a' }) });
    expect(none.status).toBe(401);
    expect(await none.text()).toBe('Not saved. That app key is not right.');
    const wrong = await server.call('POST', '/api/inbox', { key: null, body: form({ kind: 'link', url: 'https://example.com/a', key: 'wrong-key-0123456789-abcdef' }) });
    expect(wrong.status).toBe(401);
    for (const [method, path] of [
      ['GET', '/api/inbox'],
      ['GET', '/api/inbox/abc/file'],
      ['DELETE', '/api/inbox/abc'],
    ] as const) {
      expect((await server.call(method, path, { key: null })).status, `${method} ${path}`).toBe(401);
    }
    expect(await listed()).toEqual([]);
  });

  it('takes the key from the form when the Shortcut cannot send a header', async () => {
    const response = await server.call('POST', '/api/inbox', { key: null, body: form({ kind: 'link', url: 'https://example.com/a', key: TEST_KEY }) });
    expect(response.status).toBe(201);
    expect(await listed()).toHaveLength(1);
  });

  it('keeps a shared link and says so in plain words', async () => {
    const response = await server.call('POST', '/api/inbox', { body: form({ kind: 'look', url: 'https://www.instagram.com/reel/abc123/' }), now });
    expect(response.status).toBe(201);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toBe('Link saved. Open Wardrobe to finish.');
    const items = await listed();
    expect(items).toEqual([{ id: items[0]!.id, kind: 'link', receivedAt: now.toISOString(), url: 'https://www.instagram.com/reel/abc123/' }]);
  });

  it('keeps a store page with the text the phone copied from it', async () => {
    const page = JSON.stringify({ title: 'Cable-knit crewneck', price: '89.50', text: 'A warm crewneck. 100% cotton.' });
    await server.call('POST', '/api/inbox', { body: form({ kind: 'page', url: 'https://shop.example/p/1', title: 'Cable-knit crewneck | Shop', text: page }), now });
    const [item] = await listed();
    expect(item).toMatchObject({ kind: 'page', url: 'https://shop.example/p/1', title: 'Cable-knit crewneck | Shop', text: page });
    expect(item!.file).toBeUndefined();
  });

  it('accepts JSON too, and answers with JSON when asked', async () => {
    const response = await server.call('POST', '/api/inbox?reply=json', { body: { kind: 'link', url: 'https://example.com/shoe' }, now });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { ok: boolean; id: string; kind: string; waiting: number };
    expect(body).toMatchObject({ ok: true, kind: 'link', waiting: 1 });
    expect((await listed())[0]!.id).toBe(body.id);
  });

  it('keeps a photo larger than one database row and hands back the same bytes', async () => {
    const bytes = picture(2_300_000);
    const response = await server.call('POST', '/api/inbox', { body: form({ kind: 'photo' }, { bytes, type: 'image/png' }), now });
    expect(await response.text()).toBe('Photo saved. Open Wardrobe to add the piece.');
    const [item] = await listed();
    expect(item).toMatchObject({ kind: 'photo', file: { type: 'image/png', size: bytes.length } });
    const file = await server.call('GET', `/api/inbox/${item!.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('image/png');
    const back = new Uint8Array(await file.arrayBuffer());
    expect(back.length).toBe(bytes.length);
    expect(Buffer.from(back).equals(Buffer.from(bytes))).toBe(true);
  });

  it('takes a bare picture as the whole request', async () => {
    const bytes = picture(5000);
    const response = await server.call('POST', '/api/inbox?kind=look', { body: bytes, headers: { 'Content-Type': 'image/jpeg' }, now });
    expect(response.status).toBe(201);
    const [item] = await listed();
    expect(item).toMatchObject({ kind: 'screenshot', file: { type: 'image/jpeg', size: 5000 } });
  });

  it('works out the kind when the Shortcut does not say', async () => {
    await server.call('POST', '/api/inbox', { body: form({}, { bytes: picture(10), type: 'image/png' }) });
    await server.call('POST', '/api/inbox', { body: form({ url: 'https://shop.example/p/2', text: 'Some page text' }) });
    await server.call('POST', '/api/inbox', { body: form({ url: 'https://example.com/x' }) });
    await server.call('POST', '/api/inbox', { body: form({ text: 'https://example.com/shared-as-text' }) });
    expect((await listed()).map((i) => i.kind).sort()).toEqual(['link', 'link', 'page', 'photo']);
    expect((await listed()).map((i) => i.url)).toContain('https://example.com/shared-as-text');
  });

  it('refuses what it cannot use', async () => {
    const cases: [string, FormData, number][] = [
      ['no picture', form({ kind: 'photo' }), 400],
      ['no link', form({ kind: 'link' }), 400],
      ['a link that is not a web address', form({ kind: 'link', url: 'javascript:alert(1)' }), 400],
      ['a file that is not a picture', form({ kind: 'photo' }, { bytes: picture(10), type: 'application/pdf' }), 415],
      ['page text that is too long', form({ kind: 'page', url: 'https://shop.example/p', text: 'x'.repeat(40_001) }), 413],
    ];
    for (const [name, body, status] of cases) {
      const response = await server.call('POST', '/api/inbox', { body });
      expect(response.status, name).toBe(status);
      expect(await response.text(), name).toMatch(/^Not saved\. /);
    }
    expect(await listed()).toEqual([]);
  });

  it('stops when it is full, so a leaked key cannot fill the database', async () => {
    for (let i = 0; i < MAX_ITEMS; i++) await server.call('POST', '/api/inbox', { body: form({ url: `https://example.com/${i}` }) });
    const response = await server.call('POST', '/api/inbox', { body: form({ url: 'https://example.com/one-more' }) });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('The inbox is full');
    expect(await listed()).toHaveLength(MAX_ITEMS);
  });

  it('deletes an item and its picture once the app has collected it', async () => {
    await server.call('POST', '/api/inbox', { body: form({ kind: 'photo' }, { bytes: picture(1_500_000), type: 'image/png' }) });
    await server.call('POST', '/api/inbox', { body: form({ url: 'https://example.com/keep' }) });
    const photo = (await listed()).find((i) => i.kind === 'photo')!;
    expect((await server.call('DELETE', `/api/inbox/${photo.id}`)).status).toBe(200);
    expect((await listed()).map((i) => i.kind)).toEqual(['link']);
    expect(await server.env.DB.prepare(`SELECT COUNT(*) AS n FROM inbox_chunks`).first()).toEqual({ n: 0 });
    expect((await server.call('GET', `/api/inbox/${photo.id}/file`)).status).toBe(404);
  });

  it('is counted in the status and cleared by erase', async () => {
    await server.call('POST', '/api/inbox', { body: form({ kind: 'photo' }, { bytes: picture(100), type: 'image/png' }) });
    expect(await (await server.call('GET', '/api/status')).json()).toMatchObject({ inbox: 1, ai: false });
    await server.call('DELETE', '/api/data');
    expect(await listed()).toEqual([]);
    expect(await server.env.DB.prepare(`SELECT COUNT(*) AS n FROM inbox_chunks`).first()).toEqual({ n: 0 });
  });
});

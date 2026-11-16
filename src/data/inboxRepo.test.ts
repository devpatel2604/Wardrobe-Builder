// @vitest-environment node
// Runs outside the browser stand-in, because the local Cloudflare server cannot start inside it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiErrorCode, aiErrorMessage, getAiStatus, readWithAi } from './ai';
import { db } from './db';
import { addInboxItem, collectInbox, getInboxItem, listInbox, removeInboxItem, saveProposal } from './inboxRepo';
import { connectServer, ServerError } from './server';
import { eraseEverything } from './setup';
import { cleanProposal } from '../domain/tagging';
import { fakeImage } from '../test/fixtures';
import { startAppServer, type AppServer } from '../test/appServer';

// There is no canvas outside a browser. The stand-in keeps the bytes, and calls a PNG a cut-out.
vi.mock('./images', async (original) => ({
  ...(await original<typeof import('./images')>()),
  processIncoming: vi.fn(async (file: Blob) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0) throw new Error('That file could not be read as a photo.');
    return { ...fakeImage([...bytes.slice(0, 4)]), cutout: file.type === 'image/png' };
  }),
}));

let server: AppServer;
beforeAll(async () => {
  server = await startAppServer();
}, 30_000);
afterAll(() => server.close());
beforeEach(async () => {
  await server.reset();
  vi.stubGlobal('fetch', server.fetch);
});
afterEach(() => vi.unstubAllGlobals());

const bytes = (...values: number[]) => new Uint8Array(values);
const serverInbox = async () => ((await (await server.inner.call('GET', '/api/inbox')).json()) as { items: unknown[] }).items;

describe('collecting what the share menu sent', () => {
  it('does nothing until the phone is connected to the server', async () => {
    await server.share({ kind: 'link', url: 'https://example.com/a' });
    expect(await collectInbox()).toBe(0);
    expect(server.requests).toHaveLength(0);
    expect(await serverInbox()).toHaveLength(1);
  });

  it('brings every item to the phone and deletes it from the server', async () => {
    await connectServer(server.key);
    await server.share({ kind: 'photo' }, { bytes: bytes(9, 8, 7, 6, 5), type: 'image/png' });
    await server.share({ kind: 'page', text: JSON.stringify({ url: 'https://shop.example/p/1', title: 'Cable crewneck | Shop', text: '100% cotton' }) });
    await server.share({ kind: 'look', url: 'https://www.instagram.com/reel/abc/' });
    await server.share({ kind: 'look' }, { bytes: bytes(1, 2, 3, 4), type: 'image/jpeg' });

    expect(await collectInbox()).toBe(4);
    const items = await listInbox();
    expect(items.map((i) => i.kind)).toEqual(['photo', 'page', 'link', 'screenshot']);
    expect(items.every((i) => i.door === 'shortcut')).toBe(true);
    // A PNG from the Shortcut is Apple's cut-out. A plain screenshot is not.
    expect(items[0]!.image).toMatchObject({ cutout: true, mimeType: 'image/jpeg' });
    expect(new Uint8Array(items[0]!.image!.data)).toEqual(bytes(9, 8, 7, 6));
    expect(items[3]!.image!.cutout).toBe(false);
    // The page's link and title are lifted out of what the Shortcut sent, and the text is kept whole.
    expect(items[1]).toMatchObject({ url: 'https://shop.example/p/1', title: 'Cable crewneck | Shop' });
    expect(items[1]!.text).toContain('100% cotton');
    expect(items[2]!.url).toBe('https://www.instagram.com/reel/abc/');

    expect(await serverInbox()).toEqual([]);
    expect(await collectInbox()).toBe(0);
    expect(await listInbox()).toHaveLength(4);
  });

  it('keeps an item whose picture cannot be opened, and says so', async () => {
    await connectServer(server.key);
    await server.share({ kind: 'photo' }, { bytes: bytes(0, 0, 0), type: 'image/heic' });
    await collectInbox();
    const [item] = await listInbox();
    expect(item!.image).toBeUndefined();
    expect(item!.problem).toContain('could not be opened');
    expect(await serverInbox()).toEqual([]);
  });

  it('does not overwrite an item it already has', async () => {
    await connectServer(server.key);
    await server.share({ kind: 'photo' }, { bytes: bytes(5, 5, 5, 5), type: 'image/png' });
    await collectInbox();
    const [item] = await listInbox();
    await saveProposal(item!.id, cleanProposal({ subject: 'garment', slots: ['shoes'], tags: [] }), 'claude-opus-5-5');
    // The server still lists it, as if the app had closed before the delete went through.
    await server.inner.env.DB.prepare(`INSERT INTO inbox (id, kind, received_at) VALUES (?, 'photo', ?)`).bind(item!.id, item!.receivedAt).run();
    expect(await collectInbox()).toBe(0);
    expect((await getInboxItem(item!.id))!.proposal?.slots).toEqual(['shoes']);
    expect(await serverInbox()).toEqual([]);
  });

  it('leaves everything on the server when the phone is offline', async () => {
    await connectServer(server.key);
    await server.share({ kind: 'link', url: 'https://example.com/a' });
    server.down = true;
    await expect(collectInbox()).rejects.toBeInstanceOf(ServerError);
    server.down = false;
    expect(await serverInbox()).toHaveLength(1);
    expect(await collectInbox()).toBe(1);
  });
});

describe('the inbox on the phone', () => {
  it('holds what was pasted or picked inside the app, without a server', async () => {
    const item = await addInboxItem({ kind: 'photo', door: 'paste', image: { ...fakeImage(), cutout: true } });
    expect((await getInboxItem(item.id))!.image!.cutout).toBe(true);
    await removeInboxItem(item.id);
    expect(await listInbox()).toEqual([]);
    expect(server.requests).toHaveLength(0);
  });

  it('is cleared when the phone is erased', async () => {
    await addInboxItem({ kind: 'link', door: 'paste', url: 'https://example.com/a' });
    await eraseEverything();
    expect(await db.inbox.count()).toBe(0);
  });
});

describe('AI requests from the app', () => {
  const image = { mediaType: 'image/jpeg', data: 'AAAA' };

  it('returns the answer, the model and the day\'s count', async () => {
    await connectServer(server.key);
    server.ai = () => ({ subject: 'garment', slots: ['trousers'], colorFamily: 'tan' });
    const answer = await readWithAi<{ colorFamily: string }>('piece-photo', { images: [image] });
    expect(answer).toMatchObject({ result: { colorFamily: 'tan' }, model: 'claude-opus-5-5', today: { used: 1 } });
    expect(await getAiStatus()).toMatchObject({ ready: true, today: { used: 1 } });
  });

  it('explains in plain words when AI is not set up', async () => {
    await connectServer(server.key);
    const error = await readWithAi('piece-photo', { images: [image] }).catch((e: unknown) => e);
    expect(aiErrorCode(error)).toBe('no-ai-key');
    expect(aiErrorMessage(error)).toContain('not set up');
    expect(await getAiStatus()).toMatchObject({ ready: false });
  });

  it('explains when the phone is not connected at all', async () => {
    const error = await readWithAi('piece-photo', { images: [image] }).catch((e: unknown) => e);
    expect(aiErrorMessage(error)).toBe('This phone is not connected to your server.');
  });
});

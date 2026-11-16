// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SNAPSHOTS_KEPT } from './backup';
import { CHUNK_CHARS } from './blobs';
import { startTestServer, type TestServer } from './testing';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
}, 30_000);
afterAll(() => server.close());
beforeEach(() => server.reset());

const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 0, day, hour));

describe('the app key', () => {
  it('says a server is here without a key, and nothing more', async () => {
    const response = await server.call('GET', '/api/health', { key: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ app: 'wardrobe-builder', server: 1, ready: true });
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('refuses every other route without the right key', async () => {
    for (const [method, path] of [
      ['GET', '/api/status'],
      ['GET', '/api/backup'],
      ['GET', '/api/backup/snapshots/latest'],
      ['PUT', '/api/backup/photos/p1'],
      ['POST', '/api/backup/snapshots'],
      ['PUT', '/api/reminders'],
      ['POST', '/api/reminders/test'],
      ['GET', '/api/forecast?lat=1&lon=1'],
      ['DELETE', '/api/data'],
      ['GET', '/api/nothing-here'],
    ] as const) {
      expect((await server.call(method, path, { key: null })).status, `${method} ${path} with no key`).toBe(401);
      expect((await server.call(method, path, { key: 'wrong-key-0123456789-abcdef' })).status, `${method} ${path} with a wrong key`).toBe(401);
    }
  });

  it('refuses everything until a long enough key is set on the server', async () => {
    for (const key of [undefined, '', 'short']) {
      const env = { ...server.env, APP_KEY: key };
      const { handleApi } = await import('./index');
      const { errorResponse } = await import('./http');
      const request = new Request('https://wardrobe.example/api/status', { headers: { Authorization: `Bearer ${key ?? ''}` } });
      const response = await handleApi(request, env, async () => new Response()).catch(errorResponse);
      expect(response.status).toBe(503);
    }
    const health = await (await import('./index')).handleApi(
      new Request('https://wardrobe.example/api/health'),
      { ...server.env, APP_KEY: undefined },
      async () => new Response(),
    );
    expect(await health.json()).toMatchObject({ ready: false });
  });

  it('answers an unknown route with 404 once the key is right', async () => {
    expect((await server.call('GET', '/api/nothing-here')).status).toBe(404);
  });
});

describe('backup', () => {
  it('starts empty', async () => {
    expect(await (await server.call('GET', '/api/backup')).json()).toEqual({ snapshots: [], photoIds: [] });
    expect((await server.call('GET', '/api/backup/snapshots/latest')).status).toBe(404);
    const status = (await (await server.call('GET', '/api/status')).json()) as { backups: unknown; pushKey: string };
    expect(status.backups).toEqual({ count: 0, latestAt: null });
    expect(status.pushKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
  });

  it('stores photos and a snapshot and hands them back unchanged', async () => {
    expect((await server.call('PUT', '/api/backup/photos/p1', { body: 'AAAA', now: at(1) })).status).toBe(200);
    expect((await server.call('PUT', '/api/backup/photos/p2', { body: 'BBBB', now: at(1) })).status).toBe(200);
    const saved = await server.call('POST', '/api/backup/snapshots', { body: { data: 'c2VhbGVk', photoIds: ['p1', 'p2'] }, now: at(1) });
    expect(saved.status).toBe(200);
    const { id } = (await saved.json()) as { id: string };

    const list = (await (await server.call('GET', '/api/backup')).json()) as { snapshots: unknown[]; photoIds: string[] };
    expect(list.snapshots).toEqual([{ id, createdAt: at(1).toISOString(), size: 8, photos: 2 }]);
    expect(list.photoIds.sort()).toEqual(['p1', 'p2']);

    const latest = await (await server.call('GET', '/api/backup/snapshots/latest')).json();
    expect(latest).toEqual({ id, createdAt: at(1).toISOString(), data: 'c2VhbGVk', photoIds: ['p1', 'p2'] });
    expect(await (await server.call('GET', `/api/backup/snapshots/${id}`)).json()).toEqual(latest);
    expect(await (await server.call('GET', '/api/backup/photos/p2')).text()).toBe('BBBB');
    expect((await server.call('GET', '/api/backup/photos/nope')).status).toBe(404);
  });

  it('keeps a photo larger than one database row whole', async () => {
    const big = 'abcdefghij'.repeat((CHUNK_CHARS * 2.5) / 10);
    expect((await server.call('PUT', '/api/backup/photos/big', { body: big })).status).toBe(200);
    const rows = await server.env.DB.prepare(`SELECT COUNT(*) AS n, MAX(length(data)) AS longest FROM chunks`).first<{ n: number; longest: number }>();
    expect(rows).toEqual({ n: 3, longest: CHUNK_CHARS });
    expect(await (await server.call('GET', '/api/backup/photos/big')).text()).toBe(big);

    // Uploading it again replaces it and leaves no stray rows behind.
    await server.call('PUT', '/api/backup/photos/big', { body: 'small' });
    expect(await (await server.call('GET', '/api/backup/photos/big')).text()).toBe('small');
    expect(await server.env.DB.prepare(`SELECT COUNT(*) AS n FROM chunks`).first()).toEqual({ n: 1 });
  });

  it('refuses a snapshot that names a photo it does not hold', async () => {
    await server.call('PUT', '/api/backup/photos/p1', { body: 'AAAA' });
    const response = await server.call('POST', '/api/backup/snapshots', { body: { data: 'x', photoIds: ['p1', 'p9'] } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ missing: ['p9'] });
    expect((await server.call('GET', '/api/backup/snapshots/latest')).status).toBe(404);
  });

  it('refuses ids and bodies it cannot use', async () => {
    expect((await server.call('PUT', '/api/backup/photos/bad%20id', { body: 'AAAA' })).status).toBe(400);
    expect((await server.call('PUT', '/api/backup/photos/p1', { body: '' })).status).toBe(400);
    expect((await server.call('POST', '/api/backup/snapshots', { body: 'not json' })).status).toBe(400);
    expect((await server.call('POST', '/api/backup/snapshots', { body: { data: '', photoIds: [] } })).status).toBe(400);
    expect((await server.call('POST', '/api/backup/snapshots', { body: { data: 'x', photoIds: ['../x'] } })).status).toBe(400);
    expect((await server.call('GET', '/api/backup/snapshots/bad%20id')).status).toBe(400);
  });

  it(`keeps the newest ${SNAPSHOTS_KEPT} snapshots and drops photos nothing points to`, async () => {
    await server.call('PUT', '/api/backup/photos/old', { body: 'OLD', now: at(1) });
    await server.call('PUT', '/api/backup/photos/kept', { body: 'KEPT', now: at(1) });
    await server.call('POST', '/api/backup/snapshots', { body: { data: 'day1', photoIds: ['old', 'kept'] }, now: at(1) });
    for (let day = 2; day <= SNAPSHOTS_KEPT + 1; day++) {
      const response = await server.call('POST', '/api/backup/snapshots', { body: { data: `day${day}`, photoIds: ['kept'] }, now: at(day) });
      expect(((await response.json()) as { kept: number }).kept).toBe(Math.min(day, SNAPSHOTS_KEPT));
    }
    const list = (await (await server.call('GET', '/api/backup')).json()) as { snapshots: { createdAt: string }[]; photoIds: string[] };
    expect(list.snapshots).toHaveLength(SNAPSHOTS_KEPT);
    expect(list.snapshots[0]!.createdAt).toBe(at(SNAPSHOTS_KEPT + 1).toISOString());
    expect(list.snapshots.at(-1)!.createdAt).toBe(at(2).toISOString());
    // The first snapshot was the only one that used "old".
    expect(list.photoIds).toEqual(['kept']);
    expect((await server.call('GET', '/api/backup/photos/old')).status).toBe(404);
    // Its contents went with it: one row per remaining snapshot, plus one photo.
    expect(await server.env.DB.prepare(`SELECT COUNT(*) AS n FROM chunks`).first()).toEqual({ n: SNAPSHOTS_KEPT + 1 });
  });

  it('leaves a just-uploaded photo alone while its backup is still in progress', async () => {
    await server.call('PUT', '/api/backup/photos/a', { body: 'A', now: at(1) });
    await server.call('PUT', '/api/backup/photos/in-progress', { body: 'B', now: at(1, 11) });
    await server.call('POST', '/api/backup/snapshots', { body: { data: 'x', photoIds: ['a'] }, now: at(1, 12) });
    expect((await server.call('GET', '/api/backup/photos/in-progress')).status).toBe(200);
    // A day and more later it is still unclaimed, so it goes.
    await server.call('POST', '/api/backup/snapshots', { body: { data: 'y', photoIds: ['a'] }, now: at(3) });
    expect((await server.call('GET', '/api/backup/photos/in-progress')).status).toBe(404);
  });

  it('erases everything on request', async () => {
    await server.call('PUT', '/api/backup/photos/p1', { body: 'AAAA' });
    await server.call('POST', '/api/backup/snapshots', { body: { data: 'x', photoIds: ['p1'] } });
    const before = (await (await server.call('GET', '/api/status')).json()) as { pushKey: string };
    expect((await server.call('DELETE', '/api/data')).status).toBe(200);
    expect(await (await server.call('GET', '/api/backup')).json()).toEqual({ snapshots: [], photoIds: [] });
    for (const table of ['chunks', 'blobs', 'snapshots', 'reminders']) {
      expect(await server.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first(), table).toEqual({ n: 0 });
    }
    // The signing keys go too, and new ones are made when next needed.
    const after = (await (await server.call('GET', '/api/status')).json()) as { pushKey: string };
    expect(after.pushKey).not.toBe(before.pushKey);
  });
});

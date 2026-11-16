// @vitest-environment node
// Runs outside the browser stand-in, because the local Cloudflare server cannot start inside it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importBackup } from './backup';
import { db } from './db';
import { createPiece } from './piecesRepo';
import { connectServer, getAppKey } from './server';
import { backupIfDue, backupNow, getBackupState, restoreFromServer, turnOnBackup } from './serverBackup';
import { eraseEverything } from './setup';
import { fakeImage, sampleSetupFile } from '../test/fixtures';
import { startAppServer, type AppServer } from '../test/appServer';

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

async function loadedPhone() {
  await importBackup(sampleSetupFile());
  await connectServer(server.key);
  await turnOnBackup();
}

async function addPhoto(pieceId: string, kind: 'clothing' | 'inspiration' | 'of-me', bytes: number[]) {
  const id = `ph-${kind}-${bytes.join('')}`;
  await db.photos.add({ id, pieceId, kind, order: 0, createdAt: '2026-01-05T09:00:00.000Z', ...fakeImage(bytes) });
  return id;
}

describe('automatic backup', () => {
  it('uploads a copy the server cannot read', async () => {
    await loadedPhone();
    const photoId = await addPhoto('pc-knit', 'clothing', [7, 7, 7, 7]);
    const result = await backupNow();
    expect(result).toMatchObject({ uploaded: true, photosUploaded: 1 });

    const snapshots = await server.snapshots();
    expect(snapshots).toHaveLength(1);
    expect(await server.photoIds()).toEqual([photoId]);
    // Nothing the server was sent contains readable wardrobe data.
    const everythingSent = server.requests.map((r) => `${r.path} ${r.body ?? ''}`).join('\n');
    for (const word of ['Navy zip cardigan', 'Springfield', 'Light olive', 'pc-knit', 'No leather']) {
      expect(everythingSent).not.toContain(word);
      expect(atob(snapshots[0]!.data)).not.toContain(word);
    }
    // The recovery code never leaves the phone either.
    const code = (await getBackupState()).recoveryCode!;
    expect(code).toHaveLength(64);
    expect(everythingSent).not.toContain(code);
    expect(everythingSent).not.toContain(code.replace(/-/g, ''));
    expect((await getBackupState()).lastAt).toBe(snapshots[0]!.createdAt);
  });

  it('never uploads a photo of the owner', async () => {
    await loadedPhone();
    await addPhoto('pc-knit', 'clothing', [1, 1, 1, 1]);
    await addPhoto('pc-knit', 'inspiration', [2, 2, 2, 2]);
    const mine = await addPhoto('color-test', 'of-me', [3, 3, 3, 3]);
    await backupNow();
    expect(await server.photoIds()).toEqual(['ph-clothing-1111', 'ph-inspiration-2222']);
    expect((await server.snapshots())[0]!.photoIds).not.toContain(mine);
    expect(server.requests.some((r) => r.path.includes(mine))).toBe(false);
  });

  it('uploads each photo once, and nothing at all when nothing changed', async () => {
    await loadedPhone();
    await addPhoto('pc-knit', 'clothing', [1, 1, 1, 1]);
    await backupNow();
    const before = server.requests.length;

    expect(await backupNow()).toMatchObject({ uploaded: false, photosUploaded: 0 });
    expect(server.requests.length).toBe(before);

    await addPhoto('pc-tee', 'clothing', [2, 2, 2, 2]);
    expect(await backupNow()).toMatchObject({ uploaded: true, photosUploaded: 1 });
    expect(server.requests.filter((r) => r.method === 'PUT')).toHaveLength(2);
    const snapshots = await server.snapshots();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]!.photoIds).toHaveLength(2);
  });

  it('sends again any photo the server says it lacks', async () => {
    await loadedPhone();
    const id = await addPhoto('pc-knit', 'clothing', [1, 1, 1, 1]);
    await backupNow();
    await createPiece({ name: 'Grey scarf', status: 'owned', slots: ['accessory'], tags: [], detailsConfirmed: true });
    await server.deletePhoto(id);
    expect(await backupNow()).toMatchObject({ uploaded: true, photosUploaded: 1 });
    expect(await server.photoIds()).toEqual([id]);
    expect(await server.snapshots()).toHaveLength(2);
  });

  it('runs about once a day when the app is opened, and not before it is turned on', async () => {
    await importBackup(sampleSetupFile());
    const t0 = Date.parse('2026-01-05T08:00:00Z');
    const hours = (n: number) => t0 + n * 60 * 60 * 1000;
    vi.useFakeTimers({ now: t0, toFake: ['Date'] });
    try {
      expect(await backupIfDue(hours(0))).toBeUndefined();
      await connectServer(server.key);
      expect(await backupIfDue(hours(0))).toBeUndefined();
      expect(await server.snapshots()).toHaveLength(0);

      await turnOnBackup();
      expect(await backupIfDue(hours(0))).toMatchObject({ uploaded: true });
      vi.setSystemTime(hours(5));
      expect(await backupIfDue(hours(5))).toBeUndefined();
      // The next morning: checked again, and nothing had changed.
      vi.setSystemTime(hours(24));
      expect(await backupIfDue(hours(24))).toMatchObject({ uploaded: false });
      await createPiece({ name: 'Grey scarf', status: 'owned', slots: ['accessory'], tags: [], detailsConfirmed: true });
      vi.setSystemTime(hours(48));
      expect(await backupIfDue(hours(48))).toMatchObject({ uploaded: true });
      expect(await server.snapshots()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the reason when a backup fails, and does not stop the app opening', async () => {
    await loadedPhone();
    server.down = true;
    await expect(backupNow()).rejects.toThrow('could not be reached');
    expect((await getBackupState()).lastError).toContain('could not be reached');

    // Opening the app again a moment later does not hammer the server.
    const calls = server.requests.length;
    expect(await backupIfDue()).toBeUndefined();
    expect(server.requests.length).toBe(calls);

    server.down = false;
    await backupNow();
    expect((await getBackupState()).lastError).toBeUndefined();
  });
});

describe('restore', () => {
  async function backedUpPhone() {
    await loadedPhone();
    const photoId = await addPhoto('pc-knit', 'clothing', [5, 6, 7, 8]);
    await backupNow();
    const code = (await getBackupState()).recoveryCode!;
    const before = { profile: await db.profile.get('me'), pieces: await db.pieces.toArray(), photo: await db.photos.get(photoId) };
    return { code, before, photoId };
  }

  it('brings everything back on a new phone with the app key and the recovery code', async () => {
    const { code, before, photoId } = await backedUpPhone();
    await eraseEverything();
    expect(await db.pieces.count()).toBe(0);
    expect(await getAppKey()).toBeUndefined();

    const progress: string[] = [];
    const result = await restoreFromServer({ appKey: server.key, recoveryCode: code.toLowerCase(), onProgress: (d, t) => progress.push(`${d}/${t}`) });
    expect(result).toMatchObject({ pieces: 5, photos: 1 });
    expect(progress).toEqual(['0/1', '1/1']);

    expect(await db.profile.get('me')).toEqual(before.profile);
    expect(await db.pieces.toArray()).toEqual(before.pieces);
    const photo = await db.photos.get(photoId);
    expect({ ...photo, data: [...new Uint8Array(photo!.data)], thumb: [...new Uint8Array(photo!.thumb)] }).toEqual({
      ...before.photo,
      data: [5, 6, 7, 8],
      thumb: [5, 6],
    });

    // The phone is connected again and carries on the same backup.
    expect(await getAppKey()).toBe(server.key);
    expect(await getBackupState()).toMatchObject({ on: true, recoveryCode: code });
    const sent = server.requests.length;
    expect(await backupNow()).toMatchObject({ uploaded: false });
    expect(server.requests.length).toBe(sent);
  });

  it('changes nothing when the recovery code is wrong', async () => {
    await backedUpPhone();
    await createPiece({ name: 'Grey scarf', status: 'owned', slots: ['accessory'], tags: [], detailsConfirmed: true });
    const other = await prepareOtherCode();
    await expect(restoreFromServer({ recoveryCode: other })).rejects.toThrow('does not open this backup');
    await expect(restoreFromServer({ recoveryCode: 'ABCD-EFGH' })).rejects.toThrow('not complete');
    expect(await db.pieces.count()).toBe(6);
  });

  it('changes nothing when the app key is wrong or a photo cannot be fetched', async () => {
    const { code, photoId } = await backedUpPhone();
    await createPiece({ name: 'Grey scarf', status: 'owned', slots: ['accessory'], tags: [], detailsConfirmed: true });
    await expect(restoreFromServer({ appKey: 'wrong-key-0123456789-abcdef', recoveryCode: code })).rejects.toThrow('app key is not right');
    await server.deletePhoto(photoId);
    await expect(restoreFromServer({ recoveryCode: code })).rejects.toThrow();
    expect(await db.pieces.count()).toBe(6);
    expect(await getAppKey()).toBe(server.key);
  });

  it('says so when the server has no backup yet', async () => {
    await loadedPhone();
    const code = (await getBackupState()).recoveryCode!;
    await expect(restoreFromServer({ recoveryCode: code })).rejects.toThrow('no backup on the server yet');
  });

  it('leaves photos of the owner on this phone alone', async () => {
    const { code } = await backedUpPhone();
    const mine = await addPhoto('color-test', 'of-me', [9, 9, 9, 9]);
    await restoreFromServer({ recoveryCode: code });
    expect(await db.photos.get(mine)).toBeDefined();
  });
});

async function prepareOtherCode(): Promise<string> {
  const { newRecoveryCode } = await import('./vault');
  return newRecoveryCode();
}

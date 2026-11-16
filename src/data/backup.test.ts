import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeImage, samplePieces, sampleSetupFile } from '../test/fixtures';
import { exportBackup, fromBase64, importBackup, parseBackup, toBase64 } from './backup';
import { db } from './db';
import { createPiece, listPhotos, listPieces } from './piecesRepo';
import { getProfile, updateProfile } from './profileRepo';
import { eraseEverything, startEmpty } from './setup';

describe('base64', () => {
  it('round-trips bytes, including a buffer larger than one chunk', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(new Uint8Array(fromBase64(toBase64(bytes.buffer)))).toEqual(bytes);
  });
});

describe('setup file', () => {
  it('loads the profile and pieces into an empty app', async () => {
    const result = await importBackup(sampleSetupFile());
    expect(result).toMatchObject({ kind: 'setup', piecesAdded: 5, piecesKept: 0 });
    expect((await getProfile())?.sizes[0]).toMatchObject({ label: 'Tops', value: 'M' });
    expect(await listPieces()).toHaveLength(5);
  });

  it('replaces the profile but keeps pieces and photos already on the phone', async () => {
    await importBackup(sampleSetupFile());
    await updateProfile({ budget: 'Changed in the app' });
    const mine = await createPiece({ name: 'My own piece', status: 'owned', slots: ['shoes'], tags: [], detailsConfirmed: true }, { add: [fakeImage()] });
    await db.pieces.update('pc-tee', { name: 'Edited tee' });

    const result = await importBackup(sampleSetupFile());

    expect(result).toMatchObject({ piecesAdded: 0, piecesKept: 5 });
    expect((await getProfile())?.budget).toBe('No cap set.');
    const pieces = await listPieces();
    expect(pieces).toHaveLength(6);
    expect(pieces.find((p) => p.id === 'pc-tee')?.name).toBe('Edited tee');
    expect(await listPhotos(mine.id)).toHaveLength(1);
  });
});

describe('backup', () => {
  it('exports everything and restores it after an erase', async () => {
    await importBackup(sampleSetupFile());
    const piece = await createPiece({ name: 'With photo', status: 'owned', slots: ['shoes'], tags: [], detailsConfirmed: true }, { add: [fakeImage([9, 8, 7])] });

    const profileBefore = await getProfile();
    const text = JSON.stringify(await exportBackup());
    await eraseEverything();
    expect(await getProfile()).toBeUndefined();
    expect(await listPieces()).toEqual([]);

    const result = await importBackup(parseBackup(text));
    expect(result).toMatchObject({ kind: 'backup', piecesAdded: 6, photos: 1 });
    expect(await getProfile()).toEqual(profileBefore);
    const [photo] = await listPhotos(piece.id);
    expect(new Uint8Array(photo!.data)).toEqual(new Uint8Array([9, 8, 7]));
    expect(new Uint8Array(photo!.thumb)).toEqual(new Uint8Array([9, 8]));
  });

  it('replaces what is on the phone', async () => {
    await importBackup(sampleSetupFile());
    const backup = await exportBackup();
    await createPiece({ name: 'Added later', status: 'owned', slots: ['shoes'], tags: [], detailsConfirmed: true });
    await importBackup(backup);
    expect((await listPieces()).map((p) => p.name)).not.toContain('Added later');
  });

  it('leaves photos of the owner out of a backup, and a restore does not delete them', async () => {
    await importBackup(sampleSetupFile());
    const mine = { id: 'ph-me', pieceId: 'none', kind: 'of-me' as const, order: 0, createdAt: 'x', ...fakeImage() };
    await db.photos.add(mine);

    const backup = await exportBackup();
    expect(backup.includesPrivatePhotos).toBe(false);
    expect(backup.photos).toEqual([]);

    await importBackup(backup);
    expect(await db.photos.get('ph-me')).toBeDefined();

    const full = await exportBackup({ includePrivatePhotos: true });
    expect(full.photos.map((p) => p.id)).toEqual(['ph-me']);
  });

  it('never exports saved settings', async () => {
    await startEmpty();
    await db.meta.put({ key: 'ai-key', value: 'secret-value' });
    expect(JSON.stringify(await exportBackup())).not.toContain('secret-value');
  });
});

describe('parseBackup', () => {
  const valid = () => JSON.parse(JSON.stringify(sampleSetupFile()));

  it('accepts the example file in the repository, which matches the test sample', () => {
    const text = readFileSync(resolve(__dirname, '../../examples/sample-setup.json'), 'utf8');
    const { wishlist, ...rest } = parseBackup(text);
    expect(rest).toEqual(valid());
    // The example also carries a short made-up buy-next list, so the Buy next screen has something to show.
    expect(wishlist?.map((item) => [item.name, item.state, item.options.length])).toEqual([
      ['Black belt', 'open', 1],
      ['White trainers', 'open', 2],
      ['White shirt', 'open', 0],
    ]);
  });

  it('accepts a valid file', () => {
    expect(parseBackup(JSON.stringify(valid())).pieces).toHaveLength(samplePieces().length);
  });

  it.each([
    ['text that is not JSON', 'not json', 'not a wardrobe file'],
    ['some other JSON', JSON.stringify({ hello: 'world' }), 'not a wardrobe file'],
    ['a newer format', JSON.stringify({ ...valid(), formatVersion: 99 }), 'newer version'],
    ['an unknown kind', JSON.stringify({ ...valid(), kind: 'other' }), 'not a wardrobe file'],
    ['missing pieces', JSON.stringify({ ...valid(), pieces: undefined }), 'incomplete'],
    ['a broken piece', JSON.stringify({ ...valid(), pieces: [{ id: 1 }] }), 'piece the app cannot read'],
    ['a broken photo', JSON.stringify({ ...valid(), photos: [{ id: 'x' }] }), 'photo the app cannot read'],
    ['a broken profile', JSON.stringify({ ...valid(), profile: { id: 'me' } }), 'profile the app cannot read'],
  ])('rejects %s', (_name, text, message) => {
    expect(() => parseBackup(text)).toThrow(message);
  });

  it('changes nothing when a file is rejected', async () => {
    await importBackup(sampleSetupFile());
    expect(() => parseBackup('{}')).toThrow();
    expect(await listPieces()).toHaveLength(5);
  });
});

describe('erase and start empty', () => {
  it('starts with a blank profile and does not overwrite an existing one', async () => {
    await startEmpty();
    expect((await getProfile())?.rules).toEqual([]);
    await updateProfile({ budget: 'Mine' });
    await startEmpty();
    expect((await getProfile())?.budget).toBe('Mine');
  });

  it('erases the profile, pieces, photos and settings', async () => {
    await importBackup(sampleSetupFile());
    await createPiece({ name: 'P', status: 'owned', slots: ['shoes'], tags: [], detailsConfirmed: true }, { add: [fakeImage()] });
    await db.meta.put({ key: 'k', value: 'v' });
    await eraseEverything();
    expect(await db.profile.count()).toBe(0);
    expect(await db.pieces.count()).toBe(0);
    expect(await db.photos.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
  });
});

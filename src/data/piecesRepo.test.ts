import { describe, expect, it } from 'vitest';
import { fakeImage } from '../test/fixtures';
import type { PieceDraft } from '../domain/types';
import { db } from './db';
import { coverPhotos, createPiece, deletePiece, getPiece, listPhotos, listPieces, updatePiece } from './piecesRepo';

const draft = (changes: Partial<PieceDraft> = {}): PieceDraft => ({
  name: 'Navy zip cardigan',
  status: 'owned',
  slots: ['main-top'],
  tags: [],
  detailsConfirmed: true,
  ...changes,
});

describe('pieces', () => {
  it('creates a piece with an id, timestamps and a wear count of zero', async () => {
    const piece = await createPiece(draft());
    expect(piece.id).toBeTruthy();
    expect(piece.wearCount).toBe(0);
    expect(piece.createdAt).toBe(piece.updatedAt);
    expect(await getPiece(piece.id)).toEqual(piece);
  });

  it('tidies text and tags on save', async () => {
    const piece = await createPiece(draft({ name: '  Tan chinos ', brand: '   ', cloth: ' Cotton ', tags: ['Slim', ' slim', '', 'Office'] }));
    expect(piece.name).toBe('Tan chinos');
    expect(piece.brand).toBeUndefined();
    expect(piece.cloth).toBe('Cotton');
    expect(piece.tags).toEqual(['slim', 'office']);
  });

  it('refuses a piece with no name or no slot', async () => {
    await expect(createPiece(draft({ name: '  ' }))).rejects.toThrow('needs a name');
    await expect(createPiece(draft({ slots: [] }))).rejects.toThrow('where the piece goes');
    expect(await listPieces()).toEqual([]);
  });

  it('updates a piece and keeps its id, created date and wear count', async () => {
    const piece = await createPiece(draft({ wearCount: 3 }));
    const updated = await updatePiece(piece.id, draft({ name: 'Navy cardigan', colorFamily: 'navy' }));
    expect(updated.id).toBe(piece.id);
    expect(updated.createdAt).toBe(piece.createdAt);
    expect(updated.wearCount).toBe(3);
    expect(updated.name).toBe('Navy cardigan');
    expect((await getPiece(piece.id))?.colorFamily).toBe('navy');
  });

  it('fails to update a piece that is gone', async () => {
    await expect(updatePiece('missing', draft())).rejects.toThrow('no longer exists');
  });

  it('lists pieces in outfit order, then by name', async () => {
    await createPiece(draft({ name: 'Loafers', slots: ['shoes'] }));
    await createPiece(draft({ name: 'Zip knit', slots: ['main-top'] }));
    await createPiece(draft({ name: 'Chinos', slots: ['trousers'] }));
    await createPiece(draft({ name: 'Cable crew', slots: ['main-top'] }));
    expect((await listPieces()).map((p) => p.name)).toEqual(['Cable crew', 'Zip knit', 'Chinos', 'Loafers']);
  });

  it('finds pieces by slot through the index', async () => {
    await createPiece(draft({ name: 'Tee', slots: ['under-layer', 'main-top'] }));
    await createPiece(draft({ name: 'Chinos', slots: ['trousers'] }));
    const tops = await db.pieces.where('slots').equals('main-top').toArray();
    expect(tops.map((p) => p.name)).toEqual(['Tee']);
  });
});

describe('photos', () => {
  it('stores photos with a piece, in order, as clothing photos', async () => {
    const piece = await createPiece(draft(), { add: [fakeImage([1, 1]), fakeImage([2, 2])] });
    const photos = await listPhotos(piece.id);
    expect(photos.map((p) => p.order)).toEqual([0, 1]);
    expect(photos.every((p) => p.kind === 'clothing')).toBe(true);
    expect(new Uint8Array(photos[1]!.data)).toEqual(new Uint8Array([2, 2]));
  });

  it('adds new photos after the ones already there and removes the ones asked for', async () => {
    const piece = await createPiece(draft(), { add: [fakeImage([1]), fakeImage([2])] });
    const [first] = await listPhotos(piece.id);
    await updatePiece(piece.id, draft(), { add: [fakeImage([3])], remove: [first!.id] });
    const photos = await listPhotos(piece.id);
    expect(photos.map((p) => new Uint8Array(p.data)[0])).toEqual([2, 3]);
    expect(photos.map((p) => p.order)).toEqual([1, 2]);
  });

  it('gives the first photo of each piece as its cover', async () => {
    const a = await createPiece(draft({ name: 'A' }), { add: [fakeImage([7]), fakeImage([8])] });
    const b = await createPiece(draft({ name: 'B' }));
    const covers = await coverPhotos();
    expect(new Uint8Array(covers.get(a.id)!.data)[0]).toBe(7);
    expect(covers.has(b.id)).toBe(false);
  });

  it('deletes the photos with the piece', async () => {
    const piece = await createPiece(draft(), { add: [fakeImage()] });
    const other = await createPiece(draft({ name: 'Other' }), { add: [fakeImage()] });
    await deletePiece(piece.id);
    expect(await getPiece(piece.id)).toBeUndefined();
    expect(await listPhotos(piece.id)).toEqual([]);
    expect(await listPhotos(other.id)).toHaveLength(1);
  });
});

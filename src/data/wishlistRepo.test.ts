import { describe, expect, it } from 'vitest';
import { sampleWishlist, wantBoots, wantShirt, wantTrainers } from '../test/buyFixtures';
import { sampleSetupFile } from '../test/fixtures';
import { exportBackup, importBackup, parseBackup } from './backup';
import { db } from './db';
import { buyListReady } from './lookWishes';
import { getPiece, listPieces } from './piecesRepo';
import { eraseEverything } from './setup';
import {
  addOption,
  addWishes,
  awaitingFitCheck,
  chooseOption,
  createWish,
  dropWish,
  getWish,
  listWishes,
  markBought,
  recordCheck,
  removeLookFromWishes,
  removeOption,
  saveFitCheck,
  updateOption,
  updateWish,
} from './wishlistRepo';
import type { LookWish } from '../domain/buyNext/types';

const today = '2026-01-06';
const lookShirt: LookWish = { slot: 'main-top', name: 'White button-down shirt', colorFamily: 'white', neckline: 'shirt-collar', tags: ['Oxford '], note: 'Worn open over a tee.', lookId: 'look-1' };

describe('needed pieces', () => {
  it('adds one with a clean name and tags, and refuses one with no name or no place in an outfit', async () => {
    const item = await createWish({ name: '  Grey flannel trousers ', spec: { slots: ['trousers'], tags: [' Pleated', 'pleated', ''] }, origin: 'beyond-looks', beyondSource: 'in-season', why: ' ' });
    expect(item).toMatchObject({ name: 'Grey flannel trousers', state: 'open', options: [], spec: { tags: ['pleated'] }, beyondSource: 'in-season' });
    expect(item.why).toBeUndefined();
    await expect(createWish({ name: ' ', spec: { slots: ['trousers'], tags: [] }, origin: 'your-looks' })).rejects.toThrow('needs a name');
    await expect(createWish({ name: 'Thing', spec: { slots: [], tags: [] }, origin: 'your-looks' })).rejects.toThrow('where the piece goes');
  });

  it('edits a line and keeps its products', async () => {
    await db.wishlist.bulkPut(sampleWishlist());
    const next = await updateWish('w-trainers', { name: 'White leather sneakers', spec: wantTrainers.spec, origin: 'your-looks', beyondSource: 'in-season' });
    expect(next.name).toBe('White leather sneakers');
    expect(next.options).toHaveLength(2);
    // "Beyond your looks" detail does not stick to a piece from the saved looks.
    expect(next.beyondSource).toBeUndefined();
  });

  it('takes a line off the list without deleting it', async () => {
    await db.wishlist.put(wantBoots);
    await dropWish('w-boots');
    expect((await getWish('w-boots'))?.state).toBe('dropped');
  });
});

describe('products under a line', () => {
  it('adds, edits and removes a product, and refuses a link that is not https', async () => {
    await db.wishlist.put(wantBoots);
    await expect(addOption('w-boots', { role: 'exact', name: 'Boot', store: 'Shop', url: 'http://shop.example/boot' }, today)).rejects.toThrow('https://');
    await expect(addOption('w-boots', { role: 'exact', name: '', store: 'Shop' }, today)).rejects.toThrow('needs a name');
    const item = await addOption('w-boots', { role: 'exact', name: ' Chelsea boot ', store: 'Shop', url: 'https://shop.example/boot', price: 250 }, today);
    expect(item.options).toEqual([expect.objectContaining({ name: 'Chelsea boot', source: 'you', addedOn: today, price: 250 })]);
    const id = item.options[0]!.id;
    expect((await updateOption('w-boots', id, { role: 'lookalike', name: 'Chelsea boot', store: 'Shop', givesUp: 'Corrected grain leather.' })).options[0]).toMatchObject({ role: 'lookalike', givesUp: 'Corrected grain leather.', addedOn: today });
    expect((await removeOption('w-boots', id)).options).toEqual([]);
  });

  it('keeps one pick at a time', async () => {
    await db.wishlist.bulkPut(sampleWishlist());
    await chooseOption('w-trainers', 'o-trainer-exact');
    const item = await chooseOption('w-trainers', 'o-trainer-alike');
    expect(item.options.map((o) => o.chosen)).toEqual([false, true]);
    expect((await chooseOption('w-trainers', undefined)).options.some((o) => o.chosen)).toBe(false);
  });

  it('records what the owner saw, replacing the earlier look', async () => {
    await db.wishlist.bulkPut(sampleWishlist());
    const item = await recordCheck('w-trainers', 'o-trainer-exact', { on: today, by: 'you', price: 110, stock: 'in-stock', size: '9', pickup: 'today' });
    expect(item.options[0]!.check).toEqual({ on: today, by: 'you', price: 110, stock: 'in-stock', size: '9', pickup: 'today' });
    // The price first found stays as it was. The check carries the newer one with its date.
    expect(item.options[0]!.price).toBe(120);
  });
});

describe('bought it and the fit check', () => {
  it('moves the piece to the wardrobe with the tags of its spec, still to be confirmed', async () => {
    await db.wishlist.bulkPut(sampleWishlist());
    const { item, piece } = await markBought('w-trainers', { on: today, optionId: 'o-trainer-exact', pricePaid: 110, returnBy: '2026-02-05' });
    expect(item).toMatchObject({ state: 'bought', pieceId: piece.id, bought: { on: today, pricePaid: 110, returnBy: '2026-02-05' } });
    expect(await getPiece(piece.id)).toMatchObject({
      name: 'White trainers',
      status: 'owned',
      slots: ['shoes'],
      colorFamily: 'white',
      dressLevel: 1,
      pricePaid: 110,
      acquiredOn: today,
      link: 'https://shop.example/court-classic',
      notes: 'Court Classic sneaker, Sample Store.',
      wearCount: 0,
      detailsConfirmed: false,
    });
    expect((await awaitingFitCheck()).map((w) => w.id)).toEqual(['w-trainers']);
    await expect(markBought('w-trainers', { on: today })).rejects.toThrow('already in your wardrobe');
  });

  it('keeps the piece after a fit check that says keep or tailor', async () => {
    await db.wishlist.bulkPut(sampleWishlist());
    const { piece } = await markBought('w-trainers', { on: today });
    const item = await saveFitCheck('w-trainers', { on: '2026-01-09', answers: { 'trouser-length': 'fixable' }, verdict: 'tailor', note: 'Hem one inch.' });
    expect(item.fitCheck?.verdict).toBe('tailor');
    expect(item.state).toBe('bought');
    expect((await getPiece(piece.id))?.notes).toBe('Fit check 2026-01-09: needs a tailor. Hem one inch.');
    expect(await awaitingFitCheck()).toEqual([]);
  });

  it('sends a failed piece back: out of the wardrobe, back on the list, with a note on the product', async () => {
    await db.wishlist.bulkPut(sampleWishlist());
    const { piece } = await markBought('w-trainers', { on: today, optionId: 'o-trainer-exact' });
    const item = await saveFitCheck('w-trainers', { on: '2026-01-09', answers: { hardware: 'fail' }, verdict: 'return', note: 'Gold eyelets.' });
    expect(await getPiece(piece.id)).toBeUndefined();
    expect(item).toMatchObject({ state: 'open' });
    expect(item.pieceId).toBeUndefined();
    expect(item.bought).toBeUndefined();
    expect(item.options[0]!.note).toBe('Bought and sent back after the fit check on 2026-01-09. Gold eyelets.');
    expect(item.options[1]!.note).toBeUndefined();
  });
});

describe('pieces missing from saved looks', () => {
  it('is plugged into the saved-look screens', () => {
    expect(buyListReady()).toBe(true);
  });

  it('adds a line for a missing piece, marked with its look', async () => {
    const [item] = await addWishes([lookShirt]);
    expect(item).toMatchObject({ name: 'White button-down shirt', origin: 'your-looks', lookIds: ['look-1'], lookFor: 'Worn open over a tee.', state: 'open', options: [] });
    expect(item!.spec).toEqual({ slots: ['main-top'], colorFamily: 'white', depth: undefined, texture: undefined, neckline: 'shirt-collar', dressLevel: undefined, tags: ['oxford'] });
  });

  it('joins a second look to the open line for the same thing', async () => {
    await db.wishlist.put(wantShirt);
    const lines = await addWishes([lookShirt, { ...lookShirt, lookId: 'look-2' }, { ...lookShirt, name: 'Navy shirt', colorFamily: 'navy', lookId: 'look-2' }]);
    expect(lines.map((l) => l.id)).toEqual(['w-shirt', 'w-shirt', lines[2]!.id]);
    expect(lines[2]!.id).not.toBe('w-shirt');
    expect((await getWish('w-shirt'))?.lookIds).toEqual(['look-1', 'look-2']);
    expect(await listWishes()).toHaveLength(2);
    // Sending the same look again changes nothing.
    await addWishes([lookShirt]);
    expect((await getWish('w-shirt'))?.lookIds).toEqual(['look-1', 'look-2']);
  });

  it('does not join a line that was bought or taken off the list', async () => {
    await db.wishlist.put({ ...wantShirt, state: 'bought' });
    const [item] = await addWishes([lookShirt]);
    expect(item!.id).not.toBe('w-shirt');
  });

  it('lets go of a look: a line that came only from it goes, any other line just loses it', async () => {
    const [fromLook, withProduct, shared, kept] = await addWishes([
      lookShirt,
      { ...lookShirt, name: 'Brown boots', slot: 'shoes', colorFamily: 'brown', neckline: undefined },
      { ...lookShirt, name: 'Cream trousers', slot: 'trousers', colorFamily: 'cream', neckline: undefined },
      { ...lookShirt, name: 'Navy coat', slot: 'outer-layer', colorFamily: 'navy', neckline: undefined },
    ]);
    await addOption(withProduct!.id, { role: 'exact', name: 'Boot', store: 'Shop' }, today);
    await addWishes([{ ...lookShirt, name: 'Cream trousers', slot: 'trousers', colorFamily: 'cream', neckline: undefined, lookId: 'look-2' }]);

    await removeLookFromWishes('look-1', [kept!.id]);

    expect(await getWish(fromLook!.id)).toBeUndefined();
    expect((await getWish(withProduct!.id))?.lookIds).toBeUndefined();
    expect((await getWish(shared!.id))?.lookIds).toEqual(['look-2']);
    expect((await getWish(kept!.id))?.lookIds).toEqual(['look-1']);
  });
});

describe('the list in files', () => {
  it('travels in a backup and comes back whole', async () => {
    await importBackup(sampleSetupFile());
    await db.wishlist.bulkPut(sampleWishlist());
    const file = parseBackup(JSON.stringify(await exportBackup()));
    expect(file.wishlist).toHaveLength(6);
    await eraseEverything();
    expect(await listWishes()).toEqual([]);
    const result = await importBackup(file);
    expect(result.wishesAdded).toBe(6);
    expect(await getWish('w-trainers')).toEqual(sampleWishlist()[0]);
  });

  it('comes with a setup file: new lines are added, and a line already on the phone keeps what was done to it', async () => {
    await importBackup({ ...sampleSetupFile(), wishlist: [wantTrainers] });
    await recordCheck('w-trainers', 'none', { on: today, by: 'you' });
    await markBought('w-trainers', { on: today });
    const result = await importBackup({ ...sampleSetupFile(), wishlist: sampleWishlist() });
    expect(result.wishesAdded).toBe(5);
    expect((await getWish('w-trainers'))?.state).toBe('bought');
    expect(await listWishes()).toHaveLength(6);
    // The piece that was bought is still in the wardrobe next to the file's own pieces.
    expect(await listPieces()).toHaveLength(6);
  });

  it('refuses a file whose list cannot be read, and still loads a file from before the list', () => {
    const file = sampleSetupFile();
    expect(() => parseBackup(JSON.stringify({ ...file, wishlist: [{ id: 'x', name: 'No spec' }] }))).toThrow('buy-next list');
    expect(() => parseBackup(JSON.stringify({ ...file, wishlist: 'none' }))).toThrow('buy-next list');
    expect(parseBackup(JSON.stringify(file)).wishlist).toBeUndefined();
  });
});

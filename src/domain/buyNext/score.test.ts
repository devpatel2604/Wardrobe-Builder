import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBackup } from '../../data/backup';
import { sampleRules } from '../../test/fixtures';
import { sampleWishlist, wantBelt, wantBoots, wantCoat, wantCream, wantLeatherJacket, wantPolo, wantShirt, wantTrainers, wish } from '../../test/buyFixtures';
import { crew, piece, polo, samplePalette, savedLook, shirt, smallWardrobe, stretchLook } from '../../test/outfitFixtures';
import type { Formula, Piece, Profile } from '../types';
import { BUY_WEIGHTS, PROVEN_AFTER_WEARS, cellWeights, kindOf, rankWishlist, type BuyInput } from './score';
import type { WishItem } from './types';

// The small wardrobe makes four outfits, all with dressy shoes: none for a casual day, none for a wet day.
function rank(items: WishItem[], overrides: Partial<BuyInput> = {}) {
  return rankWishlist({
    items,
    pieces: smallWardrobe(),
    rules: sampleRules,
    palette: samplePalette,
    formulas: [savedLook, stretchLook],
    date: '2026-01-06',
    lat: 40,
    officeDays: 2,
    ...overrides,
  });
}

const order = (ranking: ReturnType<typeof rank>) => ranking.ranked.map((r) => r.item.id);
const part = (ranking: ReturnType<typeof rank>, id: string, partId: string) => ranking.ranked.find((r) => r.item.id === id)?.parts.find((p) => p.id === partId);

describe('the buy-next score', () => {
  it('counts what the owner can make today, by occasion and weather', () => {
    const { before } = rank([]);
    expect(before.filter((g) => !g.wet).map((g) => [g.occasion, g.before])).toEqual([
      ['office', 4],
      ['casual', 0],
      ['going-out', 4],
      ['date', 4],
    ]);
    expect(before.filter((g) => g.wet).every((g) => g.before === 0)).toBe(true);
  });

  it('puts a first belt and a first winter coat ahead of pieces that add outfits', () => {
    const ranking = rank(sampleWishlist());
    expect(order(ranking).slice(0, 3)).toEqual(['w-belt', 'w-coat', 'w-trainers']);
    const belt = ranking.ranked[0]!;
    expect(belt.basic).toBe(true);
    expect(belt.fillsGap).toBe(true);
    expect(belt.reasons[0]!.text).toBe('You own no belt. It goes with all 4 outfits you can make now.');
    expect(ranking.ranked[1]!.reasons[0]!.text).toMatch(/^You own no coat, and the next 3 months are under 50°F\./);
    // A basic is worn with outfits that exist already, so it adds none of its own.
    expect(belt.inOrder.every((g) => g.added === 0)).toBe(true);
  });

  it('does not rank a coat as a basic when the months ahead are warm', () => {
    const ranking = rank([wantCoat, wantTrainers], { date: '2026-06-06' });
    expect(order(ranking)).toEqual(['w-trainers', 'w-coat']);
    expect(ranking.ranked[1]!.basic).toBe(false);
  });

  it('does not call a second belt a gap', () => {
    const ranking = rank([wantBelt], { pieces: [...smallWardrobe(), piece({ id: 'belt-owned', name: 'Brown belt', slots: ['belt'], colorFamily: 'brown' })] });
    expect(ranking.ranked[0]!.basic).toBe(false);
    expect(ranking.ranked[0]!.score).toBeLessThan(BUY_WEIGHTS.bar);
    expect(ranking.nothingWorthBuying).toBe(true);
  });

  it('counts an occasion with nothing in it for more than one that is covered', () => {
    const ranking = rank([wantCream, wantTrainers]);
    // The trainers open casual days. The cream trousers add to occasions that already have four outfits.
    expect(order(ranking)).toEqual(['w-trainers', 'w-cream']);
    const trainers = ranking.ranked[0]!;
    expect(trainers.today.find((g) => g.occasion === 'casual' && !g.wet)).toMatchObject({ before: 0, added: 6 });
    expect(trainers.reasons[0]!.text).toBe('Your first outfits for a casual day. 14 new outfits in all: 4 for the office, 6 for a casual day, 4 for going out.');
    expect(trainers.fillsGap).toBe(true);
    expect(ranking.ranked[1]!.fillsGap).toBe(false);
    expect(trainers.examples.length).toBeGreaterThan(0);
    expect(trainers.examples.length).toBeLessThanOrEqual(3);
    expect(trainers.examples.every((o) => o.shoes.name === 'White trainers')).toBe(true);
  });

  it('counts each piece with the ones ranked above it already bought', () => {
    const ranking = rank([wantTrainers, wantBoots]);
    expect(order(ranking)).toEqual(['w-trainers', 'w-boots']);
    const boots = ranking.ranked[1]!;
    const casualToday = boots.today.find((g) => g.occasion === 'casual' && !g.wet)!;
    const casualInOrder = boots.inOrder.find((g) => g.occasion === 'casual' && !g.wet)!;
    expect(casualToday.before).toBe(0);
    // Once the trainers are in, casual days are no longer empty.
    expect(casualInOrder.before).toBe(6);
    expect(boots.reasons[0]!.text).toMatch(/^Your first wet-day outfits /);
  });

  it('weighs occasions by how often they come up, and wet days at a quarter', () => {
    const weights = cellWeights(2);
    const [office, officeWet, casual] = weights;
    expect(casual! / office!).toBeCloseTo(5 / 2);
    expect(officeWet! / office!).toBeCloseTo(BUY_WEIGHTS.wetDay);
  });

  it('holds a piece until its day, and says why', () => {
    const waiting = rank([{ ...wantShirt, holdUntil: '2026-03-01', holdReason: 'Shirts wait for spring.' }]);
    expect(waiting.ranked).toHaveLength(0);
    expect(waiting.held).toEqual([expect.objectContaining({ reason: 'Shirts wait for spring.' })]);
    const later = rank([{ ...wantShirt, holdUntil: '2026-03-01' }], { date: '2026-03-01' });
    expect(order(later)).toEqual(['w-shirt']);
  });

  it('holds a second piece of a kind until the first is bought and worn', () => {
    const second = wish({ id: 'w-blue-shirt', name: 'Light blue shirt', spec: { ...wantShirt.spec, colorFamily: 'light-blue' }, afterItemId: 'w-shirt' });
    expect(rank([wantShirt, second]).held.map((h) => h.item.id)).toEqual(['w-blue-shirt']);
    expect(rank([wantShirt, second]).held[0]!.reason).toBe('Waiting until the white shirt is bought and worn.');

    const owned = (wearCount: number): Piece[] => [...smallWardrobe(), { ...shirt, id: 'shirt-owned', wearCount }];
    const first: WishItem = { ...wantShirt, state: 'bought', pieceId: 'shirt-owned' };
    expect(rank([first, second], { pieces: owned(PROVEN_AFTER_WEARS - 1) }).held).toHaveLength(1);
    expect(order(rank([first, second], { pieces: owned(PROVEN_AFTER_WEARS) }))).toEqual(['w-blue-shirt']);
    // Taking the first one off the list frees the second.
    expect(order(rank([{ ...wantShirt, state: 'dropped' }, second]))).toEqual(['w-blue-shirt']);
  });

  it('leaves out a piece that breaks a hard rule, and never scores it', () => {
    const ranking = rank([wantLeatherJacket, wantTrainers]);
    expect(order(ranking)).toEqual(['w-trainers']);
    expect(ranking.blocked).toHaveLength(1);
    expect(ranking.blocked[0]!.findings[0]!.rule).toMatch(/No leather clothing/);
  });

  it('ranks only open lines', () => {
    const ranking = rank([{ ...wantTrainers, state: 'bought' }, { ...wantBoots, state: 'dropped' }, wantCream]);
    expect(order(ranking)).toEqual(['w-cream']);
  });

  it('counts a piece from beyond the saved looks for less, but not a basic', () => {
    const ranking = rank([wantPolo, wantCoat]);
    expect(part(ranking, 'w-polo', 'beyond-looks')!.points).toBeLessThan(0);
    expect(part(ranking, 'w-coat', 'beyond-looks')).toBeUndefined();
    const same = rank([{ ...wantPolo, origin: 'your-looks' }]);
    expect(same.ranked[0]!.score).toBeGreaterThan(ranking.ranked.find((r) => r.item.id === 'w-polo')!.score);
  });

  it('counts a top for less when the palette is unsure of its color near the face', () => {
    // Blue is not in the sample palette. Green is, at medium confidence.
    const ranking = rank([wantPolo]);
    expect(part(ranking, 'w-polo', 'suits-you')!.points).toBeLessThan(0);
    expect(ranking.ranked[0]!.reasons.map((r) => r.text)).toContain('Blue near your face is not settled in your palette yet, so its outfits count for less.');
  });

  it('halves a piece when something owned already does the same job', () => {
    const secondCrew = wish({ id: 'w-crew', name: 'Green crewneck', spec: { slots: ['main-top'], colorFamily: 'green', neckline: 'crew', dressLevel: 2, tags: [] } });
    const ranking = rank([secondCrew]);
    expect(part(ranking, 'w-crew', 'covered')!.points).toBeLessThan(0);
    expect(part(ranking, 'w-crew', 'covered')!.text).toBe(`You already own the ${crew.name.toLowerCase()}, which does the same job.`);
    // A different color is a different job.
    expect(part(rank([{ ...secondCrew, spec: { ...secondCrew.spec, colorFamily: 'navy' } }]), 'w-crew', 'covered')).toBeUndefined();
  });

  it('tells kinds of garment apart by name, tags and collar', () => {
    expect(kindOf({ name: 'Dark straight jeans', tags: [], slots: ['trousers'] })).toBe('jeans');
    expect(kindOf({ name: 'Tech pants', tags: [], slots: ['trousers'] })).toBeUndefined();
    expect(kindOf({ name: 'Suede low top', tags: ['sneaker'], slots: ['shoes'] })).toBe('sneaker');
    expect(kindOf({ name: 'Oxford', tags: [], slots: ['main-top', 'under-layer'], neckline: 'shirt-collar' })).toBe('shirt');
    expect(kindOf({ name: 'Cable quarter-zip', tags: [], slots: ['main-top'], neckline: 'quarter-zip' })).toBe('knit');
    expect(kindOf({ name: 'Long-sleeve knit polo', tags: [], slots: ['main-top'], neckline: 'polo-collar' })).toBe('knit');
  });

  describe('saved looks', () => {
    const poloLook: Formula = { ...stretchLook, id: 'f-polo-mine', source: 'your-looks', credit: 'A Creator', postSeen: true, link: 'https://example.com/polo-post' };

    it('credits the piece that finishes a saved look', () => {
      const ranking = rank([wantCream], { pieces: [...smallWardrobe(), polo], formulas: [savedLook, poloLook] });
      const looks = part(ranking, 'w-cream', 'saved-looks')!;
      expect(looks.points).toBeCloseTo(BUY_WEIGHTS.savedLook);
      expect(looks.text).toBe('Finishes your saved look "Knit polo with cream trousers" (A Creator, post seen and linked).');
      expect(ranking.ranked[0]!.looks).toEqual([expect.objectContaining({ missing: 1 })]);
    });

    it('splits the credit when the look still lacks two pieces that are both on the list', () => {
      const ranking = rank([wantCream, { ...wantPolo, origin: 'your-looks' }], { formulas: [savedLook, poloLook] });
      expect(part(ranking, order(ranking)[0]!, 'saved-looks')!.points).toBeCloseTo(BUY_WEIGHTS.savedLook / 2);
    });

    it('gives no credit for a look that the list cannot finish', () => {
      const ranking = rank([wantCream], { formulas: [savedLook, poloLook] });
      expect(part(ranking, 'w-cream', 'saved-looks')).toBeUndefined();
    });

    it('gives no credit for a look that is not the owner\'s own', () => {
      const ranking = rank([wantCream], { pieces: [...smallWardrobe(), polo] });
      expect(part(ranking, 'w-cream', 'saved-looks')).toBeUndefined();
    });

    it('gives a little for a look from the inspiration screens that has no recipe yet', () => {
      const ranking = rank([{ ...wantCream, lookIds: ['look-1'] }]);
      expect(part(ranking, 'w-cream', 'saved-looks')!.points).toBeCloseTo(BUY_WEIGHTS.savedLookUnchecked);
    });
  });

  it('gives a cheaper piece a small lift that cannot reorder much', () => {
    const cheap = rank([{ ...wantTrainers, options: [{ id: 'o', role: 'exact', name: 'Sneaker', store: 'Shop', price: 50, source: 'you', addedOn: '2026-01-02' }] }]);
    const plain = rank([wantTrainers]);
    const lift = cheap.ranked[0]!.score / plain.ranked[0]!.score;
    expect(lift).toBeGreaterThan(1);
    expect(lift).toBeLessThanOrEqual(1 + BUY_WEIGHTS.cheapLift);
    expect(cheap.ranked[0]!.fromPrice).toBe(50);
  });

  it('ranks the same list the same way whatever order it arrives in', () => {
    const list = [...sampleWishlist(), wantPolo, wantCream];
    const forward = order(rank(list));
    expect(order(rank([...list].reverse()))).toEqual(forward);
    expect(forward).toEqual(['w-belt', 'w-coat', 'w-trainers', 'w-boots', 'w-cream', 'w-polo']);
  });

  it('says so when nothing clears the bar', () => {
    expect(rank(sampleWishlist()).nothingWorthBuying).toBe(false);
    expect(rank([]).nothingWorthBuying).toBe(false);
  });
});

/**
 * The check the design asks for: on the owner's own data the score puts the
 * pieces in the order of the hand-made list. The owner's data is never in the
 * repository, so this runs only when SETUP_FILE points at a setup file whose
 * buy-next list carries the hand-made places (reportRank):
 *
 *   SETUP_FILE=/path/to/setup.json SETUP_DATE=2026-11-16 npx vitest run src/domain/buyNext/score.test.ts
 */
describe.skipIf(!process.env.SETUP_FILE)('the owner\'s own list', () => {
  it('comes out in the order of the hand-made list', () => {
    // The file has to be one the app will load.
    const file = parseBackup(readFileSync(process.env.SETUP_FILE!, 'utf8')) as { profile: Profile; pieces: Piece[]; wishlist: WishItem[] };
    const ranking = rankWishlist({
      items: file.wishlist,
      pieces: file.pieces,
      rules: file.profile.rules,
      palette: file.profile.palette,
      formulas: file.profile.formulas ?? [],
      date: process.env.SETUP_DATE ?? '2026-11-16',
      lat: file.profile.home.point?.lat,
      officeDays: file.profile.week.officeDays.length,
    });
    const placed = file.wishlist.filter((w) => w.reportRank !== undefined).length;
    expect(placed).toBeGreaterThan(0);
    expect(ranking.ranked.slice(0, placed).map((r) => r.item.reportRank)).toEqual(Array.from({ length: placed }, (_, i) => i + 1));
  });
});

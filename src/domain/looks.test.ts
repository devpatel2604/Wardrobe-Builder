import { describe, expect, it } from 'vitest';
import {
  commonThreads,
  comparePiece,
  defaultLookName,
  formulaFromLook,
  formulasWithLooks,
  garmentKind,
  lookCredit,
  lookStage,
  matchLook,
  normalizeReading,
  specFromMatch,
  wantKey,
  yourVersion,
  type LookPiece,
  type SavedLook,
} from './looks';
import { matchesFormula } from './outfits/formulas';
import type { Rule } from './types';
import { sampleRules } from '../test/fixtures';
import { crew, creamTrousers, derbies, piece, pleats, savedLook, tee, zip } from '../test/outfitFixtures';

/** Made-up looks. None of this is the owner's. */
const NOW = '2026-01-05T09:00:00.000Z';
const rules: Rule[] = [...sampleRules, { id: 'r-tie', kind: 'default', text: 'A shirt under the knit is fine. No tie.', evidence: 'your-choice' }];

let n = 0;
function lp(partial: Partial<LookPiece> & Pick<LookPiece, 'slot' | 'description'>): LookPiece {
  return { id: `lp-${++n}`, tags: [], from: 'you', ...partial };
}

function look(pieces: LookPiece[], partial: Partial<SavedLook> = {}): SavedLook {
  return { id: `look-${++n}`, name: 'A look', pieces, confirmedAt: NOW, createdAt: NOW, updatedAt: NOW, ...partial };
}

const knit = lp({ slot: 'main-top', description: 'Charcoal full-zip cardigan', colorFamily: 'charcoal', neckline: 'full-zip' });
const whiteTee = lp({ slot: 'under-layer', description: 'White tee', colorFamily: 'white' });
const navyPleats = lp({ slot: 'trousers', description: 'Navy pleated trousers', colorFamily: 'navy', tags: ['pleated'] });
const blackDerbies = lp({ slot: 'shoes', description: 'Black derbies', colorFamily: 'black' });

describe('crediting a look', () => {
  it('ties a look to its creator only when the link is saved', () => {
    expect(lookCredit({ link: 'https://www.instagram.com/reel/Cxyz12345/', creator: '@a_creator' })).toEqual({ text: '@a_creator, post saved', tied: true });
    expect(lookCredit({ creator: '@a_creator' })).toEqual({ text: 'in the style of @a_creator', tied: false });
    expect(lookCredit({ link: 'https://www.instagram.com/reel/Cxyz12345/' })).toEqual({ text: 'Post saved', tied: true });
    expect(lookCredit({})).toBeUndefined();
  });

  it('names a look from its main pieces, or from where it came from', () => {
    expect(defaultLookName({ pieces: [navyPleats, knit, lp({ slot: 'watch', description: 'Steel watch' })] })).toBe('Charcoal full-zip cardigan, navy pleated trousers');
    expect(defaultLookName({ pieces: [], link: 'https://www.instagram.com/reel/Cxyz12345/' })).toBe('Saved reel');
    expect(defaultLookName({ pieces: [], link: 'https://www.instagram.com/reel/Cxyz12345/', creator: '@a_creator' })).toBe('Look from @a_creator');
    expect(defaultLookName({ pieces: [], creator: 'Some Stylist' })).toBe('Look in the style of Some Stylist');
    expect(defaultLookName({ pieces: [], link: 'https://example.com/a' })).toBe('Look from example.com');
  });

  it('knows what a look is waiting for', () => {
    expect(lookStage(look([], { confirmedAt: undefined }), 0)).toBe('needs-screenshot');
    expect(lookStage(look([], { confirmedAt: undefined }), 1)).toBe('needs-pieces');
    expect(lookStage(look([knit], { confirmedAt: undefined }), 1)).toBe('needs-check');
    expect(lookStage(look([knit]), 0)).toBe('ready');
  });
});

describe('the kind of garment', () => {
  it('reads it from the words', () => {
    expect(garmentKind('main-top', 'Navy knit polo')).toBe('polo');
    expect(garmentKind('main-top', 'White crewneck tee')).toBe('tee');
    expect(garmentKind('main-top', 'Plum cable quarter-zip')).toBe('knit');
    expect(garmentKind('under-layer', 'Lavender dress shirt')).toBe('shirt');
    expect(garmentKind('trousers', 'Dark straight jeans')).toBe('jeans');
    expect(garmentKind('shoes', 'Burgundy wingtips')).toBe('lace-up');
    expect(garmentKind('shoes', 'Brown suede', ['sneaker'])).toBe('sneaker');
    expect(garmentKind('outer-layer', 'Navy wool peacoat')).toBe('coat');
    expect(garmentKind('shoes', 'Something brown')).toBeUndefined();
  });
});

describe('your version of a look', () => {
  it('drops a tie and a leather cap, and keeps the rest', () => {
    const lines = yourVersion(
      look([
        knit,
        lp({ slot: 'under-layer', description: 'Lavender shirt', colorFamily: 'lavender', neckline: 'shirt-collar' }),
        lp({ slot: 'accessory', description: 'Brown knit tie' }),
        lp({ slot: 'accessory', description: 'Black baseball cap', material: 'leather' }),
        lp({ slot: 'belt', description: 'Brown woven belt', material: 'leather' }),
        lp({ slot: 'shoes', description: 'Brown suede sneakers', material: 'suede' }),
      ]),
      rules,
    );
    const byName = Object.fromEntries(lines.map((l) => [l.piece.description, l]));
    expect(byName['Brown knit tie']?.action).toBe('drop');
    expect(byName['Brown knit tie']?.reasons[0]?.rule).toBe('No tie');
    expect(byName['Brown knit tie']?.reasons[0]?.evidence).toBe('your-choice');
    expect(byName['Black baseball cap']?.action).toBe('drop');
    expect(byName['Black baseball cap']?.reasons[0]?.rule).toBe('No leather clothing');
    // Leather and suede are fine for belts and shoes.
    expect(byName['Brown woven belt']?.action).toBe('keep');
    expect(byName['Brown suede sneakers']?.action).toBe('keep');
    expect(byName['Lavender shirt']?.action).toBe('keep');
  });

  it('leaves a tie alone when the profile has no rule against it', () => {
    const lines = yourVersion(look([lp({ slot: 'accessory', description: 'Brown knit tie' })]), sampleRules);
    expect(lines[0]?.action).toBe('keep');
  });

  it('does not mistake tie-dye for a tie', () => {
    const lines = yourVersion(look([lp({ slot: 'accessory', description: 'Tie-dye scarf' })]), rules);
    expect(lines[0]?.action).toBe('keep');
  });

  it('adjusts a piece that breaks a hard rule, and says how', () => {
    const lines = yourVersion(
      look([
        lp({ slot: 'main-top', description: 'Grey oversized sweater', colorFamily: 'grey', fit: 'boxy', hem: 'longer' }),
        lp({ slot: 'outer-layer', description: 'Black leather jacket', material: 'leather', colorFamily: 'black' }),
        lp({ slot: 'outer-layer', description: 'Camel overcoat', colorFamily: 'tan', hem: 'longer' }),
        lp({ slot: 'watch', description: 'Gold watch on a leather strap', material: 'leather strap', hardware: 'gold-or-brass' }),
      ]),
      rules,
    );
    const byName = Object.fromEntries(lines.map((l) => [l.piece.description, l]));
    const sweater = byName['Grey oversized sweater']!;
    expect(sweater.action).toBe('adjust');
    expect(sweater.changes).toEqual(['In a closer fit', 'Shorter, ending by mid-fly']);
    expect(sweater.yours).toMatchObject({ fit: 'regular', hem: 'mid-fly' });
    expect(byName['Black leather jacket']?.changes).toEqual(['In cloth, not leather or suede']);
    expect(byName['Black leather jacket']?.yours?.material).toBeUndefined();
    // A coat may reach mid-thigh, because the profile says so.
    expect(byName['Camel overcoat']?.yours?.hem).toBe('mid-thigh');
    const watch = byName['Gold watch on a leather strap']!;
    expect(watch.changes).toEqual(['On a steel bracelet or a fabric strap', 'With silver or dark metal, not gold']);
    expect(watch.yours).toMatchObject({ hardware: 'silver', material: 'steel bracelet' });
  });

  it('follows the rules in the profile, so deleting a rule stops its change', () => {
    const noShapeRule = rules.filter((r) => r.check !== 'nothing-boxy-or-long');
    const lines = yourVersion(look([lp({ slot: 'main-top', description: 'Grey oversized sweater', fit: 'boxy' })]), noShapeRule);
    expect(lines[0]?.action).toBe('keep');
  });

  it("lets the owner's own choice win, and still says what the rules would do", () => {
    const tie = lp({ slot: 'accessory', description: 'Brown knit tie', choice: 'keep' });
    const tee2 = { ...whiteTee, choice: 'drop' as const };
    const [first, second] = yourVersion(look([tie, tee2]), rules);
    expect(first).toMatchObject({ piece: tee2, action: 'drop', byYou: true, ruled: 'keep' });
    expect(second).toMatchObject({ piece: tie, action: 'keep', byYou: true, ruled: 'drop' });
    expect(second?.reasons[0]?.rule).toBe('No tie');
  });
});

describe('matching a look to the wardrobe', () => {
  it('says the look can be made when every main piece is owned', () => {
    const match = matchLook(look([knit, whiteTee, navyPleats, blackDerbies]), rules, [tee, zip, pleats, derbies]);
    expect(match.status).toBe('make-now');
    expect(match.summary).toBe('You can make this now');
    expect(match.lines.map((l) => l.owned?.id)).toEqual(['zip', 'tee', 'pleats', 'derbies']);
  });

  it('names the one piece that is missing', () => {
    const cream = lp({ slot: 'trousers', description: 'Cream pleated trousers', colorFamily: 'cream', tags: ['pleated'] });
    const match = matchLook(look([knit, whiteTee, cream, blackDerbies]), rules, [tee, zip, pleats, derbies]);
    expect(match.status).toBe('one-away');
    expect(match.summary).toBe('One piece away: cream pleated trousers');
    expect(match.missing.map((m) => m.wanted.description)).toEqual(['Cream pleated trousers']);
  });

  it('counts several missing pieces, and leaves a dropped tie out of the count', () => {
    const match = matchLook(
      look([
        lp({ slot: 'main-top', description: 'Brown cable quarter-zip', colorFamily: 'dark-brown', neckline: 'quarter-zip', texture: 'rough' }),
        lp({ slot: 'under-layer', description: 'Lavender shirt', colorFamily: 'lavender', neckline: 'shirt-collar' }),
        lp({ slot: 'accessory', description: 'Brown tie' }),
        navyPleats,
        lp({ slot: 'shoes', description: 'Brown sneakers', colorFamily: 'brown' }),
        lp({ slot: 'belt', description: 'Brown woven belt', colorFamily: 'brown' }),
      ]),
      rules,
      [tee, zip, pleats, derbies],
    );
    expect(match.status).toBe('several-away');
    expect(match.summary).toBe('3 pieces away');
    expect(match.lines.some((l) => l.wanted.description === 'Brown tie')).toBe(false);
    // A belt is a finishing touch: to find, but not a piece away.
    expect(match.extras.map((e) => e.wanted.description)).toEqual(['Brown woven belt']);
  });

  it('shows the closest owned piece with what differs, and does not count it as owned', () => {
    const quarterZip = lp({ slot: 'main-top', description: 'Green cable quarter-zip', colorFamily: 'green', neckline: 'quarter-zip', texture: 'rough' });
    const match = matchLook(look([quarterZip, navyPleats, blackDerbies]), rules, [crew, pleats, derbies]);
    const top = match.lines[0]!;
    expect(top.level).toBe('close');
    expect(top.owned?.id).toBe('crew');
    expect(top.differences).toEqual(['Yours is a crewneck, the look has a quarter-zip.']);
    expect(match.status).toBe('one-away');
  });

  it('counts a close piece once the owner accepts it as a stand-in', () => {
    const quarterZip = lp({ slot: 'main-top', description: 'Green cable quarter-zip', colorFamily: 'green', neckline: 'quarter-zip', standInId: 'crew' });
    const match = matchLook(look([quarterZip, navyPleats, blackDerbies]), rules, [crew, pleats, derbies]);
    expect(match.lines[0]).toMatchObject({ accepted: true, toFind: false, level: 'close' });
    expect(match.status).toBe('make-now');
  });

  it('forgets a stand-in that is no longer owned', () => {
    const quarterZip = lp({ slot: 'main-top', description: 'Green cable quarter-zip', colorFamily: 'green', neckline: 'quarter-zip', standInId: 'gone' });
    const match = matchLook(look([quarterZip, navyPleats, blackDerbies]), rules, [pleats, derbies]);
    expect(match.lines[0]).toMatchObject({ accepted: false, level: 'missing' });
  });

  it('never matches across a color, a kind of garment, or a piece that is only being considered', () => {
    const wantedSneaker = lp({ slot: 'shoes', description: 'Black sneakers', colorFamily: 'black' });
    expect(comparePiece(wantedSneaker, derbies)).toBeUndefined();
    expect(comparePiece(lp({ slot: 'shoes', description: 'Brown derbies', colorFamily: 'brown' }), derbies)).toBeUndefined();
    expect(comparePiece(lp({ slot: 'trousers', description: 'Navy jeans', colorFamily: 'navy' }), pleats)).toBeUndefined();
    const considering = piece({ id: 'maybe', name: 'Black sneakers', slots: ['shoes'], colorFamily: 'black', status: 'considering' });
    expect(matchLook(look([knit, wantedSneaker]), rules, [zip, considering]).missing).toHaveLength(1);
  });

  it('notices white against cream, and slim against pleated', () => {
    expect(comparePiece(lp({ slot: 'under-layer', description: 'Cream tee', colorFamily: 'cream' }), tee)).toEqual(['Yours is white, the look has cream.']);
    const slim = piece({ id: 'slim', name: 'Navy slim trousers', slots: ['trousers'], colorFamily: 'navy', tags: ['slim'] });
    expect(comparePiece(navyPleats, slim)).toEqual(['Yours are slim, the look has pleats.']);
    expect(comparePiece(lp({ slot: 'trousers', description: 'Slim navy trousers', colorFamily: 'navy', tags: ['slim'] }), pleats)).toEqual(["Yours are fuller, the look's are slim."]);
    expect(comparePiece(navyPleats, creamTrousers)).toBeUndefined();
  });

  it('matches a watch on its metal, since its color is seldom noted', () => {
    const steel = piece({ id: 'steel', name: 'Steel watch', slots: ['watch'], hardware: 'silver' });
    expect(comparePiece(lp({ slot: 'watch', description: 'Silver watch', hardware: 'silver' }), steel)).toEqual([]);
    expect(comparePiece(lp({ slot: 'watch', description: 'A watch' }), steel)).toEqual([]);
    expect(comparePiece(lp({ slot: 'watch', description: 'Black watch', hardware: 'dark' }), steel)).toEqual(['Yours is silver or steel, the look has dark or gunmetal.']);
    // A gold watch in the look is changed to silver by the owner's rule first, so a steel one matches.
    const gold = look([knit, lp({ slot: 'watch', description: 'Gold watch', hardware: 'gold-or-brass' })]);
    expect(matchLook(gold, rules, [steel]).lines.find((l) => l.wanted.slot === 'watch')).toMatchObject({ level: 'have', owned: { id: 'steel' } });
  });

  it('has nothing to say about a look with no main pieces', () => {
    expect(matchLook(look([lp({ slot: 'watch', description: 'Steel watch' })]), rules, [zip]).status).toBe('no-pieces');
  });
});

describe('describing a missing piece for the buy list', () => {
  it('carries the spec, the dress level and what the rules change', () => {
    const boxy = lp({ slot: 'main-top', description: 'Cream cable full-zip', colorFamily: 'cream', neckline: 'full-zip', texture: 'rough', fit: 'boxy', dressLevel: 2, tags: ['cable'] });
    const match = matchLook(look([boxy, navyPleats]), rules, [pleats]);
    expect(specFromMatch(match.missing[0]!)).toEqual({
      slot: 'main-top',
      spec: 'Cream cable full-zip',
      colorFamily: 'cream',
      depth: undefined,
      texture: 'rough',
      neckline: 'full-zip',
      dressLevel: 2,
      tags: ['cable'],
      note: 'In a closer fit',
      key: 'main-top|white|knit|full-zip',
    });
  });

  it('gives the same key to the same thing described twice', () => {
    const a = lp({ slot: 'trousers', description: 'Cream pleated trousers', colorFamily: 'cream', tags: ['pleated'] });
    const b = lp({ slot: 'trousers', description: 'Off-white wool trousers', colorFamily: 'white' });
    expect(wantKey(a)).toBe(wantKey(b));
    expect(wantKey(a)).not.toBe(wantKey(lp({ slot: 'trousers', description: 'Cream jeans', colorFamily: 'cream' })));
    const fullZip = lp({ slot: 'main-top', description: 'Cream zip knit', colorFamily: 'cream', neckline: 'full-zip' });
    const quarterZip = lp({ slot: 'main-top', description: 'Cream zip knit', colorFamily: 'cream', neckline: 'quarter-zip' });
    expect(wantKey(fullZip)).not.toBe(wantKey(quarterZip));
  });
});

describe('a saved look as an outfit recipe', () => {
  const full = look([knit, whiteTee, navyPleats, blackDerbies, lp({ slot: 'accessory', description: 'Brown tie' })], {
    name: 'Zip knit over white',
    creator: '@a_creator',
    link: 'https://www.instagram.com/reel/Cxyz12345/',
  });

  it('matches the outfit it describes, and credits the post', () => {
    const formula = formulaFromLook(full, rules)!;
    expect(formula).toMatchObject({ id: `saved-look:${full.id}`, source: 'your-looks', credit: '@a_creator', postSeen: true, link: full.link });
    expect(Object.keys(formula.slots).sort()).toEqual(['main-top', 'shoes', 'trousers', 'under-layer']);
    expect(formula.slots.trousers).toEqual({ colorFamilies: ['navy'], tags: ['pleated'] });
    expect(formula.slots['under-layer']).toEqual({ colorFamilies: ['white', 'cream'] });
    expect(matchesFormula({ mainTop: zip, underLayer: tee, trousers: pleats, shoes: derbies }, formula)).toBe(true);
    expect(matchesFormula({ mainTop: crew, underLayer: tee, trousers: pleats, shoes: derbies }, formula)).toBe(false);
  });

  it('is "in the style of" when no link is saved', () => {
    expect(formulaFromLook({ ...full, link: undefined }, rules)?.postSeen).toBe(false);
  });

  it('waits for the owner to confirm the pieces, and needs more than a top', () => {
    expect(formulaFromLook({ ...full, confirmedAt: undefined }, rules)).toBeUndefined();
    expect(formulaFromLook(look([knit]), rules)).toBeUndefined();
    expect(formulaFromLook(look([navyPleats, blackDerbies]), rules)).toBeUndefined();
  });

  it('adds confirmed looks to the profile recipes, once each', () => {
    const sameAsProfile = look([knit, navyPleats], { link: 'https://example.com/post/' });
    const merged = formulasWithLooks([savedLook], [full, sameAsProfile, { ...full, id: 'unconfirmed', confirmedAt: undefined, link: undefined }], rules);
    expect(merged.map((f) => f.id)).toEqual(['f-zip', `saved-look:${full.id}`]);
  });
});

describe('what the saved looks have in common', () => {
  it('names what turns up in at least half of three or more looks', () => {
    const cream = () => lp({ slot: 'trousers', description: 'Cream pleated trousers', colorFamily: 'cream', tags: ['pleated'] });
    const looks = [look([knit, cream()]), look([knit, lp({ slot: 'trousers', description: 'Off-white trousers', colorFamily: 'white' })]), look([knit, navyPleats]), look([whiteTee, cream()])];
    expect(commonThreads(looks, rules)).toEqual([
      { label: 'Charcoal knit', count: 3, of: 4 },
      { label: 'Cream trousers', count: 3, of: 4 },
    ]);
    expect(commonThreads(looks.slice(0, 2), rules)).toEqual([]);
  });
});

describe("taking in the model's reading", () => {
  let id = 0;
  const makeId = () => `new-${++id}`;

  it('keeps what fits the app and drops what does not', () => {
    const reading = normalizeReading(
      {
        account: '@A_Creator',
        notes: '  The shoes are partly hidden.  ',
        pieces: [
          { slot: 'shoes', description: 'brown suede sneakers', colorFamily: 'brown', depth: 'mid', texture: 'rough', neckline: 'crew', material: 'Suede', hardware: 'unknown', dressLevel: 1, tags: ['Sneakers', 'lace up', 7], confidence: 'medium' },
          { slot: 'main-top', description: 'Cream cable-knit full-zip cardigan', colorFamily: 'ivory', depth: 'light', texture: 'rough', neckline: 'full-zip', fit: 'regular', hem: 'at-belt', material: 'unknown', hardware: 'silver', dressLevel: 2, tags: ['cable'], confidence: 'high' },
          { slot: 'hat', description: 'Cap' },
          { slot: 'trousers', description: '   ' },
          'nonsense',
        ],
      },
      makeId,
    );
    expect(reading.account).toBe('@a_creator');
    expect(reading.notes).toBe('The shoes are partly hidden.');
    expect(reading.pieces).toHaveLength(2);
    // Sorted in outfit order, top first.
    expect(reading.pieces[0]).toMatchObject({
      slot: 'main-top',
      description: 'Cream cable-knit full-zip cardigan',
      colorFamily: undefined,
      neckline: 'full-zip',
      material: undefined,
      hardware: 'silver',
      dressLevel: 2,
      from: 'ai',
      confidence: 'high',
    });
    expect(reading.pieces[1]).toMatchObject({ slot: 'shoes', description: 'Brown suede sneakers', neckline: undefined, material: 'suede', hardware: undefined, tags: ['sneaker', 'lace-up'], dressLevel: 1 });
  });

  it('survives an answer that is not what was asked for', () => {
    expect(normalizeReading(null, makeId)).toEqual({ pieces: [], notes: undefined, account: undefined });
    expect(normalizeReading({ pieces: 'none', account: 'not a handle!' }, makeId)).toEqual({ pieces: [], notes: undefined, account: undefined });
  });
});

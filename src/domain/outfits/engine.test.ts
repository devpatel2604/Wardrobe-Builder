import { describe, expect, it } from 'vitest';
import { sampleRules } from '../../test/fixtures';
import {
  blackBelt,
  boots,
  coat,
  cold,
  creamTrousers,
  crew,
  derbies,
  dry,
  engineInput,
  overshirt,
  piece,
  pleats,
  polo,
  savedLook,
  shirt,
  smallWardrobe,
  stretchLook,
  tee,
  trainers,
  wet,
  woreEntry,
  zip,
  chinos,
  joggers,
} from '../../test/outfitFixtures';
import { buildOutfits, sortWardrobe } from './build';
import { coverage } from './coverage';
import { evaluate, recommend } from './engine';
import { styleFails, weatherFails } from './filters';
import { creditLine, matchesFormula } from './formulas';
import { officeHours } from './occasions';
import { faceRating } from './score';
import { outfitKey } from './traits';
import type { Outfit } from './types';
import { planWeek } from './week';

const names = (o: Outfit) => [o.mainTop, o.underLayer, o.thirdLayer, o.trousers, o.shoes].filter(Boolean).map((p) => p!.name);
const failed = (o: Outfit, occasion = 'office' as const) => styleFails(o, occasion).map((f) => f.filter);

describe('building outfits', () => {
  it('needs a layer under a full zip and none under a tee or a crewneck', () => {
    const built = buildOutfits(sortWardrobe(smallWardrobe(), sampleRules));
    expect(built.filter((o) => o.mainTop === zip).every((o) => o.underLayer === tee)).toBe(true);
    expect(built.filter((o) => o.mainTop === crew).every((o) => o.underLayer === undefined)).toBe(true);
    expect(built.filter((o) => o.mainTop === tee).every((o) => o.underLayer === undefined)).toBe(true);
    // 3 tops, 3 trousers, 1 pair of shoes.
    expect(built).toHaveLength(9);
  });

  it('puts a shirt collar, but not a tee, under a crewneck', () => {
    const built = buildOutfits(sortWardrobe([...smallWardrobe(), shirt], sampleRules));
    const underCrew = built.filter((o) => o.mainTop === crew).map((o) => o.underLayer?.id);
    expect(new Set(underCrew)).toEqual(new Set([undefined, 'shirt']));
  });

  it('leaves out pieces that break a hard rule, and pieces not owned', () => {
    const suedeJacket = piece({ id: 'suede', name: 'Suede jacket', slots: ['outer-layer'], cloth: 'Suede' });
    const goldKnit = piece({ id: 'gold', name: 'Gold zip knit', slots: ['main-top'], hardware: 'gold-or-brass' });
    const wished = piece({ id: 'wish', name: 'Wished-for knit', slots: ['main-top'], status: 'considering' });
    const wardrobe = sortWardrobe([...smallWardrobe(), suedeJacket, goldKnit, wished], sampleRules);
    expect(wardrobe.leftOut.map((p) => p.id)).toEqual(['suede', 'gold']);
    expect(wardrobe.mainTops.map((p) => p.id)).toEqual(['tee', 'zip', 'crew']);
    expect(wardrobe.thirdLayers).toEqual([]);
  });

  it('adds a belt only when it matches black or brown shoes', () => {
    const [withBlack] = buildOutfits(sortWardrobe([zip, tee, pleats, derbies, blackBelt], sampleRules));
    expect(withBlack?.belt).toBe(blackBelt);
    const [withBrown] = buildOutfits(sortWardrobe([zip, tee, pleats, boots, blackBelt], sampleRules));
    expect(withBrown?.belt).toBeUndefined();
  });
});

describe('filters', () => {
  const base: Outfit = { mainTop: zip, underLayer: tee, trousers: pleats, shoes: derbies };

  it('passes a knit, smart trousers and dressy shoes for the office, going out and a date', () => {
    expect(failed(base)).toEqual([]);
    expect(styleFails(base, 'going-out')).toEqual([]);
    expect(styleFails(base, 'date')).toEqual([]);
    expect(styleFails(base, 'casual').map((f) => f.text)).toEqual(['Too dressy for a casual day.']);
  });

  it('removes outfits whose pieces are more than one dress level apart', () => {
    expect(failed({ ...base, trousers: joggers })).toContain('levels-apart');
    expect(failed({ mainTop: tee, trousers: chinos, shoes: derbies })).toContain('levels-apart');
  });

  it('never sends a bare tee out for the evening', () => {
    const teeOnly: Outfit = { mainTop: tee, trousers: chinos, shoes: boots };
    expect(styleFails(teeOnly, 'going-out').map((f) => f.filter)).toContain('bare-tee');
    expect(styleFails({ ...teeOnly, thirdLayer: overshirt }, 'going-out').map((f) => f.filter)).not.toContain('bare-tee');
    expect(styleFails(teeOnly, 'casual')).toEqual([]);
  });

  it('allows three colors and one strong one, and no more', () => {
    const plum = piece({ id: 'plum', name: 'Plum knit', slots: ['main-top'], colorFamily: 'plum', dressLevel: 2 });
    const olive = piece({ id: 'olive', name: 'Olive trousers', slots: ['trousers'], colorFamily: 'olive', dressLevel: 2 });
    // Charcoal, white, navy. Black shoes are not counted.
    expect(failed(base)).toEqual([]);
    // Blue polo, olive overshirt, tan trousers and burgundy shoes: four colors, two of them strong.
    const burgundyShoes = piece({ id: 'oxblood', name: 'Burgundy shoes', slots: ['shoes'], colorFamily: 'burgundy', dressLevel: 3 });
    const loud: Outfit = { mainTop: polo, thirdLayer: { ...overshirt, dressLevel: 2 }, trousers: chinos, shoes: burgundyShoes };
    expect(styleFails(loud, 'office').map((f) => f.text)).toEqual(['More than three colors.', 'More than one strong color.']);
    // A plum top with burgundy shoes is one strong color, not two.
    expect(failed({ mainTop: plum, trousers: olive, shoes: { ...burgundyShoes, dressLevel: 2 } })).toEqual([]);
  });

  it('knows the clashes: navy on navy, brown on brown, and light tops with light trousers', () => {
    const navyKnit = piece({ id: 'navy', name: 'Navy knit', slots: ['main-top'], colorFamily: 'navy', dressLevel: 2 });
    const brownKnit = piece({ id: 'brown', name: 'Brown knit', slots: ['main-top'], colorFamily: 'dark-brown', dressLevel: 2 });
    const brownTrousers = piece({ id: 'brown-t', name: 'Brown trousers', slots: ['trousers'], colorFamily: 'brown', dressLevel: 2 });
    const creamKnit = piece({ id: 'cream-k', name: 'Cream cable zip', slots: ['main-top'], colorFamily: 'cream', neckline: 'full-zip', dressLevel: 2 });
    expect(failed({ mainTop: navyKnit, trousers: pleats, shoes: derbies })).toEqual(['clash']);
    expect(failed({ mainTop: brownKnit, trousers: brownTrousers, shoes: derbies })).toEqual(['clash']);
    expect(failed({ mainTop: shirt, trousers: creamTrousers, shoes: boots })).toEqual(['clash']);
    expect(failed({ mainTop: creamKnit, underLayer: tee, trousers: creamTrousers, shoes: derbies })).toEqual(['clash']);
    // Cream on cream with brown shoes is a look, not a clash.
    expect(failed({ mainTop: creamKnit, underLayer: tee, trousers: creamTrousers, shoes: boots })).toEqual([]);
  });

  it('keeps suede, light trousers and dry-day shoes home when it is wet', () => {
    const suede = piece({ id: 'suede-s', name: 'Suede sneakers', slots: ['shoes'], cloth: 'Suede', wetOk: true, dressLevel: 2 });
    expect(weatherFails(base, wet).map((f) => f.text)).toEqual(['Black derbies: not marked as fine in rain or snow.']);
    expect(weatherFails({ ...base, shoes: boots }, wet)).toEqual([]);
    expect(weatherFails({ ...base, shoes: suede }, wet).map((f) => f.text)).toEqual(['Suede sneakers: suede stays home on a wet day.']);
    expect(weatherFails({ ...base, trousers: creamTrousers, shoes: boots }, wet).map((f) => f.filter)).toEqual(['wet']);
    expect(weatherFails(base, dry)).toEqual([]);
    expect(weatherFails(base, undefined)).toEqual([]);
  });

  it('keeps short sleeves and bare tees for warm days, and warm knits for cold ones', () => {
    const summerPolo = piece({ id: 'summer', name: 'Summer polo', slots: ['main-top'], tags: ['short sleeve'] });
    const heavy = piece({ id: 'heavy', name: 'Heavy knit', slots: ['main-top'], warmth: 'warm' });
    const hot = { ...dry, lowF: 72, highF: 84 };
    expect(weatherFails({ ...base, mainTop: summerPolo, underLayer: undefined }, cold).map((f) => f.text)).toEqual(['Summer polo: too light for 35°F.']);
    expect(weatherFails({ mainTop: tee, trousers: chinos, shoes: trainers }, cold).map((f) => f.text)).toEqual(['A tee needs a layer over it at 35°F.']);
    expect(weatherFails({ mainTop: tee, trousers: chinos, shoes: trainers }, hot)).toEqual([]);
    expect(weatherFails({ ...base, mainTop: heavy, underLayer: undefined }, hot).map((f) => f.text)).toEqual(['Heavy knit: too warm for 84°F.']);
  });
});

describe('formulas and the palette', () => {
  it('matches a formula only when every slot it names matches', () => {
    const polished: Outfit = { mainTop: polo, trousers: creamTrousers, shoes: derbies };
    expect(matchesFormula(polished, stretchLook)).toBe(true);
    expect(matchesFormula({ ...polished, trousers: chinos }, stretchLook)).toBe(false);
    // The formula says nothing is worn under the polo.
    expect(matchesFormula({ ...polished, underLayer: tee }, stretchLook)).toBe(false);
    expect(matchesFormula(polished, { ...stretchLook, slots: {} })).toBe(false);
  });

  it('credits a creator by post only when the post was seen and can be linked', () => {
    const look = { ...stretchLook, credit: 'A Creator' };
    expect(creditLine({ ...look, postSeen: true, link: 'https://example.com/p' })).toBe('A Creator, post seen and linked');
    expect(creditLine({ ...look, postSeen: true })).toBe('in the style of A Creator');
    expect(creditLine({ ...look, postSeen: false, link: 'https://example.com/p' })).toBe('in the style of A Creator');
    expect(creditLine(stretchLook)).toBeUndefined();
  });

  it('reads how a color rates near the face from the palette', () => {
    const { palette } = engineInput();
    expect(faceRating('cream', palette)).toMatchObject({ verdict: 'yes', confidence: 'high' });
    expect(faceRating('charcoal', palette).verdict).toBe('over-light');
    expect(faceRating('tan', palette).verdict).toBe('test');
    expect(faceRating('mustard', palette).verdict).toBe('unrated');
  });

  it('lets a color test result win over the palette text', () => {
    const tested = [
      ...engineInput().palette,
      {
        id: 'p-t',
        color: 'Tan',
        swatch: '#ca8',
        nearFace: 'Test',
        awayFromFace: 'Yes',
        confidence: 'unknown' as const,
        why: '',
        family: 'tan',
        test: { verdict: 'avoid' },
      },
    ];
    expect(faceRating('tan', tested)).toMatchObject({ verdict: 'no', tested: true });
  });
});

describe('picking', () => {
  it('picks the saved look first and explains it with the rules that fired', () => {
    const result = recommend(engineInput());
    expect(result.passing).toBe(4);
    expect(names(result.main!.candidate.outfit)).toEqual(['Charcoal zip cardigan', 'White tee', 'Navy pleated trousers', 'Black derbies']);
    expect(result.main!.candidate.source).toBe('your-looks');
    expect(result.main!.reasons).toEqual([
      { text: 'Your saved look: "Zip knit over a white layer with navy trousers" (A Creator, post seen and linked).', evidence: 'your-choice' },
      { text: 'Charcoal near your face, over a light layer as your palette asks.', evidence: 'convention' },
      { text: 'Top ends at the belt over fuller trousers, which makes your legs look longer.', evidence: 'convention' },
    ]);
  });

  it('gives two alternates that differ by more than the shoes', () => {
    const result = recommend(engineInput({ pieces: [...smallWardrobe(), boots] }));
    const main = result.main!.candidate.outfit;
    expect(result.alternates).toHaveLength(2);
    for (const alternate of result.alternates) {
      const o = alternate.candidate.outfit;
      expect(o.mainTop !== main.mainTop || o.trousers !== main.trousers).toBe(true);
    }
    expect(result.alternates[0]!.candidate.outfit.mainTop).toBe(crew);
  });

  it('offers a stretch only as a labeled alternate, never as the main pick', () => {
    const result = recommend(engineInput({ pieces: [...smallWardrobe(), polo, creamTrousers], occasion: 'date' }));
    expect(result.main!.candidate.stretch).toBe(false);
    expect(result.hasStretch).toBe(true);
    const stretch = result.alternates.find((a) => a.candidate.stretch)!;
    expect(stretch.candidate.source).toBe('suits-you');
    expect(names(stretch.candidate.outfit)).toEqual(['Blue knit polo', 'Cream trousers', 'Black derbies']);
    expect(stretch.reasons[0]!.text).toBe('Beyond your saved looks: "Knit polo with cream trousers", built from your coloring and fit findings.');
    expect(stretch.reasons.map((r) => r.text)).toContain('A collar near your face, which helps for a date.');
  });

  it('says so when no stretch can be made', () => {
    expect(recommend(engineInput()).hasStretch).toBe(false);
  });

  it('always gives the same answer for the same wardrobe', () => {
    const a = recommend(engineInput());
    const b = recommend(engineInput({ pieces: [...smallWardrobe()].reverse() }));
    expect(outfitKey(a.main!.candidate.outfit)).toBe(outfitKey(b.main!.candidate.outfit));
    expect(a.alternates.map((x) => x.candidate.key)).toEqual(b.alternates.map((x) => x.candidate.key));
  });

  it('flags the missing coat and belt as a heads-up, and adds the coat once there is one', () => {
    const without = recommend(engineInput({ weather: cold }));
    expect(without.headsUp).toEqual([{ text: '35°F and you own no coat.', evidence: 'working-rule' }, { text: 'You own no belt yet.' }]);
    const withCoat = recommend(engineInput({ weather: cold, pieces: [...smallWardrobe(), coat, blackBelt] }));
    expect(withCoat.headsUp).toEqual([]);
    expect(withCoat.main!.candidate.outfit.coat).toBe(coat);
    expect(withCoat.main!.candidate.outfit.belt).toBe(blackBelt);
    expect(recommend(engineInput({ weather: dry, pieces: [...smallWardrobe(), coat] })).main!.candidate.outfit.coat).toBeUndefined();
  });

  it('shows the closest outfit on a wet day when nothing passes, and says what it gives up', () => {
    const result = recommend(engineInput({ weather: wet }));
    expect(result.passing).toBe(0);
    expect(result.main!.compromises).toEqual([{ text: 'Black derbies: not marked as fine in rain or snow.', evidence: 'working-rule' }]);
    expect(result.headsUp[0]!.text).toMatch(
      /^Nothing you own fully suits a wet day for the office\. This is the closest\. Adding a .* that can take rain would make \d+ outfits? possible\.$/,
    );
  });

  it('picks rain-ready shoes on a wet day', () => {
    const result = recommend(engineInput({ weather: wet, pieces: [...smallWardrobe(), boots] }));
    expect(result.main!.candidate.outfit.shoes).toBe(boots);
    expect(result.main!.compromises).toEqual([]);
    expect(result.headsUp.map((h) => h.text)).toEqual(['You own no belt yet.']);
  });

  it('says so when the weather removed an outfit that would have won', () => {
    const creamLook = { ...savedLook, id: 'f-cream', name: 'Zip knit with cream trousers', slots: { trousers: { colorFamilies: ['cream' as const] } } };
    const input = engineInput({ pieces: [...smallWardrobe(), boots, creamTrousers], formulas: [creamLook] });
    expect(recommend(input).main!.candidate.outfit.trousers).toBe(creamTrousers);
    const rainy = recommend({ ...input, weather: wet });
    expect(rainy.main!.candidate.outfit.trousers).not.toBe(creamTrousers);
    expect(rainy.main!.reasons.at(-1)).toEqual({ text: 'Higher-scoring outfits were left out for the wet forecast.', evidence: 'working-rule' });
  });

  it('names the gap and what would fill it when nothing works for the occasion', () => {
    const result = recommend(engineInput({ occasion: 'casual' }));
    expect(result.main).toBeUndefined();
    expect(result.gap).toEqual({
      text: 'Nothing you own works for a casual day: every combination comes out too dressy, or mixes dress levels too far apart.',
      hint: 'Adding a casual shoe would make 6 outfits possible.',
    });
    // And the hint is true: with casual shoes, that many outfits pass.
    expect(recommend(engineInput({ occasion: 'casual', pieces: [...smallWardrobe(), trainers] })).passing).toBe(6);
  });

  it('says which slot is empty when there is nothing to build with', () => {
    expect(recommend(engineInput({ pieces: [zip, tee, pleats] })).gap?.text).toBe('There are no shoes in your wardrobe yet, so there is no outfit to build.');
  });

  it('builds around a piece, and says when that piece cannot work', () => {
    const around = recommend(engineInput({ include: ['chinos'] }));
    expect(around.main!.candidate.outfit.trousers).toBe(chinos);
    expect([around.main, ...around.alternates].every((p) => p!.candidate.outfit.trousers === chinos)).toBe(true);
    expect(recommend(engineInput({ include: ['joggers'] })).gap?.text).toBe(
      'Nothing passes your rules with the Grey joggers for the office on a day like this.',
    );
  });

  it('moves on from an outfit passed over for the day', () => {
    const first = recommend(engineInput());
    const second = recommend(engineInput({ skipKeys: [first.main!.candidate.key] }));
    expect(second.main!.candidate.key).not.toBe(first.main!.candidate.key);
    const all = evaluate(engineInput())
      .filter((c) => c.fails.length === 0)
      .map((c) => c.key);
    expect(recommend(engineInput({ skipKeys: all })).gap?.text).toBe('You have passed on every outfit that works for the office today.');
  });

  it('rests what was worn the last time, and says so', () => {
    const log = [woreEntry({ date: '2026-01-01', pieces: { mainTop: 'zip', underLayer: 'tee', trousers: 'pleats', shoes: 'derbies' } })];
    const result = recommend(engineInput({ log, formulas: [] }));
    const o = result.main!.candidate.outfit;
    expect(o.mainTop === zip && o.trousers === pleats).toBe(false);
    expect(result.main!.reasons.map((r) => r.text)).toContain(
      'You wore the charcoal zip cardigan with the navy pleated trousers the last time you dressed for the office, so that pair sits out.',
    );
  });
});

describe('the week and the coverage grid', () => {
  it('does not repeat a main top across the week while another one passes', () => {
    const days = ['2026-01-06', '2026-01-08'].map((date) => ({ date, occasions: ['office' as const], weather: { office: dry } }));
    const { pieces, rules, palette, formulas, log } = engineInput();
    const week = planWeek(days, { pieces, rules, palette, formulas, log });
    expect(week.map((d) => d.recommendation!.main!.candidate.outfit.mainTop.name)).toEqual(['Charcoal zip cardigan', 'Green cable crewneck']);
    expect(week.map((d) => d.repeatsTop)).toEqual([false, false]);
  });

  it('repeats a top only when nothing else passes, and flags it', () => {
    const days = ['2026-01-06', '2026-01-08'].map((date) => ({ date, occasions: ['office' as const], weather: {} }));
    const { rules, palette, formulas, log } = engineInput();
    const week = planWeek(days, { pieces: [zip, tee, pleats, chinos, derbies], rules, palette, formulas, log });
    expect(week.map((d) => d.repeatsTop)).toEqual([false, true]);
  });

  it('keeps what was already worn and plans around it', () => {
    const worn = woreEntry({ date: '2026-01-06', pieces: { mainTop: 'zip', underLayer: 'tee', trousers: 'pleats', shoes: 'derbies' } });
    const days = ['2026-01-06', '2026-01-08'].map((date) => ({ date, occasions: ['office' as const], weather: {} }));
    const { pieces, rules, palette, formulas } = engineInput();
    const week = planWeek(days, { pieces, rules, palette, formulas, log: [worn] });
    expect(week[0]!.worn).toBe(worn);
    expect(week[0]!.recommendation).toBeUndefined();
    expect(week[1]!.recommendation!.main!.candidate.outfit.mainTop).toBe(crew);
  });

  it('counts outfits by occasion for dry and wet days, with a hint for the empty cells', () => {
    const { pieces, rules, palette, formulas, log, date } = engineInput();
    const grid = coverage({ pieces, rules, palette, formulas, log, date });
    expect(grid.map((row) => [row.occasion, row.dry, row.wet])).toEqual([
      ['office', 4, 0],
      ['casual', 0, 0],
      ['going-out', 4, 0],
      ['date', 4, 0],
    ]);
    expect(grid[1]!.hint).toBe('A casual shoe would make 9 outfits possible.');
    expect(grid[0]!.hint).toMatch(/shoe that can take rain would make \d+ outfits possible on wet days\.$/);
    const covered = coverage({ pieces: [...pieces, boots, trainers], rules, palette, formulas, log, date });
    expect(covered.every((row) => row.dry > 0)).toBe(true);
    expect(covered[0]!.wet).toBeGreaterThan(0);
  });
});

describe('office hours', () => {
  it('reads two times out of the profile text', () => {
    expect(officeHours('About 7 am to 4 pm')).toEqual([7, 16]);
    expect(officeHours('9 am to 5 pm')).toEqual([9, 17]);
    expect(officeHours('8:30 AM to 12 pm')).toEqual([8, 12]);
    expect(officeHours('Flexible')).toEqual([8, 17]);
    expect(officeHours(undefined)).toEqual([8, 17]);
  });
});

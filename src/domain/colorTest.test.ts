import { describe, expect, it } from 'vitest';
import {
  ALL_TEST_COLORS,
  applyResultsToPalette,
  captureSpanMinutes,
  nextPair,
  openTestColors,
  proposeVerdict,
  rankColors,
  recommendedPicks,
  rulesAnsweredBy,
  STANDARD_TEST_COLORS,
  testedColors,
  totalPairs,
  type ColorPick,
  type TestColor,
} from './colorTest';
import type { PaletteEntry, Rule } from './types';

const AT = '2026-01-05T09:00:00.000Z';

function pick(a: TestColor, b: TestColor, winner: TestColor | 'same'): ColorPick {
  return { a, b, winner, at: AT };
}

/** Plays the test for someone whose true order of preference is `truth`, best first. */
function play(colors: TestColor[], truth: TestColor[], count: number): ColorPick[] {
  const picks: ColorPick[] = [];
  for (let i = 0; i < count; i++) {
    const pair = nextPair(colors, picks);
    if (!pair) break;
    const winner = truth.indexOf(pair.left) < truth.indexOf(pair.right) ? pair.left : pair.right;
    picks.push(pick(pair.left, pair.right, winner));
  }
  return picks;
}

describe('the list of colors', () => {
  it('has the twelve standard colors first and offers every family except "other"', () => {
    expect(STANDARD_TEST_COLORS).toHaveLength(12);
    expect(ALL_TEST_COLORS.slice(0, 12)).toEqual(STANDARD_TEST_COLORS);
    expect(new Set(ALL_TEST_COLORS).size).toBe(ALL_TEST_COLORS.length);
    expect(ALL_TEST_COLORS).toContain('grey');
    expect(ALL_TEST_COLORS).not.toContain('other');
  });
});

describe('rankColors', () => {
  it('puts every color in the middle before any picks', () => {
    const standings = rankColors(['white', 'navy', 'black'], []);
    expect(standings.map((s) => s.color)).toEqual(['white', 'navy', 'black']);
    expect(standings.every((s) => Math.abs(s.score - 0.5) < 1e-9 && s.games === 0)).toBe(true);
  });

  it('ranks a winner above a loser and counts the record', () => {
    const standings = rankColors(['black', 'navy'], [pick('black', 'navy', 'navy')]);
    expect(standings[0]).toMatchObject({ color: 'navy', rank: 1, wins: 1, losses: 0, games: 1 });
    expect(standings[1]).toMatchObject({ color: 'black', rank: 2, wins: 0, losses: 1 });
    expect(standings[0]!.score).toBeGreaterThan(0.5);
    expect(standings[1]!.score).toBeLessThan(0.5);
  });

  it('treats "about the same" as half a win each', () => {
    const standings = rankColors(['white', 'cream'], [pick('white', 'cream', 'same')]);
    expect(standings[0]!.score).toBeCloseTo(0.5, 6);
    expect(standings.map((s) => s.ties)).toEqual([1, 1]);
  });

  it('gives more credit for beating a strong color than a weak one', () => {
    const picks = [
      pick('navy', 'white', 'navy'),
      pick('navy', 'cream', 'navy'),
      pick('mustard', 'white', 'white'),
      pick('mustard', 'cream', 'cream'),
      // Olive beat the strong one, tan beat the weak one. Both are 1 and 0.
      pick('olive', 'navy', 'olive'),
      pick('tan', 'mustard', 'tan'),
    ];
    const standings = rankColors(['navy', 'white', 'cream', 'mustard', 'olive', 'tan'], picks);
    const score = (c: TestColor) => standings.find((s) => s.color === c)!.score;
    expect(score('olive')).toBeGreaterThan(score('tan'));
  });

  it('ignores picks that involve a color with no photo', () => {
    const standings = rankColors(['white', 'navy'], [pick('white', 'black', 'black'), pick('white', 'navy', 'white')]);
    expect(standings.map((s) => s.games)).toEqual([1, 1]);
  });

  it('does not let one lucky win outrank a longer winning record', () => {
    const picks = [pick('navy', 'white', 'navy'), pick('navy', 'cream', 'navy'), pick('navy', 'olive', 'navy'), pick('black', 'tan', 'black')];
    const standings = rankColors(['navy', 'white', 'cream', 'olive', 'black', 'tan'], picks);
    expect(standings[0]!.color).toBe('navy');
  });
});

describe('nextPair and recommendedPicks', () => {
  it('asks for far fewer picks than every pair', () => {
    expect(totalPairs(12)).toBe(66);
    expect(recommendedPicks(12)).toBe(30);
    expect(recommendedPicks(2)).toBe(1);
    expect(recommendedPicks(3)).toBe(3);
    expect(recommendedPicks(1)).toBe(0);
  });

  it('gives every color one comparison before any color gets two', () => {
    const picks = play(STANDARD_TEST_COLORS, STANDARD_TEST_COLORS, 6);
    const seen = picks.flatMap((p) => [p.a, p.b]);
    expect(new Set(seen).size).toBe(12);
  });

  it('never repeats a pair and stops when every pair is done', () => {
    const colors: TestColor[] = ['white', 'navy', 'black', 'tan'];
    const picks = play(colors, colors, 100);
    expect(picks).toHaveLength(6);
    expect(new Set(picks.map((p) => [p.a, p.b].sort().join('|'))).size).toBe(6);
    expect(nextPair(colors, picks)).toBeUndefined();
  });

  it('alternates which side a color is shown on', () => {
    const first = nextPair(['white', 'navy', 'black'], []);
    const second = nextPair(['white', 'navy', 'black'], [pick('black', 'tan', 'black'), pick('white', 'navy', 'white')]);
    expect(first).toEqual({ left: 'white', right: 'navy' });
    // One usable pick has been made, so the next pair is shown the other way round.
    expect(second!.right).toBe('white');
  });

  it('recovers a hidden order closely from the recommended number of picks', () => {
    const truth: TestColor[] = ['navy', 'white', 'burgundy', 'cream', 'lavender', 'light-blue', 'olive', 'charcoal', 'black', 'light-grey', 'tan', 'mustard'];
    const picks = play(STANDARD_TEST_COLORS, truth, recommendedPicks(12));
    expect(picks).toHaveLength(30);
    const order = rankColors(STANDARD_TEST_COLORS, picks).map((s) => s.color);
    expect(order[0]).toBe('navy');
    expect(order.at(-1)).toBe('mustard');
    // No color lands more than three places from its true place.
    const worst = Math.max(...order.map((c, i) => Math.abs(i - truth.indexOf(c))));
    expect(worst).toBeLessThanOrEqual(3);
    // The top four and the bottom four are the right sets.
    expect(new Set(order.slice(0, 4))).toEqual(new Set(truth.slice(0, 4)));
    expect(new Set(order.slice(-4))).toEqual(new Set(truth.slice(-4)));
  });

  it('gets the order exactly right once every pair is compared', () => {
    const truth: TestColor[] = ['navy', 'white', 'burgundy', 'cream', 'lavender', 'light-blue', 'olive', 'charcoal', 'black', 'light-grey', 'tan', 'mustard'];
    const picks = play(STANDARD_TEST_COLORS, truth, 66);
    expect(rankColors(STANDARD_TEST_COLORS, picks).map((s) => s.color)).toEqual(truth);
  });
});

describe('verdicts', () => {
  it('guesses from the score and leaves an uncompared color in the middle', () => {
    expect(proposeVerdict({ score: 0.9, games: 0 })).toBe('fine');
    expect(proposeVerdict({ score: 0.7, games: 3 })).toBe('best');
    expect(proposeVerdict({ score: 0.5, games: 3 })).toBe('fine');
    expect(proposeVerdict({ score: 0.3, games: 3 })).toBe('avoid');
  });

  it('lets the owner overrule the guess', () => {
    const standings = rankColors(['navy', 'black'], [pick('navy', 'black', 'navy')]);
    const results = testedColors(standings, { black: 'fine' });
    expect(results).toEqual([
      expect.objectContaining({ color: 'navy', rank: 1, of: 2, wins: 1 }),
      expect.objectContaining({ color: 'black', rank: 2, verdict: 'fine', losses: 1 }),
    ]);
  });
});

describe('captureSpanMinutes', () => {
  it('measures the gap between the first and last photo', () => {
    expect(captureSpanMinutes([])).toBe(0);
    expect(
      captureSpanMinutes([
        { color: 'white', photoId: 'a', takenAt: '2026-01-05T09:00:00.000Z' },
        { color: 'navy', photoId: 'b', takenAt: '2026-01-05T10:30:00.000Z' },
        { color: 'black', photoId: 'c', takenAt: '2026-01-05T09:10:00.000Z' },
      ]),
    ).toBe(90);
  });
});

describe('applyResultsToPalette', () => {
  const palette: PaletteEntry[] = [
    { id: 'p-light', color: 'White, cream, off-white', swatch: '#fff', nearFace: 'Yes', awayFromFace: 'Yes', confidence: 'high', why: 'Advice.' },
    { id: 'p-navy', color: 'Navy', swatch: '#123', nearFace: 'Yes', awayFromFace: 'Yes', confidence: 'high', why: 'Advice.' },
    { id: 'p-camel', color: 'Camel, tan', swatch: '#ca7', nearFace: 'Over cream or white', awayFromFace: 'Yes, as trousers', confidence: 'medium', why: 'Advice.' },
    { id: 'p-black', color: 'Black', swatch: '#111', nearFace: 'Test', awayFromFace: 'Yes (shoes)', confidence: 'unknown', why: 'Advice.' },
    { id: 'p-mustard', color: 'Mustard, yellow, orange', swatch: '#c93', nearFace: 'Test, expect no', awayFromFace: 'Small accents', confidence: 'low', why: 'Advice.' },
    { id: 'p-plum', color: 'Burgundy, plum', swatch: '#612', nearFace: 'Yes', awayFromFace: 'Yes', confidence: 'high', why: 'Advice.' },
  ];
  const results = testedColors(
    rankColors(
      ['white', 'black', 'tan', 'mustard'],
      [
        pick('white', 'black', 'white'),
        pick('white', 'tan', 'white'),
        pick('black', 'mustard', 'black'),
        pick('tan', 'mustard', 'tan'),
        pick('black', 'tan', 'black'),
        pick('white', 'mustard', 'same'),
      ],
    ),
  );
  const next = applyResultsToPalette(palette, results, '2026-01-06');

  it('leads with the tested colors in ranked order, marked as the owner\'s test', () => {
    expect(next.slice(0, 4).map((e) => e.family)).toEqual(['white', 'black', 'tan', 'mustard']);
    expect(next[0]).toMatchObject({
      id: 'pal-test-white',
      color: 'White',
      evidence: 'your-test',
      nearFace: 'Yes, one of your best',
      test: { verdict: 'best', rank: 1, of: 4, wins: 2, losses: 0, ties: 1, testedOn: '2026-01-06' },
    });
    expect(next[0]!.why).toBe('Number 1 of 4 in your color test. It won 2 picks, lost 0, tied 1.');
    expect(next[1]!.why).toBe('Number 2 of 4 in your color test. It won 2 picks, lost 1.');
    expect(next[3]).toMatchObject({ family: 'mustard', nearFace: 'Not next to the face', test: { verdict: 'avoid', ties: 1 } });
  });

  it('carries over the advice for wearing a color away from the face', () => {
    expect(next.find((e) => e.family === 'tan')!.awayFromFace).toBe('Yes, as trousers');
    expect(next.find((e) => e.family === 'black')!.awayFromFace).toBe('Yes (shoes)');
  });

  it('takes tested colors out of the stylists\' entries and keeps the untested ones', () => {
    const rest = next.slice(4);
    expect(rest.map((e) => e.color)).toEqual(['Cream, off-white', 'Navy', 'Yellow, orange', 'Burgundy, plum']);
    expect(rest.every((e) => e.evidence === undefined && e.test === undefined)).toBe(true);
  });

  it('replaces an earlier test result for the same color and keeps earlier results for other colors', () => {
    const second = testedColors(rankColors(['white', 'navy'], [pick('white', 'navy', 'navy')]));
    const again = applyResultsToPalette(next, second, '2026-02-01');
    expect(again.filter((e) => e.family === 'white')).toHaveLength(1);
    expect(again.find((e) => e.family === 'white')!.test).toMatchObject({ rank: 2, testedOn: '2026-02-01' });
    expect(again.find((e) => e.family === 'black')!.test).toMatchObject({ testedOn: '2026-01-06' });
    expect(again.some((e) => e.id === 'p-navy')).toBe(false);
  });

  it('does not change the palette it was given', () => {
    expect(palette[0]!.color).toBe('White, cream, off-white');
    expect(palette).toHaveLength(6);
  });
});

describe('rulesAnsweredBy', () => {
  const rules: Rule[] = [
    { id: 'r1', kind: 'open-test', text: 'Black near the face.', evidence: 'working-rule' },
    { id: 'r2', kind: 'open-test', text: 'Mid grey near the face.', evidence: 'working-rule' },
    { id: 'r3', kind: 'open-test', text: 'Camel near the face.', evidence: 'working-rule' },
    { id: 'r4', kind: 'open-test', text: 'Mustard and brighter colors near the face.', evidence: 'working-rule' },
    { id: 'r5', kind: 'hard', text: 'No black leather jackets.', evidence: 'your-rule' },
  ];

  it('finds the open tests that name a tested color', () => {
    expect(rulesAnsweredBy(rules, ['black', 'tan', 'mustard']).map((r) => r.id)).toEqual(['r1', 'r3', 'r4']);
  });

  it('does not read light grey as mid grey', () => {
    expect(rulesAnsweredBy(rules, ['light-grey', 'charcoal'])).toEqual([]);
    expect(rulesAnsweredBy(rules, ['grey']).map((r) => r.id)).toEqual(['r2']);
  });

  it('leaves rules of other kinds alone', () => {
    expect(rulesAnsweredBy(rules, ['black']).map((r) => r.id)).toEqual(['r1']);
  });

  it('lists the colors the open tests ask about, in test order', () => {
    expect(openTestColors(rules)).toEqual(['black', 'tan', 'mustard', 'grey']);
    expect(openTestColors([rules[4]!])).toEqual([]);
  });
});

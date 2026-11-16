/**
 * The color photo test: the owner photographs each color under the chin, picks
 * the better of two photos again and again, and the picks become a ranking of
 * colors near the face. This file is the logic only, with no storage and no UI.
 *
 * The ranking is the owner's own judgment. Nothing here measures skin or color
 * from the photo, because a casual photo cannot do that reliably.
 */
import { COLOR_FAMILIES } from './options';
import type { ColorFamily, Confidence, NearFaceVerdict, PaletteEntry, Rule } from './types';

/** A color that can be tested. Each one is a color family, so results match pieces. */
export type TestColor = Exclude<ColorFamily, 'other'>;

/** The twelve colors from the coloring report, in the order they are photographed. */
export const STANDARD_TEST_COLORS: TestColor[] = [
  'white',
  'cream',
  'navy',
  'burgundy',
  'olive',
  'charcoal',
  'light-grey',
  'black',
  'tan',
  'mustard',
  'light-blue',
  'lavender',
];

/** Every color the test offers: the standard twelve first, then the rest. */
export const ALL_TEST_COLORS: TestColor[] = [
  ...STANDARD_TEST_COLORS,
  ...COLOR_FAMILIES.map((c) => c.value).filter((c): c is TestColor => c !== 'other' && !STANDARD_TEST_COLORS.includes(c as TestColor)),
];

export interface ColorShot {
  color: TestColor;
  /** The photo row that holds the picture. It may be gone after a restore on a new phone. */
  photoId: string;
  takenAt: string;
}

export interface ColorPick {
  a: TestColor;
  b: TestColor;
  /** "same" means the owner could not tell them apart. */
  winner: TestColor | 'same';
  at: string;
}

export interface TestedColor {
  color: TestColor;
  verdict: NearFaceVerdict;
  rank: number;
  of: number;
  wins: number;
  losses: number;
  ties: number;
}

/** What was written to the palette, and what is needed to take it back. */
export interface AppliedColorTest {
  appliedAt: string;
  results: TestedColor[];
  /** The palette as it was before. */
  previousPalette: PaletteEntry[];
  /** Open tests this answered. They were removed from the profile and are kept here for undo. */
  answeredRules: Rule[];
}

export interface ColorTest {
  id: 'current';
  startedAt: string;
  updatedAt: string;
  /** The colors chosen for this test, in the order they are photographed. */
  colors: TestColor[];
  shots: ColorShot[];
  picks: ColorPick[];
  applied?: AppliedColorTest;
}

/** The value stored in a photo's pieceId for a color-test photo. */
export const COLOR_TEST_PHOTO_PREFIX = 'color-test:';

export function colorTestPhotoOwner(color: TestColor): string {
  return `${COLOR_TEST_PHOTO_PREFIX}${color}`;
}

export function testColorLabel(color: TestColor): string {
  return COLOR_FAMILIES.find((c) => c.value === color)?.label ?? color;
}

export function testColorSwatch(color: TestColor): string {
  return COLOR_FAMILIES.find((c) => c.value === color)?.swatch ?? '#b9b2a6';
}

export const VERDICTS: { value: NearFaceVerdict; label: string; nearFace: string }[] = [
  { value: 'best', label: 'Best', nearFace: 'Yes, one of your best' },
  { value: 'fine', label: 'Fine', nearFace: 'Yes' },
  { value: 'avoid', label: 'Not near face', nearFace: 'Not next to the face' },
];

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface Standing {
  color: TestColor;
  /** 1 is best. */
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  /**
   * The chance this color beats an average color in the test, from 0 to 1.
   * 0.5 means middle of the field.
   */
  score: number;
}

function pairKey(a: TestColor, b: TestColor): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Picks between two colors that are both in the list. Older picks of a pair give way to newer ones. */
function usablePicks(colors: TestColor[], picks: ColorPick[]): ColorPick[] {
  const inTest = new Set(colors);
  const latest = new Map<string, ColorPick>();
  for (const pick of picks) {
    if (pick.a === pick.b || !inTest.has(pick.a) || !inTest.has(pick.b)) continue;
    latest.set(pairKey(pick.a, pick.b), pick);
  }
  return [...latest.values()];
}

/**
 * Turns picks into a ranking with the Bradley-Terry method: each color gets a
 * strength, and the chance that one color beats another is its strength over
 * the sum of both. A tie counts as half a win each way.
 *
 * Every color also starts with one imaginary tie against an average color.
 * That keeps a color with one lucky win from shooting to the top, and it makes
 * the numbers well defined before any picks exist.
 */
export function rankColors(colors: TestColor[], picks: ColorPick[]): Standing[] {
  const used = usablePicks(colors, picks);
  const index = new Map(colors.map((c, i) => [c, i]));
  const n = colors.length;
  const wins = new Array<number>(n).fill(0);
  const losses = new Array<number>(n).fill(0);
  const ties = new Array<number>(n).fill(0);
  // games[i][j] is how many times i met j.
  const games = colors.map(() => new Array<number>(n).fill(0));

  for (const pick of used) {
    const a = index.get(pick.a)!;
    const b = index.get(pick.b)!;
    games[a]![b]! += 1;
    games[b]![a]! += 1;
    if (pick.winner === 'same') {
      ties[a]! += 1;
      ties[b]! += 1;
    } else if (pick.winner === pick.a) {
      wins[a]! += 1;
      losses[b]! += 1;
    } else {
      wins[b]! += 1;
      losses[a]! += 1;
    }
  }

  let strength = new Array<number>(n).fill(1);
  for (let round = 0; round < 200; round++) {
    let change = 0;
    const next = strength.map((own, i) => {
      // The imaginary tie against an average color of strength 1.
      const credit = wins[i]! + ties[i]! / 2 + 0.5;
      let exposure = 1 / (own + 1);
      for (let j = 0; j < n; j++) {
        const met = games[i]![j]!;
        if (met > 0) exposure += met / (own + strength[j]!);
      }
      const value = credit / exposure;
      change = Math.max(change, Math.abs(value - own));
      return value;
    });
    strength = next;
    if (change < 1e-9) break;
  }

  const standings = colors.map((color, i) => {
    let total = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i) total += strength[i]! / (strength[i]! + strength[j]!);
    }
    return {
      color,
      rank: 0,
      wins: wins[i]!,
      losses: losses[i]!,
      ties: ties[i]!,
      games: wins[i]! + losses[i]! + ties[i]!,
      score: n > 1 ? total / (n - 1) : 0.5,
    };
  });

  standings.sort((x, y) => y.score - x.score || y.wins - y.losses - (x.wins - x.losses) || index.get(x.color)! - index.get(y.color)!);
  standings.forEach((s, i) => {
    s.rank = i + 1;
  });
  return standings;
}

/** How many different pairs there are among n colors. */
export function totalPairs(n: number): number {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}

/**
 * How many picks give a ranking worth trusting. Comparing every pair of
 * twelve colors would take 66 picks. Pairing colors that are close in the
 * standings, the way a chess tournament does, needs far fewer: about one more
 * round than the number of halvings it takes to get from n to 1.
 */
export function recommendedPicks(n: number): number {
  if (n < 2) return 0;
  const rounds = Math.ceil(Math.log2(n)) + 1;
  return Math.min(totalPairs(n), Math.ceil(n / 2) * rounds);
}

export interface Pair {
  left: TestColor;
  right: TestColor;
}

/**
 * The next two colors to compare, or undefined when every pair has been
 * compared. It prefers colors that have been compared least, and among those
 * the two that sit closest in the standings, because a close call teaches the
 * ranking more than an obvious one.
 */
export function nextPair(colors: TestColor[], picks: ColorPick[]): Pair | undefined {
  const used = usablePicks(colors, picks);
  const done = new Set(used.map((p) => pairKey(p.a, p.b)));
  const standing = new Map(rankColors(colors, picks).map((s) => [s.color, s]));

  let best: { a: TestColor; b: TestColor; cost: number } | undefined;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const a = colors[i]!;
      const b = colors[j]!;
      if (done.has(pairKey(a, b))) continue;
      const sa = standing.get(a)!;
      const sb = standing.get(b)!;
      const cost = sa.games * sa.games + sb.games * sb.games + Math.abs(sa.score - sb.score);
      if (!best || cost < best.cost - 1e-12) best = { a, b, cost };
    }
  }
  if (!best) return undefined;
  // Alternate sides, so a habit of tapping one side does not favor a color.
  return used.length % 2 === 0 ? { left: best.a, right: best.b } : { left: best.b, right: best.a };
}

/**
 * A first guess at the verdict. The ranking only says which colors beat which,
 * so where "best" ends and "not near the face" begins is the owner's call.
 * This guess is shown for the owner to change.
 *
 * The lines are plain ones: a color that would beat an average color in the
 * test two times in three is a "best", and one that would lose two times in
 * three is a "not near the face".
 */
export function proposeVerdict(standing: Pick<Standing, 'score' | 'games'>): NearFaceVerdict {
  if (standing.games === 0) return 'fine';
  if (standing.score >= 2 / 3) return 'best';
  if (standing.score <= 1 / 3) return 'avoid';
  return 'fine';
}

/** The ranking with a verdict for each color: the owner's choice where given, the guess elsewhere. */
export function testedColors(standings: Standing[], chosen: Partial<Record<TestColor, NearFaceVerdict>> = {}): TestedColor[] {
  return standings.map((s) => ({
    color: s.color,
    verdict: chosen[s.color] ?? proposeVerdict(s),
    rank: s.rank,
    of: standings.length,
    wins: s.wins,
    losses: s.losses,
    ties: s.ties,
  }));
}

/** Minutes between the first and the last photo. Daylight shifts, so a long gap makes the photos unfair to compare. */
export function captureSpanMinutes(shots: ColorShot[]): number {
  if (shots.length < 2) return 0;
  const times = shots.map((s) => new Date(s.takenAt).getTime()).filter((t) => Number.isFinite(t));
  if (times.length < 2) return 0;
  return Math.round((Math.max(...times) - Math.min(...times)) / 60_000);
}

/** Past this many minutes the app suggests retaking the photos in one go. */
export const MAX_CAPTURE_SPAN_MINUTES = 45;

// ---------------------------------------------------------------------------
// Writing results to the palette
// ---------------------------------------------------------------------------

/** Other names a color goes by in palette entries and rules written by hand. */
const ALIASES: Record<TestColor, string[]> = {
  white: ['white'],
  cream: ['cream'],
  'light-blue': ['light blue', 'pale blue'],
  lavender: ['lavender'],
  aqua: ['aqua'],
  blue: ['blue', 'mid blue'],
  navy: ['navy'],
  burgundy: ['burgundy'],
  plum: ['plum'],
  olive: ['olive'],
  green: ['green'],
  tan: ['tan', 'camel', 'tan or camel'],
  brown: ['brown', 'mid brown'],
  'dark-brown': ['dark brown'],
  'light-grey': ['light grey', 'light gray'],
  grey: ['mid grey', 'mid gray', 'grey', 'gray'],
  charcoal: ['charcoal'],
  black: ['black'],
  mustard: ['mustard'],
};

function colorOfName(name: string): TestColor | undefined {
  const wanted = name.trim().toLowerCase();
  for (const color of ALL_TEST_COLORS) {
    if (ALIASES[color].includes(wanted)) return color;
  }
  return undefined;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function describeResult(result: TestedColor): string {
  const record = [`won ${plural(result.wins, 'pick')}`, `lost ${result.losses}`];
  if (result.ties > 0) record.push(`tied ${result.ties}`);
  return `Number ${result.rank} of ${result.of} in your color test. It ${record.join(', ')}.`;
}

/**
 * The palette with the tested colors written in. Each tested color becomes
 * its own entry, in ranked order, marked as the owner's test. Entries that
 * were stylists' advice lose the colors that now have a tested answer, and the
 * colors that were not tested stay as they were.
 */
export function applyResultsToPalette(palette: PaletteEntry[], results: TestedColor[], testedOn: string): PaletteEntry[] {
  const tested = new Set(results.map((r) => r.color));

  const earlier = (color: TestColor): PaletteEntry | undefined =>
    palette.find((e) => e.family === color) ?? palette.find((e) => e.color.split(',').some((name) => colorOfName(name) === color));

  const fresh: PaletteEntry[] = [...results]
    .sort((a, b) => a.rank - b.rank)
    .map((result) => {
      const games = result.wins + result.losses + result.ties;
      const confidence: Confidence = games >= 3 ? 'high' : 'medium';
      return {
        id: `pal-test-${result.color}`,
        color: testColorLabel(result.color),
        swatch: testColorSwatch(result.color),
        family: result.color,
        nearFace: VERDICTS.find((v) => v.value === result.verdict)!.nearFace,
        // The test is about the face only, so advice for the rest of the outfit carries over.
        awayFromFace: earlier(result.color)?.awayFromFace ?? 'Not tested',
        confidence,
        why: describeResult(result),
        evidence: 'your-test',
        test: {
          verdict: result.verdict,
          rank: result.rank,
          of: result.of,
          wins: result.wins,
          losses: result.losses,
          ties: result.ties,
          testedOn,
        },
      };
    });

  const rest: PaletteEntry[] = [];
  for (const entry of palette) {
    if (entry.family) {
      if (!tested.has(entry.family as TestColor)) rest.push(entry);
      continue;
    }
    const names = entry.color.split(',').map((name) => name.trim()).filter(Boolean);
    const kept = names.filter((name) => {
      const color = colorOfName(name);
      return !color || !tested.has(color);
    });
    if (kept.length === 0) continue;
    rest.push(kept.length === names.length ? entry : { ...entry, color: capitalize(kept.join(', ')) });
  }
  return [...fresh, ...rest];
}

/**
 * The open tests in the profile that this test looks to have answered: a rule
 * of the "open test" kind whose words name a tested color. It is a suggestion,
 * and the owner confirms it before any rule is removed.
 */
export function rulesAnsweredBy(rules: Rule[], colors: TestColor[]): Rule[] {
  const tested = new Set(colors);
  return rules.filter((rule) => rule.kind === 'open-test' && colorsNamedIn(rule.text).some((color) => tested.has(color)));
}

/**
 * The colors that the profile's open tests ask about, in test order. The test
 * turns these on from the start, even when they are outside the standard twelve.
 */
export function openTestColors(rules: Rule[]): TestColor[] {
  const named = new Set(rules.filter((r) => r.kind === 'open-test').flatMap((r) => colorsNamedIn(r.text)));
  return ALL_TEST_COLORS.filter((color) => named.has(color));
}

/** The colors a sentence names. */
function colorsNamedIn(sentence: string): TestColor[] {
  // Longest names first, so "light grey" is not read as mid "grey".
  const names = ALL_TEST_COLORS.flatMap((color) => ALIASES[color].map((alias) => ({ alias, color }))).sort(
    (a, b) => b.alias.length - a.alias.length,
  );
  let text = sentence.toLowerCase();
  const found: TestColor[] = [];
  for (const { alias, color } of names) {
    const pattern = new RegExp(`\\b${alias}\\b`, 'g');
    if (!pattern.test(text)) continue;
    text = text.replace(pattern, ' ');
    found.push(color);
  }
  return found;
}

/** Today as YYYY-MM-DD in the phone's own time zone. */
export function localDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

import { CONFIDENCE_LABELS } from '../options';
import type { ColorFamily, Confidence, Evidence, Formula, PaletteEntry, Piece } from '../types';
import { creditLine } from './formulas';
import { OCCASION_RULES, forOccasion } from './occasions';
import type { OutfitLogEntry } from './records';
import { averageLevel, capitalize, colorGroup, colorWord, depthOf, hasCollar, isPleatedOrWide, isRough, isStrong, levelOf, nearFace } from './traits';
import type { Occasion, Outfit, ScorePart } from './types';

/**
 * Step 3 of the method: points for each outfit that survived the filters.
 *
 * The weights are starting values. The design brief leaves them to be tuned
 * against outfits the owner has approved, so they live in one table.
 */
export const WEIGHTS = {
  savedLook: 30,
  otherLook: 12,
  nearFace: 16,
  nearFaceUnder: 6,
  oneRough: 8,
  twoRough: 3,
  proportion: 8,
  shortTop: 4,
  presence: 4,
  occasionFit: 10,
  collarForDate: 6,
  eveningKnit: 5,
  eveningShoes: 2,
  wornLately: -12,
  sameAsLastTime: -18,
  wornBefore: 2,
  wornBeforeMax: 6,
  loved: 3,
  ratedNo: -8,
  passedOver: -5,
  weekRepeat: -40,
} as const;

/* Near the face */

type Verdict = 'yes' | 'over-light' | 'test' | 'no' | 'unrated';

export interface FaceRating {
  verdict: Verdict;
  confidence: Confidence;
  /** True when the rating comes from the owner's own color test. */
  tested: boolean;
}

const PALETTE_NAMES: Partial<Record<string, string[]>> = {
  white: ['white'],
  cream: ['cream', 'off-white'],
  'light-blue': ['light blue'],
  lavender: ['lavender'],
  aqua: ['aqua'],
  blue: ['blue'],
  navy: ['navy'],
  burgundy: ['burgundy'],
  plum: ['plum'],
  olive: ['olive'],
  green: ['green'],
  tan: ['tan', 'camel'],
  brown: ['brown', 'mid brown'],
  'dark-brown': ['dark brown'],
  'light-grey': ['light grey'],
  grey: ['grey', 'mid grey'],
  charcoal: ['charcoal'],
  black: ['black'],
  mustard: ['mustard'],
};

const CONFIDENCE_FACTOR: Record<Confidence, number> = { high: 1, 'medium-high': 0.8, medium: 0.6, low: 0.35, unknown: 0.2 };

const UNRATED: FaceRating = { verdict: 'unrated', confidence: 'unknown', tested: false };

/**
 * How a color rates next to the face. A result from the color test wins.
 * Otherwise the palette's own words are read: "Yes", "Over a light layer",
 * "Test" or anything else.
 */
export function faceRating(family: ColorFamily | undefined, palette: PaletteEntry[]): FaceRating {
  if (!family) return UNRATED;
  const rows = palette;
  const tested = rows.find((row) => row.family === family && row.test?.verdict);
  if (tested) {
    const verdict = tested.test?.verdict;
    if (verdict === 'best') return { verdict: 'yes', confidence: 'high', tested: true };
    if (verdict === 'fine') return { verdict: 'yes', confidence: 'medium', tested: true };
    if (verdict === 'avoid') return { verdict: 'no', confidence: 'high', tested: true };
  }
  const names = PALETTE_NAMES[family] ?? [];
  const row =
    rows.find((r) => r.family === family) ??
    rows.find((r) =>
      r.color
        .toLowerCase()
        .split(',')
        .map((name) => name.trim())
        .some((name) => names.includes(name)),
    );
  if (!row) return UNRATED;
  const words = row.nearFace.trim().toLowerCase();
  let verdict: Verdict = 'unrated';
  if (words.startsWith('yes')) verdict = 'yes';
  else if (words.startsWith('over')) verdict = 'over-light';
  else if (words.startsWith('test')) verdict = 'test';
  else if (words.startsWith('no') || words.startsWith('rarely') || words.startsWith('avoid')) verdict = 'no';
  return { verdict, confidence: row.confidence, tested: false };
}

function ratingWords(rating: FaceRating): string {
  return rating.tested ? 'your color test rated it well' : `rated ${CONFIDENCE_LABELS[rating.confidence].toLowerCase()} in your palette`;
}

function nearFacePart(outfit: Outfit, palette: PaletteEntry[]): ScorePart | undefined {
  const [top, under] = nearFace(outfit);
  if (!top) return undefined;
  const topRating = faceRating(top.colorFamily, palette);
  const underRating = under ? faceRating(under.colorFamily, palette) : undefined;
  const lightUnder = under !== undefined && colorGroup(under) === 'white';
  const evidence: Evidence = topRating.tested ? 'your-test' : 'convention';
  const topColor = capitalize(colorWord(top.colorFamily));

  let points = 0;
  let text: string | undefined;
  if (topRating.verdict === 'yes') {
    points += WEIGHTS.nearFace * CONFIDENCE_FACTOR[topRating.confidence];
    text = `${topColor} near your face: ${ratingWords(topRating)}.`;
  } else if (topRating.verdict === 'over-light') {
    points += WEIGHTS.nearFace * CONFIDENCE_FACTOR[topRating.confidence] * (lightUnder ? 1 : 0.25);
    if (lightUnder) text = `${topColor} near your face, over a light layer as your palette asks.`;
  } else if (topRating.verdict === 'no') {
    points -= WEIGHTS.nearFace * 0.75;
  }
  if (under && underRating?.verdict === 'yes') {
    points += WEIGHTS.nearFaceUnder * CONFIDENCE_FACTOR[underRating.confidence];
    if (topRating.verdict === 'yes') {
      const underColor = colorWord(under.colorFamily);
      text =
        topRating.confidence === underRating.confidence && !topRating.tested && !underRating.tested
          ? `${topColor} and ${underColor} near your face: both rated ${CONFIDENCE_LABELS[topRating.confidence].toLowerCase()} in your palette.`
          : `${topColor} near your face (${ratingWords(topRating)}), with ${underColor} at the collar.`;
    }
  }
  if (points === 0) return undefined;
  return { id: 'near-face', points, text: points > 0 ? text : undefined, evidence };
}

/* Formula */

function formulaPart(formula: Formula | undefined): ScorePart | undefined {
  if (!formula) return undefined;
  const credit = creditLine(formula);
  const name = `"${formula.name}"${credit ? ` (${credit})` : ''}`;
  switch (formula.source) {
    case 'your-looks':
      return { id: 'formula', points: WEIGHTS.savedLook, text: `Your saved look: ${name}.`, evidence: 'your-choice' };
    case 'suits-you':
      return {
        id: 'formula',
        points: WEIGHTS.otherLook,
        text: `Beyond your saved looks: ${name}, built from your coloring and fit findings.`,
        evidence: 'convention',
      };
    case 'similar-creators':
      return { id: 'formula', points: WEIGHTS.otherLook, text: `Beyond your saved looks: ${name}.`, evidence: 'convention' };
    case 'in-season':
      return { id: 'formula', points: WEIGHTS.otherLook, text: `Beyond your saved looks: ${name}, a trend you approved.`, evidence: 'convention' };
    case 'test':
      return {
        id: 'formula',
        points: WEIGHTS.otherLook,
        text: `A test: ${name}.${formula.note ? ` ${formula.note}` : ''}`,
        evidence: 'working-rule',
      };
  }
}

/* Texture, proportion, presence */

function texturePart(outfit: Outfit): ScorePart | undefined {
  const shown = [...nearFace(outfit), outfit.thirdLayer, outfit.trousers, outfit.shoes].filter((p): p is Piece => p !== undefined);
  const rough = shown.filter((p) => isRough(p));
  const [only] = rough;
  if (rough.length === 1 && only) {
    return {
      id: 'texture',
      points: WEIGHTS.oneRough,
      text: `One rough texture, the ${lowerFirst(only.name)}, with nothing competing.`,
      evidence: 'convention',
    };
  }
  if (rough.length === 2) return { id: 'texture', points: WEIGHTS.twoRough, evidence: 'convention' };
  return undefined;
}

function lowerFirst(text: string): string {
  // Leave a brand-style name such as "BOSS zip" or "XX Chino" alone.
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function proportionPart(outfit: Outfit): ScorePart | undefined {
  const outer = outfit.thirdLayer ?? outfit.mainTop;
  const short = outer.hem === 'at-belt' || outer.hem === 'mid-fly';
  const where = outer.hem === 'at-belt' ? 'at the belt' : 'by mid-fly';
  const full = isPleatedOrWide(outfit.trousers);
  if (short && full) {
    return {
      id: 'proportion',
      points: WEIGHTS.proportion,
      text: `Top ends ${where} over fuller trousers, which makes your legs look longer.`,
      evidence: 'convention',
    };
  }
  if (short) return { id: 'proportion', points: WEIGHTS.shortTop, text: `Top ends ${where}, which makes your legs look longer.`, evidence: 'convention' };
  return undefined;
}

function presencePart(outfit: Outfit): ScorePart | undefined {
  const neck = outfit.mainTop.neckline;
  if (neck === 'full-zip' || neck === 'quarter-zip' || neck === 'stand-collar' || neck === 'shawl-collar') {
    return { id: 'presence', points: WEIGHTS.presence, text: 'A zip or stand collar adds shape to your upper body.', evidence: 'convention' };
  }
  return undefined;
}

/* Occasion */

function occasionParts(outfit: Outfit, occasion: Occasion): ScorePart[] {
  const rule = OCCASION_RULES[occasion];
  const parts: ScorePart[] = [];
  const middle = (rule.min + rule.max) / 2;
  const half = (rule.max - rule.min) / 2;
  const closeness = Math.max(0, 1 - Math.abs(averageLevel(outfit) - middle) / half);
  parts.push({
    id: 'occasion-fit',
    points: WEIGHTS.occasionFit * closeness,
    text: closeness >= 0.6 ? `Its dress level sits near the middle of the range ${forOccasion(occasion)}.` : undefined,
    evidence: 'working-rule',
  });
  if (occasion === 'date' && nearFace(outfit).some(hasCollar)) {
    parts.push({ id: 'collar', points: WEIGHTS.collarForDate, text: 'A collar near your face, which helps for a date.', evidence: 'working-rule' });
  }
  if (occasion === 'going-out') {
    let points = 0;
    const rich = depthOf(outfit.mainTop) === 'dark' || isStrong(outfit.mainTop);
    if (rich) points += WEIGHTS.eveningKnit;
    if (levelOf(outfit.shoes) >= 2) points += WEIGHTS.eveningShoes;
    if (points > 0) parts.push({ id: 'evening', points, text: rich ? 'A darker or richer top for the evening.' : undefined, evidence: 'working-rule' });
  }
  return parts;
}

/* Rotation and history, from the log */

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function pairOf(entry: OutfitLogEntry): string {
  return `${entry.pieces.mainTop}|${entry.pieces.trousers}`;
}

export interface LogContext {
  log: OutfitLogEntry[];
  date: string;
  occasion: Occasion;
}

function rotationPart(outfit: Outfit, { log, date, occasion }: LogContext): ScorePart | undefined {
  const worn = log.filter((e) => e.action === 'wore' && e.date < date);
  let points = 0;
  let text: string | undefined;
  const lastSame = worn.filter((e) => e.occasion === occasion).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (lastSame && pairOf(lastSame) === `${outfit.mainTop.id}|${outfit.trousers.id}`) {
    points += WEIGHTS.sameAsLastTime;
    text = `You wore the ${lowerFirst(outfit.mainTop.name)} with the ${lowerFirst(outfit.trousers.name)} the last time you dressed ${forOccasion(occasion)}, so that pair sits out.`;
  }
  const lately = worn.find((e) => e.pieces.mainTop === outfit.mainTop.id && daysBetween(e.date, date) <= 2);
  if (lately) {
    points += WEIGHTS.wornLately;
    text ??= `You wore the ${lowerFirst(outfit.mainTop.name)} ${daysBetween(lately.date, date) === 1 ? 'yesterday' : 'two days ago'}, so it sits out.`;
  }
  return points === 0 ? undefined : { id: 'rotation', points, text, evidence: 'working-rule' };
}

function historyPart(outfit: Outfit, key: string, { log, occasion }: LogContext): ScorePart | undefined {
  const pair = `${outfit.mainTop.id}|${outfit.trousers.id}`;
  const worn = log.filter((e) => e.action === 'wore' && e.occasion === occasion && pairOf(e) === pair);
  let points = Math.min(WEIGHTS.wornBeforeMax, worn.length * WEIGHTS.wornBefore);
  points += worn.filter((e) => e.rating === 'loved').length * WEIGHTS.loved;
  points += worn.filter((e) => e.rating === 'no').length * WEIGHTS.ratedNo;
  const passed = log.filter((e) => e.action === 'not-today' && e.outfitKey === key && (e.reason === 'colors' || e.reason === 'fit'));
  points += Math.max(-15, passed.length * WEIGHTS.passedOver);
  if (points === 0) return undefined;
  const times = worn.length === 1 ? 'once' : `${worn.length} times`;
  return {
    id: 'history',
    points,
    text: points >= 4 ? `You have worn this pair ${times} ${forOccasion(occasion)}.` : undefined,
    evidence: 'your-choice',
  };
}

export interface ScoreContext extends LogContext {
  palette: PaletteEntry[];
  /** Main tops already planned for other days of the week. */
  avoidTopIds?: string[];
}

export function scoreOutfit(outfit: Outfit, key: string, formula: Formula | undefined, context: ScoreContext): ScorePart[] {
  const parts: (ScorePart | undefined)[] = [
    formulaPart(formula),
    nearFacePart(outfit, context.palette),
    texturePart(outfit),
    proportionPart(outfit),
    presencePart(outfit),
    ...occasionParts(outfit, context.occasion),
    rotationPart(outfit, context),
    historyPart(outfit, key, context),
    context.avoidTopIds?.includes(outfit.mainTop.id) ? { id: 'week-repeat', points: WEIGHTS.weekRepeat, evidence: 'working-rule' } : undefined,
  ];
  return parts.filter((p): p is ScorePart => p !== undefined);
}

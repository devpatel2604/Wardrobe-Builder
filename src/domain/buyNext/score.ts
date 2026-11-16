import { CONFIDENCE_LABELS } from '../options';
import { sortWardrobe, type Wardrobe } from '../outfits/build';
import { COAT_BELOW_F } from '../outfits/filters';
import { creditLine, matchesPiece } from '../outfits/formulas';
import { forOccasion } from '../outfits/occasions';
import { CONFIDENCE_FACTOR, faceRating, type FaceRating } from '../outfits/score';
import { capitalize, colorGroup, colorWord, isCoat, isShortSleeve, levelOf } from '../outfits/traits';
import type { Occasion, Outfit, Reason } from '../outfits/types';
import { breaksHardRule, checkPiece, type RuleFinding } from '../ruleChecks';
import type { Formula, FormulaSlot, PaletteEntry, Piece, Rule, Slot } from '../types';
import { CELLS, OCCASION_ORDER, paperId, paperOutfits, paperPiece, type PaperOutfit } from './paper';
import { monthsAhead, type MonthWeather } from './season';
import type { BuyPart, CellGain, WishItem } from './types';

/**
 * Ranks the buy-next list (design brief, section 7.4).
 *
 * Every piece on the list goes into the wardrobe on paper, and the outfit
 * rules count what it adds. The list is ranked one place at a time: the best
 * piece first, then the best piece given that the first is bought, and so on.
 * So the order reads as "buy in this order", the way the wardrobe report's
 * hand-made list does.
 *
 * Everything here is plain rules on the phone. No AI model ranks anything.
 *
 * The weights are working values. They were set so that the made-up wardrobe
 * in the tests ranks sensibly, and then checked against the owner's hand-made
 * list, which is the answer key the brief names. They are not sourced facts.
 */
export const BUY_WEIGHTS = {
  /** Evenings out and dates in a week. Working values until the day plans can supply them. */
  eveningsOut: 1,
  dates: 1,
  /** 1 counts an occasion by its days a week, 0 counts all four the same, 0.5 sits between. */
  frequencyPower: 1,
  /** A wet day counts this much of a dry one: about one day in four is wet. */
  wetDay: 0.25,
  /**
   * "Two pieces ahead": outfits that need this piece and one more from the
   * list. Those made with the best partner count half, since two pieces share
   * the credit. Those made with the second-best partner count a quarter.
   */
  withBestPartner: 0.25,
  withSecondPartner: 0.1,
  /** Points for each saved look the piece is in, split over the pieces that look still lacks. */
  savedLook: 2.5,
  /** A saved look known only by its id, with no recipe to check. */
  savedLookUnchecked: 0.5,
  /**
   * A first coat when the months ahead are cold, or a first belt: this many
   * points times the share of outfits (or of months) it would be worn with.
   * Set above what a piece scores for adding outfits, because every outfit the
   * owner can already make is missing it.
   */
  basic: 10,
  /** A piece from beyond the saved looks counts this much. The owner chose "mostly my looks". */
  beyondLooks: 0.75,
  /** A near-face color that only works over a light layer counts this much of its palette rating. */
  overLightLayer: 0.75,
  /** Each owned piece of the same kind, color and dress level multiplies the score by this. */
  covered: 0.5,
  /** The same kind and color at another dress level: it does part of the job. */
  partlyCovered: 0.75,
  /** The most a low price can lift a score, as a share of it. */
  cheapLift: 0.1,
  /** The price at which the lift is half of that. */
  cheapAt: 100,
  /** Below this, a piece is not worth buying yet, and the list says so. */
  bar: 0.3,
};

export type BuyWeights = typeof BUY_WEIGHTS;

/** The weights in use. Set at the start of each ranking, so a test can try other values. */
let W: BuyWeights = BUY_WEIGHTS;

/** How many list pieces one outfit may need. Outfits that need more are too far off to count. */
const MAX_NEEDS = 3;

/** How much a near-face color counts, from the palette. */
function faceFactor(rating: FaceRating): number {
  switch (rating.verdict) {
    case 'yes':
      return CONFIDENCE_FACTOR[rating.confidence];
    case 'over-light':
      // Fine over a white or cream layer only, so some of its outfits are second best.
      return CONFIDENCE_FACTOR[rating.confidence] * W.overLightLayer;
    case 'test':
      return 0.35;
    case 'no':
      return 0.2;
    case 'unrated':
      return 0.6;
  }
}

export interface BuyInput {
  items: WishItem[];
  pieces: Piece[];
  rules: Rule[];
  palette: PaletteEntry[];
  formulas: Formula[];
  /** YYYY-MM-DD */
  date: string;
  /** Latitude of home, to tell the seasons apart. */
  lat?: number;
  /** How many days a week are office days. */
  officeDays?: number;
  /** Other weights to try, for tests and tuning. */
  weights?: Partial<BuyWeights>;
  /** For tuning: called at each place in the order with every remaining piece's score. */
  trace?: (place: number, scores: { id: string; score: number; parts: BuyPart[] }[]) => void;
}

export interface LookNote {
  formula: Formula;
  /** Pieces the look still lacks, this one included. 1 means this piece finishes it. */
  missing: number;
}

export interface RankedWish {
  item: WishItem;
  /** 1 is the piece to buy next. */
  rank: number;
  score: number;
  parts: BuyPart[];
  /** Bought alone today. */
  today: CellGain[];
  /** Bought after every piece ranked above it. */
  inOrder: CellGain[];
  /** Saved looks the piece is in that still lack something. */
  looks: LookNote[];
  /** Up to three outfits it makes possible, the ones needing the fewest other new pieces first. */
  examples: Outfit[];
  /** List pieces it needs before it adds anything, when it adds nothing alone. */
  needsFirst: WishItem[];
  /** True when it opens a cell of the coverage grid that is empty today, or is a basic the wardrobe lacks. */
  fillsGap: boolean;
  /** True when it is a first coat or a first belt. */
  basic: boolean;
  reasons: Reason[];
  /** Lowest known price among its options. */
  fromPrice?: number;
}

export interface BuyRanking {
  ranked: RankedWish[];
  /** Pieces waiting for a date, or for another piece to prove itself. */
  held: { item: WishItem; reason: string }[];
  /** Pieces that break a hard rule. They never reach the score. */
  blocked: { item: WishItem; findings: RuleFinding[] }[];
  /** True when nothing on the list clears the bar. */
  nothingWorthBuying: boolean;
  /** Outfits the owner can make today, by cell. */
  before: CellGain[];
  months: MonthWeather[];
}

export function lowestPrice(item: WishItem): number | undefined {
  const prices = item.options.map((o) => o.check?.price ?? o.price).filter((p): p is number => typeof p === 'number' && p > 0);
  return prices.length > 0 ? Math.min(...prices) : undefined;
}

/** A second piece of a kind waits until the first has been worn this often. */
export const PROVEN_AFTER_WEARS = 3;

/**
 * Why a piece waits, or nothing when it does not. A piece can wait for a day
 * ("the white sneaker waits for March") or for another piece on the list to be
 * bought and worn ("a second shirt, after the white one proves itself").
 */
export function holdOf(item: WishItem, date: string, items: WishItem[], pieces: Piece[]): string | undefined {
  if (item.holdUntil !== undefined && item.holdUntil > date) return item.holdReason ?? `Waiting until ${item.holdUntil}.`;
  if (item.afterItemId) {
    const first = items.find((i) => i.id === item.afterItemId);
    if (first && first.state !== 'dropped') {
      const piece = first.pieceId ? pieces.find((p) => p.id === first.pieceId) : undefined;
      const proven = first.state === 'bought' && (!first.pieceId || !piece || piece.wearCount >= PROVEN_AFTER_WEARS);
      if (!proven) {
        const how = first.state === 'bought' ? `has been worn ${PROVEN_AFTER_WEARS} times` : 'is bought and worn';
        return item.holdReason ?? `Waiting until the ${first.name.charAt(0).toLowerCase()}${first.name.slice(1)} ${how}.`;
      }
    }
  }
  return undefined;
}

/* Counting */

interface ItemTally {
  /** Outfits by cell that need this piece and nothing else from the list. */
  alone: number[];
  /** Outfits by cell that need this piece and one other, keyed by the other piece. */
  pairs: Map<string, number[]>;
}

interface Tally {
  /** Outfits already possible, by cell. */
  before: number[];
  byItem: Map<string, ItemTally>;
}

function zeros(): number[] {
  return CELLS.map(() => 0);
}

function tally(outfits: PaperOutfit[], bought: Set<string>): Tally {
  const before = zeros();
  const byItem = new Map<string, ItemTally>();
  const rowOf = (id: string) => {
    let row = byItem.get(id);
    if (!row) byItem.set(id, (row = { alone: zeros(), pairs: new Map() }));
    return row;
  };
  for (const o of outfits) {
    const missing = o.needs.filter((id) => !bought.has(id));
    if (missing.length === 0) {
      o.cells.forEach((share, c) => (before[c]! += share));
    } else if (missing.length === 1) {
      const row = rowOf(missing[0]!);
      o.cells.forEach((share, c) => (row.alone[c]! += share));
    } else if (missing.length === 2) {
      const [a, b] = missing as [string, string];
      for (const [id, other] of [
        [a, b],
        [b, a],
      ] as const) {
        const row = rowOf(id);
        let cells = row.pairs.get(other);
        if (!cells) row.pairs.set(other, (cells = zeros()));
        o.cells.forEach((share, c) => (cells![c]! += share));
      }
    }
  }
  return { before, byItem };
}

function gains(before: number[], added: number[]): CellGain[] {
  return CELLS.map((cell, c) => ({ ...cell, before: Math.round(before[c]!), added: Math.round(added[c]!) }));
}

/**
 * How much each cell of the grid counts. An occasion counts by how often it
 * comes up in the owner's week: office days from the profile, every other day
 * as a casual day, and one evening out and one date a week as working values.
 * The four average out at 1. A wet cell counts a share of a dry one.
 */
export function cellWeights(officeDays: number): number[] {
  const office = Math.min(7, Math.max(0, officeDays));
  const days: Record<Occasion, number> = { office, casual: 7 - office, 'going-out': W.eveningsOut, date: W.dates };
  const soften = (n: number) => Math.pow(n, W.frequencyPower);
  const mean = OCCASION_ORDER.reduce((total, o) => total + soften(days[o]), 0) / OCCASION_ORDER.length;
  return CELLS.map((cell) => (soften(days[cell.occasion]) / mean) * (cell.wet ? W.wetDay : 1));
}

/**
 * The value of new outfits. Each cell counts by how much it grows, not by how
 * many it gains, so 8 outfits in an empty cell are worth more than 8 more in a
 * cell that has 20 (the natural log of the growth).
 */
function growth(weights: number[], before: number[], added: number[]): number {
  return CELLS.reduce((sum, _, c) => sum + weights[c]! * Math.log((1 + before[c]! + added[c]!) / (1 + before[c]!)), 0);
}

/* Saved looks */

const FORMULA_SLOT: Record<FormulaSlot, (w: Wardrobe) => Piece[]> = {
  'main-top': (w) => w.mainTops,
  'under-layer': (w) => w.underLayers,
  trousers: (w) => w.trousers,
  shoes: (w) => w.shoes,
  'outer-layer': (w) => w.thirdLayers,
};

/**
 * The saved looks a piece belongs to that the owner cannot make yet. A look
 * counts only when the rest of what it lacks is also on the list and not
 * waiting, so the list can finish it.
 */
function looksFor(piece: Piece, wardrobe: Wardrobe, formulas: Formula[], others: Piece[]): LookNote[] {
  const notes: LookNote[] = [];
  for (const formula of formulas) {
    if (formula.source !== 'your-looks') continue;
    let missing = 0;
    let fills = false;
    let reachable = true;
    for (const [slot, matcher] of Object.entries(formula.slots) as [FormulaSlot, Formula['slots'][FormulaSlot]][]) {
      if (!matcher) continue;
      if (FORMULA_SLOT[slot](wardrobe).some((p) => matchesPiece(p, matcher))) continue;
      missing += 1;
      if (piece.slots.includes(slot as Slot) && matchesPiece(piece, matcher)) fills = true;
      else if (!others.some((p) => p.slots.includes(slot as Slot) && matchesPiece(p, matcher))) reachable = false;
    }
    if (fills && reachable) notes.push({ formula, missing });
  }
  return notes.sort((a, b) => a.missing - b.missing);
}

/* A coat or belt the wardrobe lacks */

/** Belt and shoes match by convention. With shoes that are neither black nor brown any belt will do. */
function beltGoesWith(belt: Piece, shoes: Piece): boolean {
  const shoeColor = colorGroup(shoes);
  if (shoeColor !== 'black' && shoeColor !== 'brown') return true;
  return colorGroup(belt) === shoeColor;
}

interface BasicNote {
  kind: 'coat' | 'belt';
  /** Share of the outfits, or of the months ahead, it would be worn with. */
  share: number;
  /** Whole outfits it would be worn with, and how many there are. */
  with: number;
  of: number;
}

function basicNote(piece: Piece, wardrobe: Wardrobe, possible: PaperOutfit[], months: MonthWeather[]): BasicNote | undefined {
  if (isCoat(piece)) {
    if (wardrobe.coats.length > 0) return undefined;
    const cold = months.filter((m) => m.lowF < COAT_BELOW_F).length / months.length;
    if (cold === 0) return undefined;
    return { kind: 'coat', share: cold, with: possible.length, of: possible.length };
  }
  if (piece.slots[0] !== 'belt' || wardrobe.belts.length > 0 || possible.length === 0) return undefined;
  const count = possible.filter((o) => beltGoesWith(piece, o.outfit.shoes)).length;
  if (count === 0) return undefined;
  return { kind: 'belt', share: count / possible.length, with: count, of: possible.length };
}

/* The same job */

/**
 * The kind of garment, as far as "does the same job" goes. Jeans and tech
 * pants are both casual trousers but not the same thing. A crewneck, a zip
 * knit and a long-sleeve knit polo are all knits: the wardrobe report kept a
 * plum quarter-zip on the bench because a burgundy crewneck was already there.
 */
const KINDS: [string, RegExp][] = [
  ['jeans', /\b(jeans?|denim)\b/i],
  ['sneaker', /\b(sneakers?|trainers?)\b/i],
  ['boot', /\bboots?\b/i],
  ['loafer', /\b(loafers?|moccasins?)\b/i],
  ['coat', /\b(coat|peacoat|overcoat|parka|puffer)\b/i],
];

export function kindOf(piece: Pick<Piece, 'name' | 'tags' | 'slots' | 'neckline'>): string | undefined {
  const words = `${piece.name} ${piece.tags.join(' ')}`;
  const named = KINDS.find(([, pattern]) => pattern.test(words))?.[0];
  if (named) return named;
  const slot = piece.slots[0];
  if (slot !== 'main-top' && slot !== 'under-layer') return undefined;
  if (piece.neckline === 'shirt-collar') return 'shirt';
  if (piece.neckline === 'polo-collar') return isShortSleeve(piece as Piece) ? 'polo' : 'knit';
  return piece.slots.includes('under-layer') ? 'tee' : 'knit';
}

/** Owned pieces that fill the same slot, are the same kind of garment and the same color. */
function sameJob(piece: Piece, wardrobe: Wardrobe): Piece[] {
  const slot = piece.slots[0];
  const group = colorGroup(piece);
  if (!group || !slot) return [];
  const pool: Piece[] =
    slot === 'main-top' || slot === 'under-layer'
      ? [...new Set([...wardrobe.mainTops, ...wardrobe.underLayers])]
      : slot === 'trousers'
        ? wardrobe.trousers
        : slot === 'shoes'
          ? wardrobe.shoes
          : slot === 'belt'
            ? wardrobe.belts
            : slot === 'outer-layer'
              ? isCoat(piece)
                ? wardrobe.coats
                : wardrobe.thirdLayers
              : [];
  const kind = kindOf(piece);
  return pool.filter((p) => colorGroup(p) === group && kindOf(p) === kind);
}

/* Words */

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function money(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function occasionCounts(added: number[], wet: boolean): string {
  const parts: string[] = [];
  CELLS.forEach((cell, c) => {
    const n = Math.round(added[c]!);
    if (cell.wet === wet && n > 0) parts.push(`${n} ${forOccasion(cell.occasion)}`);
  });
  return parts.join(', ');
}

function sum(values: number[], wet?: boolean): number {
  return CELLS.reduce((total, cell, c) => (wet === undefined || cell.wet === wet ? total + values[c]! : total), 0);
}

function unlockText(before: number[], alone: number[], partner: WishItem | undefined, withPartner: number): string | undefined {
  const opened = CELLS.filter((_cell, c) => Math.round(before[c]!) === 0 && Math.round(alone[c]!) > 0);
  const dry = Math.round(sum(alone, false));
  const wet = Math.round(sum(alone, true));
  if (dry === 0 && wet === 0) {
    if (!partner || withPartner === 0) return undefined;
    return `Adds nothing on its own yet. With the ${lowerFirst(partner.name)} it makes ${plural(withPartner, 'outfit')}.`;
  }
  const openedDry = opened.filter((cell) => !cell.wet);
  const openedWet = opened.filter((cell) => cell.wet);
  if (openedDry.length > 0) {
    const where = openedDry.map((cell) => forOccasion(cell.occasion)).join(' and ');
    return `Gives you outfits ${where} for the first time. ${plural(dry, 'new outfit')} in all: ${occasionCounts(alone, false)}.`;
  }
  if (openedWet.length > 0 && wet > 0) {
    return `Gives you wet-day outfits for the first time: ${occasionCounts(alone, true)}.${dry > 0 ? ` On dry days it adds ${dry}.` : ''}`;
  }
  return `Adds ${plural(dry, 'outfit')}: ${occasionCounts(alone, false)}.`;
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function lookText(notes: LookNote[], unchecked: number): string | undefined {
  const finished = notes.filter((n) => n.missing === 1);
  const others = notes.length - finished.length + unchecked;
  const name = (n: LookNote) => {
    const credit = creditLine(n.formula);
    return `"${n.formula.name}"${credit ? ` (${credit})` : ''}`;
  };
  if (finished.length > 0) {
    const more = others > 0 ? ` It is in ${plural(others, 'more saved look')} too.` : '';
    return `Finishes your saved ${finished.length === 1 ? 'look' : 'looks'} ${finished.map(name).join(' and ')}.${more}`;
  }
  if (others === 0) return undefined;
  if (notes.length === 1 && unchecked === 0) return `In your saved look ${name(notes[0]!)}, which still lacks ${plural(notes[0]!.missing, 'piece')}.`;
  return `In ${plural(others, 'saved look')} that you cannot make yet.`;
}

/* The score of one piece, given what is already bought on paper */

interface Scored {
  item: WishItem;
  score: number;
  parts: BuyPart[];
  alone: number[];
  looks: LookNote[];
  basic: boolean;
  fillsGap: boolean;
  needsFirst: string[];
}

interface State {
  wardrobe: Wardrobe;
  tally: Tally;
  possible: PaperOutfit[];
  bought: Set<string>;
  weights: number[];
  /** The list pieces still to buy, as pieces. */
  others: Piece[];
}

function scoreItem(item: WishItem, state: State, input: BuyInput, months: MonthWeather[]): Scored {
  const piece = paperPiece(item);
  const parts: BuyPart[] = [];
  const before = state.tally.before;
  const weights = state.weights;
  const row = state.tally.byItem.get(item.id);
  const alone = row?.alone ?? zeros();

  // Outfits unlocked, thin cells counting more, looking two pieces ahead:
  // what it makes together with its best one or two partners on the list.
  const partners = [...(row?.pairs ?? new Map<string, number[]>()).entries()]
    .map(([id, cells]) => ({ id, cells, worth: growth(weights, before, cells) }))
    .sort((a, b) => b.worth - a.worth || a.id.localeCompare(b.id));
  const [best, second] = partners;
  const ahead = CELLS.map((_, c) => W.withBestPartner * (best?.cells[c] ?? 0) + W.withSecondPartner * (second?.cells[c] ?? 0));
  const aloneValue = growth(weights, before, alone);
  const fullValue = growth(
    weights,
    before,
    CELLS.map((_, c) => alone[c]! + ahead[c]!),
  );
  const nearFace = piece.slots.includes('main-top') || piece.slots.includes('under-layer');
  const rating = nearFace ? faceRating(piece.colorFamily, input.palette) : undefined;
  const face = rating ? faceFactor(rating) : 1;
  const needsFirst = sum(alone) < 0.5 ? partners.map((p) => p.id) : [];
  const bestItem = input.items.find((i) => i.id === best?.id);
  const withBest = Math.round(Math.max(sum(best?.cells ?? zeros(), false), sum(best?.cells ?? zeros(), true)));

  if (fullValue > 0) {
    parts.push({ id: 'unlocks', points: aloneValue, text: unlockText(before, alone, bestItem, withBest), evidence: 'working-rule' });
    const aheadValue = fullValue - aloneValue;
    if (aheadValue > 0.005) {
      parts.push({
        id: 'ahead',
        points: aheadValue,
        text: sum(alone) >= 0.5 && bestItem && withBest > 0 ? `With the ${lowerFirst(bestItem.name)} from this list it makes ${plural(withBest, 'more outfit')}.` : undefined,
        evidence: 'working-rule',
      });
    }
  }

  // Saved looks.
  const looks = looksFor(piece, state.wardrobe, input.formulas, state.others);
  const known = new Set(input.formulas.map((f) => f.id));
  const unchecked = (item.lookIds ?? []).filter((id) => !known.has(`saved-look:${id}`) && !known.has(id)).length;
  const lookPoints = W.savedLook * looks.reduce((total, n) => total + 1 / n.missing, 0) + W.savedLookUnchecked * unchecked;
  if (lookPoints > 0) parts.push({ id: 'saved-looks', points: lookPoints, text: lookText(looks, unchecked), evidence: 'your-choice' });

  // A coat or belt the wardrobe lacks.
  const basic = basicNote(piece, state.wardrobe, state.possible, months);
  if (basic) {
    const points = W.basic * basic.share;
    const all = basic.with === basic.of ? `all ${basic.of}` : `${basic.with} of the ${basic.of}`;
    const text =
      basic.kind === 'coat'
        ? `You own no coat, and ${coldMonths(months)} under ${COAT_BELOW_F}°F. It goes over ${all} outfits you can make now.`
        : `You own no belt. It goes with ${all} outfits you can make now.`;
    if (points > 0) parts.push({ id: 'basic', points, text, evidence: 'working-rule' });
  }

  let score = parts.reduce((total, p) => total + p.points, 0);

  // Near-face color: outfits in a color the palette is less sure of count for less.
  const unlockPoints = parts.filter((p) => p.id === 'unlocks' || p.id === 'ahead').reduce((total, p) => total + p.points, 0);
  if (rating && unlockPoints > 0) {
    const color = capitalize(colorWord(piece.colorFamily));
    const how = rating.tested ? 'your color test' : 'your palette';
    const words =
      rating.verdict === 'yes'
        ? rating.tested
          ? `${color} near your face: your color test rated it well.`
          : `${color} near your face: rated ${CONFIDENCE_LABELS[rating.confidence].toLowerCase()} in your palette.`
        : rating.verdict === 'over-light'
          ? `${color} near your face needs a light layer under it, by ${how}, so its outfits count for less.`
          : rating.verdict === 'no'
            ? `${color} near your face is a no in ${how}, so its outfits count for much less.`
            : `${color} near your face is not settled in ${how} yet, so its outfits count for less.`;
    const delta = unlockPoints * (face - 1);
    parts.push({ id: 'suits-you', points: delta, text: words, evidence: rating.tested ? 'your-test' : 'convention' });
    score += delta;
  }

  // A coat or belt the wardrobe lacks is a need, so it is not marked down for being beyond the saved looks.
  if (item.origin === 'beyond-looks' && !basic && score > 0) {
    const delta = score * (W.beyondLooks - 1);
    parts.push({
      id: 'beyond-looks',
      points: delta,
      text: 'From beyond your saved looks, so it counts a little less. You chose "mostly my looks".',
      evidence: 'your-choice',
    });
    score += delta;
  }

  const same = basic ? [] : sameJob(piece, state.wardrobe);
  if (same.length > 0 && score > 0) {
    const factor = same.reduce((f, p) => f * (levelOf(p) === levelOf(piece) ? W.covered : W.partlyCovered), 1);
    const delta = score * (factor - 1);
    const names = same.map((p) => `the ${lowerFirst(p.name)}`).join(' and ');
    const full = same.some((p) => levelOf(p) === levelOf(piece));
    const job = full ? `${same.length === 1 ? 'does' : 'do'} the same job` : `${same.length === 1 ? 'does' : 'do'} part of the same job, at another dress level`;
    parts.push({ id: 'covered', points: delta, text: `You already own ${names}, which ${job}.`, evidence: 'working-rule' });
    score += delta;
  }

  const price = lowestPrice(item);
  if (price !== undefined && score > 0) {
    const delta = (score * W.cheapLift) / (1 + price / W.cheapAt);
    parts.push({ id: 'price', points: delta, text: price <= W.cheapAt ? `From ${money(price)}, so it gets a small lift.` : undefined, evidence: 'working-rule' });
    score += delta;
  }

  const opens = CELLS.some((_, c) => Math.round(before[c]!) === 0 && Math.round(alone[c]!) > 0);
  return { item, score, parts, alone, looks, basic: basic !== undefined, fillsGap: opens || basic !== undefined, needsFirst };
}

function coldMonths(months: MonthWeather[]): string {
  const cold = months.filter((m) => m.lowF < COAT_BELOW_F).length;
  return cold === months.length ? `the next ${plural(months.length, 'month')} are` : `${cold} of the next ${months.length} months are`;
}

/* Reasons */

const MAX_REASONS = 4;

function reasonsFor(parts: BuyPart[]): Reason[] {
  const said = parts.filter((p) => p.text);
  const lead = said.filter((p) => p.points > 0 && (p.id === 'basic' || p.id === 'unlocks' || p.id === 'saved-looks' || p.id === 'ahead')).sort((a, b) => b.points - a.points);
  const rest = said.filter((p) => !lead.includes(p) && p.id !== 'price').sort((a, b) => a.points - b.points);
  const price = said.filter((p) => p.id === 'price');
  return [...lead, ...rest, ...price].slice(0, MAX_REASONS).map((p) => ({ text: p.text!, evidence: p.evidence }));
}

/* The whole list */

export function rankWishlist(input: BuyInput): BuyRanking {
  W = { ...BUY_WEIGHTS, ...input.weights };
  const months = monthsAhead(input.date, input.lat);
  const open = input.items.filter((i) => i.state === 'open');
  const blocked = open
    .map((item) => ({ item, findings: checkPiece(item.spec, input.rules).filter((f) => f.severity === 'breaks') }))
    .filter((b) => b.findings.length > 0);
  const allowed = open.filter((i) => !breaksHardRule(i.spec, input.rules));
  const held = allowed
    .map((item) => ({ item, reason: holdOf(item, input.date, input.items, input.pieces) }))
    .filter((h): h is { item: WishItem; reason: string } => h.reason !== undefined);
  const candidates = allowed.filter((i) => !held.some((h) => h.item === i));
  const outfits = paperOutfits(input.pieces, candidates, input.rules, months, MAX_NEEDS);

  const weights = cellWeights(input.officeDays ?? 0);

  const stateFor = (bought: Set<string>): State => {
    const paper = candidates.filter((i) => bought.has(i.id)).map(paperPiece);
    return {
      wardrobe: sortWardrobe([...input.pieces, ...paper], input.rules),
      tally: tally(outfits, bought),
      possible: outfits.filter((o) => o.needs.every((id) => bought.has(id))),
      bought,
      weights,
      others: candidates.filter((i) => !bought.has(i.id)).map(paperPiece),
    };
  };

  const start = stateFor(new Set());
  const todayOf = new Map(candidates.map((i) => [i.id, start.tally.byItem.get(i.id)?.alone ?? zeros()]));

  const ranked: RankedWish[] = [];
  const bought = new Set<string>();
  let remaining = [...candidates];
  while (remaining.length > 0) {
    const state = stateFor(bought);
    const scored = remaining
      .map((item) => scoreItem(item, state, input, months))
      // Highest score first. The name breaks ties, so the same list always ranks the same way.
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
    const best = scored[0]!;
    input.trace?.(
      ranked.length + 1,
      scored.map((s) => ({ id: s.item.id, score: s.score, parts: s.parts })),
    );
    // Outfits it makes with what is owned and what ranks above it. Failing that, with a piece ranked below.
    const mine = outfits.filter((o) => o.needs.includes(best.item.id));
    const now = mine.filter((o) => o.needs.every((id) => id === best.item.id || bought.has(id)));
    const examples = now.length > 0 ? now : mine;
    ranked.push({
      item: best.item,
      rank: ranked.length + 1,
      score: best.score,
      parts: best.parts,
      today: gains(start.tally.before, todayOf.get(best.item.id)!),
      inOrder: gains(state.tally.before, best.alone),
      looks: best.looks,
      examples: pickExamples(examples, best.item.id),
      needsFirst: best.needsFirst.map((id) => candidates.find((i) => i.id === id)).filter((i): i is WishItem => i !== undefined),
      fillsGap: best.fillsGap,
      basic: best.basic,
      reasons: reasonsFor(best.parts),
      fromPrice: lowestPrice(best.item),
    });
    bought.add(best.item.id);
    remaining = remaining.filter((i) => i.id !== best.item.id);
  }

  return {
    ranked,
    held,
    blocked,
    nothingWorthBuying: ranked.length > 0 && ranked[0]!.score < W.bar,
    before: gains(start.tally.before, zeros()),
    months,
  };
}

/** Up to three outfits, each with another top or other trousers, the ones needing the fewest new pieces first. */
function pickExamples(pool: PaperOutfit[], itemId: string): Outfit[] {
  const own = paperId(itemId);
  const sorted = [...pool].sort((a, b) => a.needs.length - b.needs.length);
  const chosen: Outfit[] = [];
  // The piece itself is in every example, so the examples differ in the other main pieces.
  const look = (o: Outfit) => [o.mainTop.id, o.trousers.id, o.shoes.id].filter((id) => id !== own).slice(0, 2).join('|');
  for (const { outfit } of sorted) {
    if (chosen.some((c) => look(c) === look(outfit))) continue;
    if (chosen.some((c) => c.mainTop.id === outfit.mainTop.id && c.trousers.id === outfit.trousers.id && c.mainTop.id !== own && c.trousers.id !== own)) continue;
    chosen.push(outfit);
    if (chosen.length === 3) break;
  }
  return chosen;
}

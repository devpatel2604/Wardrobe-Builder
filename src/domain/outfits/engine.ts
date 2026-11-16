import type { DressLevel, Formula, PaletteEntry, Piece, Rule, Slot } from '../types';
import { buildOutfits, sortWardrobe, type Wardrobe } from './build';
import { COAT_BELOW_F, styleFails, weatherFails } from './filters';
import { findFormula, isStretch } from './formulas';
import { forOccasion } from './occasions';
import type { OutfitLogEntry } from './records';
import { scoreOutfit } from './score';
import { allPieces, averageLevel, colorGroup, corePieces, outfitKey } from './traits';
import type { Candidate, DayWeather, Gap, Occasion, Outfit, OutfitPick, PickSource, Reason, Recommendation } from './types';

/**
 * Picks outfits by "filter, then score, then pick" (design brief, section 7.1).
 * Everything here is plain rules on the phone. No AI model picks an outfit or
 * writes a reason: each reason line is the text of a rule that fired.
 */
export interface EngineInput {
  pieces: Piece[];
  rules: Rule[];
  palette: PaletteEntry[];
  formulas: Formula[];
  occasion: Occasion;
  /** Left out when there is no forecast. The weather filters are then skipped. */
  weather?: DayWeather;
  /** YYYY-MM-DD, for rotation. */
  date: string;
  log: OutfitLogEntry[];
  /** Pieces the outfit must contain: "build around this piece", or a swap. */
  include?: string[];
  /** Pieces the outfit must not contain. */
  exclude?: string[];
  /** Outfits passed over for the day. */
  skipKeys?: string[];
  /** Main tops planned for other days of the week. */
  avoidTopIds?: string[];
}

const WEATHER_FILTERS = new Set(['wet', 'temperature']);

function withCoat(outfit: Outfit, wardrobe: Wardrobe, weather: DayWeather | undefined): Outfit {
  if (!weather || weather.lowF >= COAT_BELOW_F || wardrobe.coats.length === 0) return outfit;
  const coat = (weather.wet ? wardrobe.coats.find((c) => c.wetOk === true) : undefined) ?? wardrobe.coats[0];
  return { ...outfit, coat };
}

/** Steps 1 to 3: every combination, with the filters it fails and its score. */
export function evaluate(input: EngineInput): Candidate[] {
  const wardrobe = sortWardrobe(input.pieces, input.rules);
  return evaluateWardrobe(wardrobe, input);
}

function evaluateWardrobe(wardrobe: Wardrobe, input: EngineInput): Candidate[] {
  const include = input.include ?? [];
  const exclude = new Set(input.exclude ?? []);
  const candidates: Candidate[] = [];
  for (const built of buildOutfits(wardrobe)) {
    const ids = corePieces(built).map((p) => p.id);
    if (ids.some((id) => exclude.has(id)) || !include.every((id) => ids.includes(id))) continue;
    const outfit = withCoat(built, wardrobe, input.weather);
    const key = outfitKey(outfit);
    const formula = findFormula(outfit, input.formulas);
    const source: PickSource = formula?.source ?? 'your-rules';
    const fails = [...styleFails(outfit, input.occasion), ...weatherFails(outfit, input.weather)];
    const parts = scoreOutfit(outfit, key, formula, input);
    candidates.push({
      key,
      outfit,
      level: averageLevel(outfit),
      formula,
      source,
      stretch: isStretch(source),
      fails,
      parts,
      score: parts.reduce((sum, p) => sum + p.points, 0),
    });
  }
  // Highest score first. The key breaks ties, so the same wardrobe always gives the same pick.
  return candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/* Step 4: pick */

/** A real difference: another main top, or another color of trousers. A shoe or under-layer swap is not one. */
function differs(a: Candidate, b: Candidate, strict: boolean): boolean {
  const otherTop = a.outfit.mainTop.id !== b.outfit.mainTop.id;
  if (strict) return otherTop;
  const otherTrousers = a.outfit.trousers.id !== b.outfit.trousers.id && colorGroup(a.outfit.trousers) !== colorGroup(b.outfit.trousers);
  return otherTop || otherTrousers;
}

function nextDifferent(pool: Candidate[], chosen: Candidate[]): Candidate | undefined {
  const free = pool.filter((c) => !chosen.includes(c));
  return free.find((c) => chosen.every((other) => differs(c, other, true))) ?? free.find((c) => chosen.every((other) => differs(c, other, false)));
}

/* Step 5: explain */

const MAX_REASONS = 3;

function reasonsFor(candidate: Candidate, pool: Candidate[], removedByWeather: Candidate[]): Reason[] {
  const reasons: Reason[] = [];
  const said = candidate.parts.filter((p) => p.points > 0 && p.text).sort((a, b) => b.points - a.points);
  const formula = said.find((p) => p.id === 'formula');
  for (const part of [formula, ...said.filter((p) => p !== formula)]) {
    if (part?.text && reasons.length < MAX_REASONS) reasons.push({ text: part.text, evidence: part.evidence });
  }
  // Rotation decided when an outfit that sat out would otherwise have ranked above this one.
  const rested = pool.find((c) => {
    const rotation = c.parts.find((p) => p.id === 'rotation');
    return c !== candidate && rotation?.text !== undefined && c.score - rotation.points > candidate.score;
  });
  const rotation = rested?.parts.find((p) => p.id === 'rotation');
  if (rotation?.text) reasons.push({ text: rotation.text, evidence: rotation.evidence });
  // The weather decided when it removed an outfit that would otherwise have ranked above this one.
  const beaten = candidate.fails.length === 0 ? removedByWeather.find((c) => c.score > candidate.score) : undefined;
  const [first] = beaten?.fails ?? [];
  if (first) {
    const kind = first.filter === 'wet' ? 'the wet forecast' : 'the temperature';
    reasons.push({ text: `Higher-scoring outfits were left out for ${kind}.`, evidence: 'working-rule' });
  }
  return reasons;
}

function toPick(candidate: Candidate, pool: Candidate[], removedByWeather: Candidate[]): OutfitPick {
  return {
    candidate,
    reasons: reasonsFor(candidate, pool, removedByWeather),
    compromises: candidate.fails.map((f) => ({ text: f.text, evidence: f.evidence })),
  };
}

/* Gaps */

const SLOT_WORDS: Partial<Record<Slot, [string, string]>> = {
  shoes: ['shoe', 'shoes'],
  trousers: ['pair of trousers', 'trousers'],
  'main-top': ['top', 'tops'],
};
const LEVEL_WORDS: Record<DressLevel, string> = { 1: 'casual', 2: 'smart-casual', 3: 'dressy' };

function whatIfPiece(slot: Slot, level: DressLevel): Piece {
  return {
    id: `what-if-${slot}-${level}`,
    name: `A ${LEVEL_WORDS[level]} ${SLOT_WORDS[slot]?.[0] ?? 'piece'}`,
    status: 'owned',
    slots: [slot],
    dressLevel: level,
    wetOk: true,
    wearCount: 0,
    tags: [],
    detailsConfirmed: true,
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * Which kind of piece would open the most outfits: tries one imaginary piece
 * per slot and dress level and counts what passes. A plain count, the same
 * idea the buy-next list will use.
 */
export function bestAddition(input: EngineInput): Addition | undefined {
  const wardrobe = sortWardrobe(input.pieces, input.rules);
  let best: Addition | undefined;
  for (const slot of ['shoes', 'trousers', 'main-top'] as const) {
    for (const level of [1, 2, 3] as const) {
      const extra = whatIfPiece(slot, level);
      const grown: Wardrobe = {
        ...wardrobe,
        shoes: slot === 'shoes' ? [...wardrobe.shoes, extra] : wardrobe.shoes,
        trousers: slot === 'trousers' ? [...wardrobe.trousers, extra] : wardrobe.trousers,
        mainTops: slot === 'main-top' ? [...wardrobe.mainTops, extra] : wardrobe.mainTops,
      };
      const outfits = evaluateWardrobe(grown, { ...input, include: [extra.id], exclude: [], skipKeys: [] }).filter((c) => c.fails.length === 0).length;
      if (outfits > (best?.outfits ?? 0)) best = { slot, level, outfits };
    }
  }
  return best;
}

export interface Addition {
  slot: Slot;
  level: DressLevel;
  outfits: number;
}

/** "a casual shoe", "smart-casual trousers" */
export function additionWords(best: Addition): string {
  return best.slot === 'trousers' ? `${LEVEL_WORDS[best.level]} trousers` : `a ${LEVEL_WORDS[best.level]} ${SLOT_WORDS[best.slot]?.[0] ?? 'piece'}`;
}

function additionHint(input: EngineInput): string | undefined {
  const best = bestAddition(input);
  if (!best) return undefined;
  const wet = input.weather?.wet ? ' that can take rain' : '';
  return `Adding ${additionWords(best)}${wet} would make ${best.outfits} ${best.outfits === 1 ? 'outfit' : 'outfits'} possible.`;
}

function describeGap(input: EngineInput, candidates: Candidate[], wardrobe: Wardrobe): Gap {
  const occasion = forOccasion(input.occasion);
  const pinned = (input.include ?? []).map((id) => input.pieces.find((p) => p.id === id)?.name).filter(Boolean);
  if (pinned.length > 0) {
    return { text: `Nothing passes your rules with the ${pinned.join(' and the ')} ${occasion} on a day like this.` };
  }
  const missing = (
    [
      ['tops', wardrobe.mainTops],
      ['trousers', wardrobe.trousers],
      ['shoes', wardrobe.shoes],
    ] as const
  )
    .filter(([, list]) => list.length === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    return { text: `There are no ${missing.join(' or ')} in your wardrobe yet, so there is no outfit to build.` };
  }
  const hint = additionHint(input);
  const tooDressy = candidates.length > 0 && candidates.every((c) => c.fails.some((f) => f.text.startsWith('Too dressy') || f.filter === 'levels-apart'));
  const tooCasual = candidates.length > 0 && candidates.every((c) => c.fails.some((f) => f.text.startsWith('Too casual') || f.filter === 'levels-apart'));
  if (tooDressy) return { text: `Nothing you own works ${occasion}: every combination comes out too dressy, or mixes dress levels too far apart.`, hint };
  if (tooCasual) return { text: `Nothing you own works ${occasion}: every combination comes out too casual, or mixes dress levels too far apart.`, hint };
  return { text: `Nothing you own passes every rule ${occasion}.`, hint };
}

/* The whole method */

export function recommend(input: EngineInput): Recommendation {
  const wardrobe = sortWardrobe(input.pieces, input.rules);
  const all = evaluateWardrobe(wardrobe, input);
  const skip = new Set(input.skipKeys ?? []);
  const candidates = all.filter((c) => !skip.has(c.key));
  const passing = candidates.filter((c) => c.fails.length === 0);
  const onlyWeather = candidates.filter((c) => c.fails.length > 0 && c.fails.every((f) => WEATHER_FILTERS.has(f.filter)));
  const removedByWeather = onlyWeather;

  // When the weather rules out everything, show the outfits that give up the least, and say what they give up.
  const fewest = Math.min(...onlyWeather.map((c) => c.fails.length));
  const pool = passing.length > 0 ? passing : onlyWeather.filter((c) => c.fails.length === fewest);
  const headsUp: Reason[] = [];
  const weather = input.weather;

  if (pool.length === 0) {
    const skippedAll = all.some((c) => c.fails.length === 0);
    const gap: Gap = skippedAll
      ? { text: `You have passed on every outfit that works ${forOccasion(input.occasion)} today.` }
      : describeGap(input, candidates, wardrobe);
    return { occasion: input.occasion, alternates: [], headsUp, gap, hasStretch: false, passing: 0 };
  }

  const main = pool.find((c) => !c.stretch) ?? pool[0]!;
  const chosen = [main];
  const stretch = nextDifferent(
    pool.filter((c) => c.stretch),
    chosen,
  );
  const plain = nextDifferent(
    pool.filter((c) => !c.stretch),
    chosen,
  );
  if (plain) chosen.push(plain);
  if (stretch) chosen.push(stretch);
  // With no stretch to offer (or no second plain outfit), fill the gap with the next best.
  while (chosen.length < 3) {
    const next = nextDifferent(pool, chosen);
    if (!next) break;
    chosen.push(next);
  }
  const alternates = chosen.slice(1, 3);

  if (passing.length === 0 && weather) {
    const what = weather.wet ? 'a wet day' : `${Math.round(weather.lowF)}°F`;
    headsUp.push({
      text: `Nothing you own fully suits ${what} ${forOccasion(input.occasion)}. This is the closest.${hintSpace(additionHint(input))}`,
      evidence: 'working-rule',
    });
  }
  if (weather && weather.lowF < COAT_BELOW_F && wardrobe.coats.length === 0) {
    headsUp.push({ text: `${Math.round(weather.lowF)}°F and you own no coat.`, evidence: 'working-rule' });
  }
  if (wardrobe.belts.length === 0) headsUp.push({ text: 'You own no belt yet.' });

  return {
    occasion: input.occasion,
    main: toPick(main, pool, removedByWeather),
    alternates: alternates.map((c) => toPick(c, pool, removedByWeather)),
    headsUp,
    hasStretch: alternates.some((c) => c.stretch),
    passing: passing.length,
  };
}

function hintSpace(hint: string | undefined): string {
  return hint ? ` ${hint}` : '';
}

/** The ids of every piece in an outfit, coat and belt included. For the wear log. */
export function pieceIds(outfit: Outfit): string[] {
  return allPieces(outfit).map((p) => p.id);
}

import type { Piece } from '../types';
import { OCCASION_RULES, forOccasion } from './occasions';
import { averageLevel, capitalize, colorGroup, colorWord, isBareTee, isLayeringTop, isShortSleeve, isStrong, isSuede, levels, nearFace } from './traits';
import type { DayWeather, FilterFail, Occasion, Outfit } from './types';

/**
 * Step 2 of the method: reasons to remove an outfit. Each rule returns a full
 * sentence, so the screen can show exactly which rule decided.
 *
 * The temperature lines are working values from the design brief and the
 * wardrobe report. They are not sourced facts.
 */
export const COAT_BELOW_F = 50;
export const LIGHT_TOPS_FROM_F = 60;
export const WARM_PIECES_BELOW_F = 75;
export const MAX_COLORS = 3;

/** Distinct colors on show. Shoes and belt count only when they are a strong color. */
export function colorsOnShow(outfit: Outfit): { colors: Set<string>; strong: Set<string> } {
  const colors = new Set<string>();
  const strong = new Set<string>();
  const add = (piece: Piece | undefined, always: boolean) => {
    const group = colorGroup(piece);
    if (!group) return;
    if (isStrong(piece)) strong.add(group);
    if (always || isStrong(piece)) colors.add(group);
  };
  const shown = nearFace(outfit);
  add(outfit.mainTop, true);
  if (outfit.underLayer && shown.includes(outfit.underLayer)) add(outfit.underLayer, true);
  add(outfit.thirdLayer, true);
  add(outfit.trousers, true);
  add(outfit.shoes, false);
  add(outfit.belt, false);
  return { colors, strong };
}

function clash(outfit: Outfit): string | undefined {
  const bottoms = colorGroup(outfit.trousers);
  for (const top of [outfit.mainTop, outfit.thirdLayer]) {
    const group = colorGroup(top);
    if (group && group === bottoms && (group === 'navy' || group === 'brown')) {
      return `${capitalize(colorWord(top?.colorFamily))} on top with ${colorWord(outfit.trousers.colorFamily)} trousers.`;
    }
  }
  const lightTop = colorGroup(outfit.mainTop) === 'white';
  if (lightTop && bottoms === 'white') {
    if (isLayeringTop(outfit.mainTop) && !outfit.thirdLayer) return 'A white tee or shirt on its own with light trousers.';
    if (colorGroup(outfit.shoes) === 'black') return 'Black shoes under light trousers and a light top.';
  }
  return undefined;
}

/** Filters that do not depend on the weather: dress levels, the occasion, colors and clashes. */
export function styleFails(outfit: Outfit, occasion: Occasion): FilterFail[] {
  const fails: FilterFail[] = [];
  const rule = OCCASION_RULES[occasion];
  const parts = levels(outfit);
  if (Math.max(...parts) - Math.min(...parts) > 1) {
    fails.push({ filter: 'levels-apart', text: 'The pieces are more than one dress level apart.', evidence: 'working-rule' });
  }
  const level = averageLevel(outfit);
  // A hair of slack, so 2.3 as a rounded third still passes a 2.3 line.
  if (level < rule.min - 0.05) fails.push({ filter: 'occasion', text: `Too casual ${forOccasion(occasion)}.`, evidence: 'working-rule' });
  if (level > rule.max + 0.05) fails.push({ filter: 'occasion', text: `Too dressy ${forOccasion(occasion)}.`, evidence: 'working-rule' });
  if (rule.noBareTee && isBareTee(outfit)) {
    fails.push({ filter: 'bare-tee', text: `A tee on its own is not enough ${forOccasion(occasion)}.`, evidence: 'working-rule' });
  }
  const { colors, strong } = colorsOnShow(outfit);
  if (colors.size > MAX_COLORS) fails.push({ filter: 'colors', text: 'More than three colors.', evidence: 'convention' });
  if (strong.size > 1) fails.push({ filter: 'colors', text: 'More than one strong color.', evidence: 'convention' });
  const clashing = clash(outfit);
  if (clashing) fails.push({ filter: 'clash', text: clashing, evidence: 'working-rule' });
  return fails;
}

/** Filters from the forecast. The coat is not one of them: with no coat owned it becomes a heads-up. */
export function weatherFails(outfit: Outfit, weather: DayWeather | undefined): FilterFail[] {
  if (!weather) return [];
  const fails: FilterFail[] = [];
  const low = Math.round(weather.lowF);
  const high = Math.round(weather.highF);
  if (weather.wet) {
    if (isSuede(outfit.shoes)) {
      fails.push({ filter: 'wet', text: `${outfit.shoes.name}: suede stays home on a wet day.`, evidence: 'working-rule' });
    } else if (outfit.shoes.wetOk !== true) {
      fails.push({ filter: 'wet', text: `${outfit.shoes.name}: not marked as fine in rain or snow.`, evidence: 'working-rule' });
    }
    if (colorGroup(outfit.trousers) === 'white') {
      fails.push({ filter: 'wet', text: `${outfit.trousers.name}: light trousers stay home on a wet day.`, evidence: 'working-rule' });
    }
  }
  if (weather.lowF < LIGHT_TOPS_FROM_F) {
    if (isShortSleeve(outfit.mainTop) || outfit.mainTop.warmth === 'light') {
      fails.push({ filter: 'temperature', text: `${outfit.mainTop.name}: too light for ${low}°F.`, evidence: 'working-rule' });
    } else if (isBareTee(outfit)) {
      fails.push({ filter: 'temperature', text: `A tee needs a layer over it at ${low}°F.`, evidence: 'working-rule' });
    }
  }
  if (weather.highF >= WARM_PIECES_BELOW_F) {
    for (const piece of [outfit.mainTop, outfit.thirdLayer]) {
      if (piece?.warmth === 'warm') fails.push({ filter: 'temperature', text: `${piece.name}: too warm for ${high}°F.`, evidence: 'working-rule' });
    }
  }
  return fails;
}

import { breaksHardRule } from '../ruleChecks';
import type { Piece, Rule } from '../types';
import { colorGroup, hasCollar, isCoat, isLayeringTop, isRough, showsUnderLayer } from './traits';
import type { Outfit } from './types';

/** The owned pieces that pass the hard rules, sorted into the slots of an outfit. */
export interface Wardrobe {
  mainTops: Piece[];
  underLayers: Piece[];
  trousers: Piece[];
  shoes: Piece[];
  thirdLayers: Piece[];
  coats: Piece[];
  belts: Piece[];
  /** Owned pieces left out because they break a hard rule. */
  leftOut: Piece[];
}

export function sortWardrobe(pieces: Piece[], rules: Rule[]): Wardrobe {
  const owned = pieces.filter((p) => p.status === 'owned');
  const leftOut = owned.filter((p) => breaksHardRule(p, rules));
  const ok = owned.filter((p) => !leftOut.includes(p));
  const inSlot = (slot: Piece['slots'][number]) => ok.filter((p) => p.slots.includes(slot));
  const outer = inSlot('outer-layer');
  return {
    mainTops: inSlot('main-top'),
    underLayers: inSlot('under-layer'),
    trousers: inSlot('trousers'),
    shoes: inSlot('shoes'),
    thirdLayers: outer.filter((p) => !isCoat(p)),
    coats: outer.filter(isCoat),
    belts: inSlot('belt'),
    leftOut,
  };
}

/**
 * What can go under a main top.
 * - A tee, shirt or polo worn as the top takes nothing under it.
 * - A full zip is never worn bare, so it needs a layer.
 * - Other open necklines show the layer, so each one is a different outfit.
 * - Under a crewneck a tee does not show, so only a shirt collar counts.
 */
function underOptions(top: Piece, underLayers: Piece[]): (Piece | undefined)[] {
  if (isLayeringTop(top) || hasCollar(top)) return [undefined];
  const others = underLayers.filter((u) => u.id !== top.id);
  if (top.neckline === 'full-zip') return others;
  if (showsUnderLayer(top)) return [undefined, ...others];
  return [undefined, ...others.filter((u) => u.neckline === 'shirt-collar')];
}

/** An overshirt goes over a tee, shirt, polo or smooth knit. Not over a zip knit or a cable knit. */
function thirdOptions(top: Piece, thirdLayers: Piece[]): (Piece | undefined)[] {
  const zipKnit = top.neckline === 'full-zip' || top.neckline === 'quarter-zip';
  if (zipKnit || isRough(top)) return [undefined];
  return [undefined, ...thirdLayers];
}

/**
 * Belt and shoes match by convention, so a belt is added when one is in the
 * same color family as the shoes. With shoes that are neither black nor brown
 * any belt will do.
 */
function beltFor(shoes: Piece, belts: Piece[]): Piece | undefined {
  const shoeColor = colorGroup(shoes);
  const match = belts.find((b) => colorGroup(b) !== undefined && colorGroup(b) === shoeColor);
  if (match) return match;
  return shoeColor === 'black' || shoeColor === 'brown' ? undefined : belts[0];
}

/** Step 1 of the method: every combination of the slots. The coat is added later, from the weather. */
export function buildOutfits(wardrobe: Wardrobe): Outfit[] {
  const outfits: Outfit[] = [];
  for (const mainTop of wardrobe.mainTops) {
    for (const underLayer of underOptions(mainTop, wardrobe.underLayers)) {
      for (const thirdLayer of thirdOptions(mainTop, wardrobe.thirdLayers)) {
        for (const trousers of wardrobe.trousers) {
          for (const shoes of wardrobe.shoes) {
            outfits.push({ mainTop, underLayer, thirdLayer, trousers, shoes, belt: beltFor(shoes, wardrobe.belts) });
          }
        }
      }
    }
  }
  return outfits;
}

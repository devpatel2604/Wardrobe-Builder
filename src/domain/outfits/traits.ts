import { COLOR_FAMILIES } from '../options';
import type { ColorFamily, Depth, DressLevel, Piece } from '../types';
import type { Outfit } from './types';

/**
 * Facts the outfit rules read off a piece. Tags can be missing, since a piece
 * loaded from a setup file has only a name and a color, so each helper falls
 * back to a plain default and never guesses more than that.
 */

/** Families that count as one color in an outfit. */
const COLOR_GROUPS: Partial<Record<string, string>> = {
  white: 'white',
  cream: 'white',
  burgundy: 'burgundy',
  plum: 'burgundy',
  brown: 'brown',
  'dark-brown': 'brown',
};

/** A working rule: these read as a color, the rest read as neutrals. */
const STRONG = new Set<string>(['burgundy', 'plum', 'blue', 'aqua', 'green', 'mustard', 'lavender']);

const DEFAULT_DEPTH: Partial<Record<string, Depth>> = {
  white: 'light',
  cream: 'light',
  'light-blue': 'light',
  lavender: 'light',
  aqua: 'light',
  'light-grey': 'light',
  navy: 'dark',
  burgundy: 'dark',
  plum: 'dark',
  'dark-brown': 'dark',
  charcoal: 'dark',
  black: 'dark',
};

export function colorGroup(piece: Piece | undefined): string | undefined {
  const family = piece?.colorFamily;
  if (!family || family === 'other') return undefined;
  return COLOR_GROUPS[family] ?? family;
}

export function isStrong(piece: Piece | undefined): boolean {
  return piece?.colorFamily !== undefined && STRONG.has(piece.colorFamily);
}

export function depthOf(piece: Piece): Depth {
  return piece.depth ?? (piece.colorFamily ? DEFAULT_DEPTH[piece.colorFamily] : undefined) ?? 'mid';
}

export function colorWord(family: ColorFamily | undefined): string {
  if (!family) return 'this color';
  const label = COLOR_FAMILIES.find((c) => c.value === family)?.label ?? family;
  // "Tan or camel" reads badly mid-sentence.
  return (label.split(' or ')[0] ?? label).toLowerCase();
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Dress level 2 (smart casual) when the tag is missing. */
export function levelOf(piece: Piece): DressLevel {
  return piece.dressLevel ?? 2;
}

/** A tee or shirt that can also sit under a knit. */
export function isLayeringTop(piece: Piece): boolean {
  return piece.slots.includes('under-layer');
}

export function hasCollar(piece: Piece | undefined): boolean {
  return piece?.neckline === 'shirt-collar' || piece?.neckline === 'polo-collar';
}

/** Necklines that leave the layer underneath on show. */
export function showsUnderLayer(piece: Piece): boolean {
  return piece.neckline === 'full-zip' || piece.neckline === 'quarter-zip' || piece.neckline === 'v-neck' || piece.neckline === 'shawl-collar';
}

const COAT_NAME = /\b(coat|peacoat|overcoat|topcoat|parka|puffer)\b/i;

/** A coat goes over the whole outfit. Any other outer layer is a third layer, like an overshirt. */
export function isCoat(piece: Piece): boolean {
  if (!piece.slots.includes('outer-layer')) return false;
  return piece.warmth === 'warm' || piece.tags.includes('coat') || COAT_NAME.test(piece.name);
}

export function isSuede(piece: Piece): boolean {
  return /\b(suede|nubuck)\b/i.test(piece.cloth ?? '') || piece.tags.includes('suede');
}

export function isRough(piece: Piece | undefined): boolean {
  return piece !== undefined && (piece.texture === 'rough' || isSuede(piece));
}

export function isShortSleeve(piece: Piece): boolean {
  return piece.tags.includes('short sleeve') || piece.tags.includes('short-sleeve');
}

export function isPleatedOrWide(piece: Piece): boolean {
  return piece.fit === 'relaxed' || piece.tags.some((t) => t === 'pleated' || t === 'pleats' || t === 'wide' || t === 'wide-leg' || t === 'wide leg');
}

/**
 * The dress level of the top half. A shirt collar under a knit lifts it one
 * level, and a third layer counts when it is the dressier of the two
 * (wardrobe report, counting rules).
 */
export function topLookLevel(outfit: Pick<Outfit, 'mainTop' | 'underLayer' | 'thirdLayer'>): number {
  let level: number = levelOf(outfit.mainTop);
  if (outfit.underLayer?.neckline === 'shirt-collar' && !isLayeringTop(outfit.mainTop)) level = Math.min(3, level + 1);
  if (outfit.thirdLayer) level = Math.max(level, levelOf(outfit.thirdLayer));
  return level;
}

export function levels(outfit: Outfit): [number, number, number] {
  return [topLookLevel(outfit), levelOf(outfit.trousers), levelOf(outfit.shoes)];
}

export function averageLevel(outfit: Outfit): number {
  const [a, b, c] = levels(outfit);
  return (a + b + c) / 3;
}

/** A tee worn as the only top, with nothing over it. */
export function isBareTee(outfit: Outfit): boolean {
  return isLayeringTop(outfit.mainTop) && !hasCollar(outfit.mainTop) && !outfit.thirdLayer;
}

/** The pieces whose color shows next to the face, most visible first. */
export function nearFace(outfit: Outfit): Piece[] {
  const shown = [outfit.mainTop];
  if (outfit.underLayer && (showsUnderLayer(outfit.mainTop) || hasCollar(outfit.underLayer))) shown.push(outfit.underLayer);
  return shown;
}

/** The pieces that make up the look: everything but the coat and the belt. */
export function corePieces(outfit: Outfit): Piece[] {
  return [outfit.mainTop, outfit.underLayer, outfit.thirdLayer, outfit.trousers, outfit.shoes].filter((p): p is Piece => p !== undefined);
}

export function allPieces(outfit: Outfit): Piece[] {
  return [...corePieces(outfit), outfit.coat, outfit.belt].filter((p): p is Piece => p !== undefined);
}

export function outfitKey(outfit: Outfit): string {
  return [outfit.mainTop.id, outfit.underLayer?.id ?? '', outfit.trousers.id, outfit.shoes.id, outfit.thirdLayer?.id ?? ''].join('|');
}

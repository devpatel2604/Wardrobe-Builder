import { buildOutfits, sortWardrobe } from '../outfits/build';
import { styleFails, weatherFails } from '../outfits/filters';
import { OCCASION_RULES } from '../outfits/occasions';
import { corePieces, isCoat } from '../outfits/traits';
import type { DayWeather, Occasion, Outfit } from '../outfits/types';
import type { Piece, Rule } from '../types';
import type { MonthWeather } from './season';
import type { WishItem } from './types';

/**
 * Puts the pieces of the buy-next list in the wardrobe on paper and builds
 * every outfit that passes the rules, noting which list pieces each one needs.
 * One pass answers "what does this piece add", "what does it add together
 * with the next pieces" and "what would be there once these are bought".
 */
const PAPER = 'wish:';

export function paperId(itemId: string): string {
  return `${PAPER}${itemId}`;
}

/** The list piece as it would sit in the wardrobe. */
export function paperPiece(item: WishItem): Piece {
  return {
    ...item.spec,
    id: paperId(item.id),
    name: item.name,
    status: 'owned',
    wearCount: 0,
    detailsConfirmed: true,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export const OCCASION_ORDER = Object.keys(OCCASION_RULES) as Occasion[];

/** One cell of the coverage grid: an occasion in dry or wet weather. */
export interface Cell {
  occasion: Occasion;
  wet: boolean;
}

/** Dry then wet for each occasion, in the order of the coverage grid. */
export const CELLS: Cell[] = OCCASION_ORDER.flatMap((occasion) => [
  { occasion, wet: false },
  { occasion, wet: true },
]);

export interface PaperOutfit {
  outfit: Outfit;
  /** Ids of the list pieces in it. Empty for an outfit the owner can make today. */
  needs: string[];
  /** For each cell, the share of the months ahead in which the outfit passes. 0 to 1. */
  cells: number[];
}

/** A belt, or a coat that goes over the whole outfit. Neither changes the outfit count. */
export function isOnTop(piece: Piece): boolean {
  return piece.slots[0] === 'belt' || isCoat(piece);
}

function weatherOf(month: MonthWeather, wet: boolean): DayWeather {
  return { lowF: month.lowF, highF: month.highF, wet, snow: false, source: 'manual', summary: '' };
}

export function paperOutfits(owned: Piece[], items: WishItem[], rules: Rule[], months: MonthWeather[], maxNeeds: number): PaperOutfit[] {
  const paper = items.map(paperPiece).filter((p) => !isOnTop(p));
  const wardrobe = sortWardrobe([...owned, ...paper], rules);
  const result: PaperOutfit[] = [];
  for (const outfit of buildOutfits(wardrobe)) {
    const needs = corePieces(outfit)
      .filter((p) => p.id.startsWith(PAPER))
      .map((p) => p.id.slice(PAPER.length));
    if (needs.length > maxNeeds) continue;
    const dryShare = months.filter((m) => weatherFails(outfit, weatherOf(m, false)).length === 0).length / months.length;
    const wetShare = months.filter((m) => weatherFails(outfit, weatherOf(m, true)).length === 0).length / months.length;
    if (dryShare === 0 && wetShare === 0) continue;
    const cells = CELLS.map(() => 0);
    let any = false;
    OCCASION_ORDER.forEach((occasion, index) => {
      if (styleFails(outfit, occasion).length > 0) return;
      cells[index * 2] = dryShare;
      cells[index * 2 + 1] = wetShare;
      any = true;
    });
    if (any) result.push({ outfit, needs, cells });
  }
  return result;
}

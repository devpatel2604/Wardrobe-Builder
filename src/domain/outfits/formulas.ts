import type { Formula, FormulaSlot, LookSource, Piece, PieceMatcher } from '../types';
import { depthOf } from './traits';
import type { Outfit, PickSource } from './types';

export function matchesPiece(piece: Piece, m: PieceMatcher): boolean {
  if (m.colorFamilies && !(piece.colorFamily && m.colorFamilies.includes(piece.colorFamily))) return false;
  if (m.depths && !m.depths.includes(depthOf(piece))) return false;
  if (m.necklines && !(piece.neckline && m.necklines.includes(piece.neckline))) return false;
  if (m.texture && piece.texture !== m.texture) return false;
  if (m.tags && !m.tags.every((t) => piece.tags.includes(t))) return false;
  return true;
}

function pieceIn(outfit: Outfit, slot: FormulaSlot): Piece | undefined {
  switch (slot) {
    case 'main-top':
      return outfit.mainTop;
    case 'under-layer':
      return outfit.underLayer;
    case 'trousers':
      return outfit.trousers;
    case 'shoes':
      return outfit.shoes;
    case 'outer-layer':
      return outfit.thirdLayer;
  }
}

export function matchesFormula(outfit: Outfit, formula: Formula): boolean {
  const slots = Object.entries(formula.slots) as [FormulaSlot, PieceMatcher | null][];
  // A formula that names no slot would match everything.
  if (slots.length === 0) return false;
  return slots.every(([slot, matcher]) => {
    const piece = pieceIn(outfit, slot);
    if (matcher === null) return piece === undefined;
    return piece !== undefined && matchesPiece(piece, matcher);
  });
}

const SOURCE_ORDER: LookSource[] = ['your-looks', 'suits-you', 'similar-creators', 'in-season', 'test'];

/** The formula an outfit matches. A saved look wins over the other sources. */
export function findFormula(outfit: Outfit, formulas: Formula[]): Formula | undefined {
  const matches = formulas.filter((f) => matchesFormula(outfit, f));
  return matches.sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source))[0];
}

/** Where the credit is due, in the owner's own wording rule: a post seen and linked, or "in the style of". */
export function creditLine(formula: Formula): string | undefined {
  if (!formula.credit) return undefined;
  return formula.postSeen && formula.link ? `${formula.credit}, post seen and linked` : `in the style of ${formula.credit}`;
}

export const SOURCE_LABELS: Record<PickSource, string> = {
  'your-looks': 'From your looks',
  'your-rules': 'Built from your rules',
  'suits-you': 'Stretch · suits you',
  'in-season': 'Stretch · in season',
  'similar-creators': 'Stretch · similar creators',
  test: 'Stretch · a test',
};

/** Only a look from beyond the saved looks and the proven rules is a stretch. */
export function isStretch(source: PickSource): boolean {
  return source !== 'your-looks' && source !== 'your-rules';
}

import type { Slot } from '../types';

/**
 * The fit check for a piece that was just bought (design brief, section 6.2).
 * Seven checks, a minute in front of the mirror, then keep, tailor or return.
 * The targets come from the coloring and body report. A piece that fails goes
 * back before it becomes one of the unworn ones.
 */
export type FitCheckId = 'shoulders' | 'top-length' | 'body' | 'trouser-rise' | 'trouser-length' | 'hardware' | 'cloth';

export type FitAnswer =
  | 'pass'
  | 'fixable' // off, but a tailor can fix it
  | 'fail';

export type FitVerdict = 'keep' | 'tailor' | 'return';

export interface FitCheckItem {
  id: FitCheckId;
  label: string;
  /** What a pass looks like. */
  pass: string;
  /** True when a tailor can put it right, so "a tailor can fix it" is offered. */
  tailorable: boolean;
  /** Said when the check fails. */
  failNote: string;
}

const TOP: FitCheckItem[] = [
  {
    id: 'shoulders',
    label: 'Shoulders',
    pass: 'The seam sits on the shoulder bone.',
    tailorable: false,
    failNote: 'Shoulders are the one thing a tailor cannot sensibly move.',
  },
  {
    id: 'top-length',
    label: 'Length',
    pass: 'The hem ends between the bottom of your belt and the middle of the fly.',
    tailorable: true,
    failNote: 'Too long reads boxy on you. Too short rides up.',
  },
  {
    id: 'body',
    label: 'Body',
    pass: 'It skims the chest, with no cloth billowing at the sides.',
    tailorable: true,
    failNote: 'Extra cloth at the sides is what makes a top look boxy.',
  },
];

const COAT_LENGTH: FitCheckItem = {
  id: 'top-length',
  label: 'Length',
  pass: 'The hem ends at mid-thigh or above.',
  tailorable: false,
  failNote: 'A coat past mid-thigh is long on you, and shortening a coat rarely works.',
};

const TROUSERS: FitCheckItem[] = [
  {
    id: 'trouser-rise',
    label: 'Rise',
    pass: 'The waistband sits between your hip bone and your navel.',
    tailorable: false,
    failNote: 'The rise cannot be altered.',
  },
  {
    id: 'trouser-length',
    label: 'Length',
    pass: 'One soft fold at the shoe, no more.',
    tailorable: true,
    failNote: 'Too long is an easy hem. Too short cannot be let down far.',
  },
];

const HARDWARE: FitCheckItem = {
  id: 'hardware',
  label: 'Hardware',
  pass: 'Buckles, zips and buttons are silver or dark, not brass or gold.',
  tailorable: false,
  failNote: 'Your rule is silver over gold.',
};

const CLOTH: FitCheckItem = {
  id: 'cloth',
  label: 'Cloth',
  pass: "The care label matches what the store's page said.",
  tailorable: false,
  failNote: 'If the label says something else, the piece is not the one you chose.',
};

/** The checks that apply to a piece, by where it goes in an outfit. */
export function fitChecksFor(slots: Slot[], isCoat = false): FitCheckItem[] {
  const slot = slots[0];
  if (slot === 'main-top' || slot === 'under-layer') return [...TOP, HARDWARE, CLOTH];
  if (slot === 'outer-layer') return [TOP[0]!, isCoat ? COAT_LENGTH : TOP[1]!, TOP[2]!, HARDWARE, CLOTH];
  if (slot === 'trousers') return [...TROUSERS, HARDWARE, CLOTH];
  return [HARDWARE, CLOTH];
}

export interface FitCheck {
  /** YYYY-MM-DD */
  on: string;
  answers: Partial<Record<FitCheckId, FitAnswer>>;
  verdict: FitVerdict;
  note?: string;
}

/** What the answers point to. The owner can still choose otherwise. */
export function suggestVerdict(answers: Partial<Record<FitCheckId, FitAnswer>>): FitVerdict {
  const all = Object.values(answers);
  if (all.includes('fail')) return 'return';
  if (all.includes('fixable')) return 'tailor';
  return 'keep';
}

export const VERDICT_LABELS: Record<FitVerdict, string> = {
  keep: 'Keep',
  tailor: 'Keep and tailor',
  return: 'Return',
};

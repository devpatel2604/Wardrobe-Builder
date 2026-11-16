import type {
  ColorFamily,
  Confidence,
  Depth,
  DressLevel,
  Evidence,
  Fit,
  Hardware,
  Hem,
  Neckline,
  PieceStatus,
  RuleKind,
  Slot,
  Texture,
  Warmth,
} from './types';

export interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

export const SLOTS: Option<Slot>[] = [
  { value: 'main-top', label: 'Main top', hint: 'Knit, polo or shirt worn as the top you see' },
  { value: 'under-layer', label: 'Under-layer', hint: 'Tee or shirt worn under a knit' },
  { value: 'trousers', label: 'Trousers' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'outer-layer', label: 'Third layer or coat', hint: 'Overshirt, jacket or coat' },
  { value: 'belt', label: 'Belt' },
  { value: 'glasses', label: 'Glasses' },
  { value: 'watch', label: 'Watch' },
  { value: 'fragrance', label: 'Fragrance' },
  { value: 'accessory', label: 'Other accessory' },
];

/** Slots that count as clothing for the "no leather clothing" rule. */
export const CLOTHING_SLOTS: Slot[] = ['main-top', 'under-layer', 'trousers', 'outer-layer'];
/** Slots where a neckline, fit and hem make sense. */
export const TOP_SLOTS: Slot[] = ['main-top', 'under-layer', 'outer-layer'];

export const COLOR_FAMILIES: (Option<ColorFamily> & { swatch: string })[] = [
  { value: 'white', label: 'White', swatch: '#fbfaf7' },
  { value: 'cream', label: 'Cream', swatch: '#efe6d2' },
  { value: 'light-blue', label: 'Light blue', swatch: '#bcd3ea' },
  { value: 'lavender', label: 'Lavender', swatch: '#d6cfea' },
  { value: 'aqua', label: 'Aqua', swatch: '#a9dcd6' },
  { value: 'blue', label: 'Blue', swatch: '#3f66a8' },
  { value: 'navy', label: 'Navy', swatch: '#1c2a4a' },
  { value: 'burgundy', label: 'Burgundy', swatch: '#6d1f2c' },
  { value: 'plum', label: 'Plum', swatch: '#4f2542' },
  { value: 'olive', label: 'Olive', swatch: '#59603a' },
  { value: 'green', label: 'Green', swatch: '#2f5d46' },
  { value: 'tan', label: 'Tan or camel', swatch: '#c1a077' },
  { value: 'brown', label: 'Brown', swatch: '#7a5238' },
  { value: 'dark-brown', label: 'Dark brown', swatch: '#3f2a20' },
  { value: 'light-grey', label: 'Light grey', swatch: '#c9cbcf' },
  { value: 'grey', label: 'Mid grey', swatch: '#8b8e94' },
  { value: 'charcoal', label: 'Charcoal', swatch: '#3b3e45' },
  { value: 'black', label: 'Black', swatch: '#17181b' },
  { value: 'mustard', label: 'Mustard', swatch: '#c79a2e' },
  { value: 'other', label: 'Other', swatch: '#b9b2a6' },
];

export const DEPTHS: Option<Depth>[] = [
  { value: 'light', label: 'Light' },
  { value: 'mid', label: 'Mid' },
  { value: 'dark', label: 'Dark' },
];

export const TEXTURES: Option<Texture>[] = [
  { value: 'smooth', label: 'Smooth', hint: 'Fine knit, poplin, plain twill, polished leather' },
  { value: 'rough', label: 'Rough', hint: 'Cable knit, suede, corduroy, heavy twill' },
];

export const NECKLINES: Option<Neckline>[] = [
  { value: 'crew', label: 'Crewneck' },
  { value: 'v-neck', label: 'V-neck' },
  { value: 'polo-collar', label: 'Polo collar' },
  { value: 'shirt-collar', label: 'Shirt collar' },
  { value: 'quarter-zip', label: 'Quarter-zip' },
  { value: 'full-zip', label: 'Full zip' },
  { value: 'stand-collar', label: 'Stand collar' },
  { value: 'shawl-collar', label: 'Shawl collar' },
];

export const FITS: Option<Fit>[] = [
  { value: 'close', label: 'Close' },
  { value: 'regular', label: 'Regular' },
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'boxy', label: 'Boxy' },
];

export const HEMS: Option<Hem>[] = [
  { value: 'at-belt', label: 'At the belt' },
  { value: 'mid-fly', label: 'Mid-fly' },
  { value: 'below-fly', label: 'Below the fly' },
  { value: 'mid-thigh', label: 'Mid-thigh' },
  { value: 'longer', label: 'Longer' },
];

export const DRESS_LEVELS: Option<DressLevel>[] = [
  { value: 1, label: '1 · Casual' },
  { value: 2, label: '2 · Smart casual' },
  { value: 3, label: '3 · Dressy' },
];

export const HARDWARE: Option<Hardware>[] = [
  { value: 'none', label: 'None' },
  { value: 'silver', label: 'Silver or steel' },
  { value: 'dark', label: 'Dark or gunmetal' },
  { value: 'small-brass-buttons', label: 'Small brass buttons' },
  { value: 'gold-or-brass', label: 'Gold or brass' },
];

export const WARMTHS: Option<Warmth>[] = [
  { value: 'light', label: 'Light' },
  { value: 'medium', label: 'Medium' },
  { value: 'warm', label: 'Warm' },
];

export const STATUSES: Option<PieceStatus>[] = [
  { value: 'owned', label: 'I own it' },
  { value: 'considering', label: 'Thinking about it' },
];

export const RULE_KINDS: Option<RuleKind>[] = [
  { value: 'hard', label: 'Hard rules', hint: 'These remove an option outright. Only you change them.' },
  { value: 'default', label: 'Defaults', hint: 'Applied unless you say otherwise.' },
  { value: 'soft', label: 'Soft preferences', hint: 'These nudge a choice up or down.' },
  { value: 'open-test', label: 'Open tests', hint: 'Waiting on the color photo test, which you can take from the Colors card below.' },
];

export const EVIDENCE_LABELS: Record<Evidence, string> = {
  'your-rule': 'Your rule',
  'your-choice': 'Your choice',
  research: 'Research',
  convention: 'Convention',
  'working-rule': 'Working rule',
  'your-test': 'Your test',
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'High',
  'medium-high': 'Medium to high',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Untested',
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function labelOf<T>(options: Option<T>[], value: T | undefined): string | undefined {
  if (value === undefined) return undefined;
  return options.find((o) => o.value === value)?.label;
}

export function swatchOf(family: ColorFamily | undefined): string | undefined {
  if (!family) return undefined;
  return COLOR_FAMILIES.find((c) => c.value === family)?.swatch;
}

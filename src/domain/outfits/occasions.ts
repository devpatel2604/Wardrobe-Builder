import type { Option } from '../options';
import type { Occasion } from './types';

/**
 * The dress-level range of each occasion, as the average of the top look,
 * trousers and shoes. These are the wardrobe report's working rules, not
 * sourced facts, so every reason built on them carries the "working rule" label.
 */
export interface OccasionRule {
  id: Occasion;
  label: string;
  min: number;
  max: number;
  /** A tee as the only top is not enough. */
  noBareTee: boolean;
  /** The hours out of the house, for the forecast. Office hours come from the profile. */
  hours: [number, number];
}

export const OCCASION_RULES: Record<Occasion, OccasionRule> = {
  office: { id: 'office', label: 'Office', min: 1.6, max: 2.7, noBareTee: false, hours: [8, 17] },
  casual: { id: 'casual', label: 'Casual', min: 1, max: 1.7, noBareTee: false, hours: [10, 18] },
  'going-out': { id: 'going-out', label: 'Going out', min: 1.6, max: 2.7, noBareTee: true, hours: [18, 23] },
  date: { id: 'date', label: 'Date', min: 2.3, max: 3, noBareTee: true, hours: [18, 23] },
};

export const OCCASIONS: Option<Occasion>[] = (Object.values(OCCASION_RULES) as OccasionRule[]).map((o) => ({ value: o.id, label: o.label }));

export function occasionLabel(occasion: Occasion): string {
  return OCCASION_RULES[occasion].label;
}

/** "for the office", "for a date": the occasion inside a sentence. */
export function forOccasion(occasion: Occasion): string {
  switch (occasion) {
    case 'office':
      return 'for the office';
    case 'casual':
      return 'for a casual day';
    case 'going-out':
      return 'for going out';
    case 'date':
      return 'for a date';
  }
}

/**
 * Reads office hours out of the profile's free text, such as "About 7 am to
 * 4 pm". Falls back to the default when the text has no two times in it.
 */
export function officeHours(text: string | undefined): [number, number] {
  const fallback = OCCASION_RULES.office.hours;
  if (!text) return fallback;
  const found = [...text.matchAll(/(\d{1,2})(?::\d{2})?\s*(am|pm)/gi)].map((m) => {
    const hour = Number(m[1]) % 12;
    return m[2]?.toLowerCase() === 'pm' ? hour + 12 : hour;
  });
  const [start, end] = found;
  if (start === undefined || end === undefined || end <= start) return fallback;
  return [start, end];
}

/** The occasions of a day when the owner has not set them: the office on office days. */
export function defaultOccasions(weekday: number, officeDays: number[]): Occasion[] {
  return officeDays.includes(weekday) ? ['office'] : [];
}

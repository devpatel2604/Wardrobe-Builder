import { fromKey } from '../dates';

/**
 * A piece bought today is worn over the months that follow, so the buy-next
 * list counts outfits for the three months ahead, not for this week's forecast.
 *
 * These are typical daily lows and highs by month, in °F, for a temperate
 * northern climate with cold winters. They are round working values, not a
 * forecast and not a sourced climate record. South of the equator the year is
 * shifted by six months.
 */
export interface MonthWeather {
  /** 0 is January. */
  month: number;
  lowF: number;
  highF: number;
}

const TYPICAL: [number, number][] = [
  [25, 40], // January
  [27, 43],
  [34, 51],
  [44, 63],
  [54, 73],
  [63, 82],
  [69, 87],
  [67, 85],
  [60, 78],
  [48, 66],
  [39, 55],
  [30, 45], // December
];

export const MONTHS_AHEAD = 3;

export function monthsAhead(date: string, lat?: number, count: number = MONTHS_AHEAD): MonthWeather[] {
  const start = fromKey(date).getMonth();
  const shift = lat !== undefined && lat < 0 ? 6 : 0;
  return Array.from({ length: count }, (_, i) => {
    const month = (start + i) % 12;
    const [lowF, highF] = TYPICAL[(month + shift) % 12]!;
    return { month, lowF, highF };
  });
}

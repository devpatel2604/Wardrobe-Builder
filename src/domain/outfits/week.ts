import { recommend, type EngineInput } from './engine';
import type { OutfitLogEntry } from './records';
import type { DayWeather, Occasion, Recommendation } from './types';

/**
 * Lays out the days ahead: one pick for each occasion of each day, without
 * repeating a main top where the wardrobe allows it (design brief, section 7.2).
 */
export interface PlannedDay {
  date: string;
  occasions: Occasion[];
  /** The weather for each occasion's own hours. Missing when there is no forecast for it. */
  weather: Partial<Record<Occasion, DayWeather>>;
}

export interface PlannedOutfit {
  date: string;
  occasion: Occasion;
  weather?: DayWeather;
  /** Missing when the outfit for that day and occasion is already logged as worn. */
  recommendation?: Recommendation;
  /** What was worn, once it is logged. */
  worn?: OutfitLogEntry;
  /** True when the main top is also planned for another day, because nothing else passes. */
  repeatsTop: boolean;
}

export type WeekInput = Omit<EngineInput, 'occasion' | 'weather' | 'date' | 'include' | 'exclude' | 'skipKeys' | 'avoidTopIds'>;

export function planWeek(days: PlannedDay[], input: WeekInput): PlannedOutfit[] {
  const planned: PlannedOutfit[] = [];
  const usedTops: string[] = [];
  for (const day of days) {
    for (const occasion of day.occasions) {
      const weather = day.weather[occasion];
      const worn = input.log.find((e) => e.action === 'wore' && e.date === day.date && e.occasion === occasion);
      if (worn) {
        planned.push({ date: day.date, occasion, weather, worn, repeatsTop: false });
        usedTops.push(worn.pieces.mainTop);
        continue;
      }
      const skipKeys = input.log.filter((e) => e.action === 'not-today' && e.date === day.date && e.occasion === occasion).map((e) => e.outfitKey);
      const recommendation = recommend({ ...input, occasion, weather, date: day.date, avoidTopIds: usedTops, skipKeys });
      const top = recommendation.main?.candidate.outfit.mainTop.id;
      planned.push({ date: day.date, occasion, weather, recommendation, repeatsTop: top !== undefined && usedTops.includes(top) });
      if (top) usedTops.push(top);
    }
  }
  return planned;
}

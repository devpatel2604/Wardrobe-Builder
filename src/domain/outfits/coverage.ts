import { additionWords, bestAddition, evaluate, type EngineInput } from './engine';
import { OCCASION_RULES } from './occasions';
import type { DayWeather, Occasion } from './types';

/**
 * The coverage grid: how many outfits pass every filter for each occasion, on
 * a dry day and on a wet one. An empty cell is a gap worth knowing about days
 * before it matters (design brief, sections 5 and 7.2).
 */
export interface CoverageRow {
  occasion: Occasion;
  dry: number;
  wet: number;
  /** What kind of piece would fill the emptier cell, when one kind would. */
  hint?: string;
}

export type CoverageInput = Omit<EngineInput, 'occasion' | 'weather' | 'include' | 'exclude' | 'skipKeys' | 'avoidTopIds'>;

/** A temperature at which no temperature rule applies, for when there is no forecast. */
export const NEUTRAL_F = 65;

function weatherAt(tempF: number, wet: boolean): DayWeather {
  return { lowF: tempF, highF: tempF, wet, snow: false, source: 'manual', summary: '' };
}

export function coverage(input: CoverageInput, tempF: number = NEUTRAL_F): CoverageRow[] {
  return (Object.keys(OCCASION_RULES) as Occasion[]).map((occasion) => {
    const count = (wet: boolean) => evaluate({ ...input, occasion, weather: weatherAt(tempF, wet) }).filter((c) => c.fails.length === 0).length;
    const dry = count(false);
    const wet = count(true);
    let hint: string | undefined;
    if (dry === 0 || wet === 0) {
      const best = bestAddition({ ...input, occasion, weather: weatherAt(tempF, dry > 0) });
      if (best) {
        const thing = additionWords(best);
        const when = dry === 0 ? '' : ' that can take rain';
        const where = dry === 0 ? '' : ' on wet days';
        hint = `${thing.charAt(0).toUpperCase()}${thing.slice(1)}${when} would make ${best.outfits} ${best.outfits === 1 ? 'outfit' : 'outfits'} possible${where}.`;
      }
    }
    return { occasion, dry, wet, hint };
  });
}

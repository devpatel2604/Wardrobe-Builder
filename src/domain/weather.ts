import { dateKey, hourLabel } from './dates';
import type { ManualWeather, TempBand } from './outfits/records';
import type { DayWeather } from './outfits/types';

/** One hour of the forecast. */
export interface HourForecast {
  /** ISO time with its offset, as the weather service gives it. */
  startTime: string;
  temperatureF: number;
  /** Chance of rain or snow, 0 to 100. Null when the service gives none. */
  precipChance: number | null;
  shortForecast: string;
}

/**
 * At or above this chance of rain or snow, the hours count as wet. A working
 * value, like the temperature lines in the outfit filters.
 */
export const WET_FROM_PERCENT = 40;

const WET_WORDS = /rain|shower|drizzle|thunder|snow|sleet|flurr|wintry|freezing/i;
const SNOW_WORDS = /snow|sleet|flurr|wintry|freezing|ice/i;
const ONLY_A_CHANCE = /slight chance|chance/i;

function isWetHour(hour: HourForecast): boolean {
  if (hour.precipChance !== null) return hour.precipChance >= WET_FROM_PERCENT;
  return WET_WORDS.test(hour.shortForecast) && !ONLY_A_CHANCE.test(hour.shortForecast);
}

/**
 * The weather for the hours of one occasion: from the hour it starts through
 * the hour it ends. Returns nothing when the forecast has none of those hours,
 * which happens once they have passed or lie beyond the forecast.
 */
export function windowWeather(hours: HourForecast[], date: string, [start, end]: [number, number]): DayWeather | undefined {
  const inWindow = hours
    .map((hour) => ({ hour, at: new Date(hour.startTime) }))
    .filter(({ at }) => dateKey(at) === date && at.getHours() >= start && at.getHours() <= end);
  if (inWindow.length === 0) return undefined;
  const temps = inWindow.map(({ hour }) => hour.temperatureF);
  const lowF = Math.min(...temps);
  const highF = Math.max(...temps);
  const wetHours = inWindow.filter(({ hour }) => isWetHour(hour));
  const wet = wetHours.length > 0;
  const snow = wetHours.some(({ hour }) => SNOW_WORDS.test(hour.shortForecast));
  const chance = Math.max(...inWindow.map(({ hour }) => hour.precipChance ?? 0));

  const first = inWindow.find(({ at }) => at.getHours() === start);
  const last = inWindow.find(({ at }) => at.getHours() === end);
  const temperature =
    first && last && start !== end
      ? `${Math.round(first.hour.temperatureF)}°F at ${hourLabel(start)}, ${Math.round(last.hour.temperatureF)}°F at ${hourLabel(end)}`
      : lowF === highF
        ? `${Math.round(lowF)}°F`
        : `${Math.round(lowF)} to ${Math.round(highF)}°F`;
  const sky = wet ? `${snow ? 'snow' : 'rain'} likely${chance > 0 ? ` (${Math.round(chance)}%)` : ''}` : 'dry';
  return { lowF, highF, wet, snow, source: 'forecast', summary: `${temperature}, ${sky}` };
}

export const TEMP_BANDS: { value: TempBand; label: string; tempF: number }[] = [
  { value: 'cold', label: 'Under 50°F', tempF: 40 },
  { value: 'cool', label: '50s to low 60s', tempF: 56 },
  { value: 'mild', label: 'Mid 60s to low 70s', tempF: 68 },
  { value: 'warm', label: '75°F and up', tempF: 80 },
];

/** The weather as the owner set it, for a day with no forecast. */
export function manualWeather(manual: ManualWeather): DayWeather {
  const band = TEMP_BANDS.find((b) => b.value === manual.band) ?? TEMP_BANDS[0]!;
  return {
    lowF: band.tempF,
    highF: band.tempF,
    wet: manual.wet,
    snow: false,
    source: 'manual',
    summary: `${band.label}, ${manual.wet ? 'wet' : 'dry'} (set by you)`,
  };
}

/** The usual coldest daytime temperature over the given days, for the coverage grid. */
export function typicalLow(hours: HourForecast[], dates: string[]): number | undefined {
  const lows: number[] = [];
  for (const date of dates) {
    const day = hours.filter((hour) => {
      const at = new Date(hour.startTime);
      return dateKey(at) === date && at.getHours() >= 7 && at.getHours() <= 22;
    });
    if (day.length > 0) lows.push(Math.min(...day.map((h) => h.temperatureF)));
  }
  if (lows.length === 0) return undefined;
  return Math.round(lows.reduce((sum, t) => sum + t, 0) / lows.length);
}

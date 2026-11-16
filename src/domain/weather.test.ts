import { describe, expect, it } from 'vitest';
import { hourly } from '../test/outfitFixtures';
import { manualWeather, typicalLow, windowWeather, type HourForecast } from './weather';

const at = (hour: number, tempF: number, precipChance: number | null, shortForecast = 'Sunny'): HourForecast => ({
  startTime: new Date(2026, 0, 6, hour).toISOString(),
  temperatureF: tempF,
  precipChance,
  shortForecast,
});

describe('windowWeather', () => {
  it('reads the hours of the occasion and names the temperature at each end', () => {
    const hours = [at(6, 30, 0), at(7, 34, 0), at(12, 45, 10), at(16, 49, 20), at(17, 47, 90)];
    expect(windowWeather(hours, '2026-01-06', [7, 16])).toEqual({
      lowF: 34,
      highF: 49,
      wet: false,
      snow: false,
      source: 'forecast',
      summary: '34°F at 7 am, 49°F at 4 pm, dry',
    });
  });

  it('counts the hours as wet from a 40 percent chance, and names snow', () => {
    expect(windowWeather([at(18, 41, 39), at(23, 38, 30)], '2026-01-06', [18, 23])?.wet).toBe(false);
    const rain = windowWeather([at(18, 41, 40, 'Chance Rain Showers'), at(23, 38, 30)], '2026-01-06', [18, 23]);
    expect(rain).toMatchObject({ wet: true, snow: false, summary: '41°F at 6 pm, 38°F at 11 pm, rain likely (40%)' });
    expect(windowWeather([at(19, 30, 70, 'Snow Likely')], '2026-01-06', [18, 23])).toMatchObject({ wet: true, snow: true, summary: '30°F, snow likely (70%)' });
  });

  it('falls back to the words when the service gives no chance', () => {
    expect(windowWeather([at(9, 50, null, 'Light Rain')], '2026-01-06', [8, 17])?.wet).toBe(true);
    expect(windowWeather([at(9, 50, null, 'Slight Chance Rain')], '2026-01-06', [8, 17])?.wet).toBe(false);
  });

  it('gives a range when an end hour is missing, and nothing when no hour is left', () => {
    expect(windowWeather([at(12, 45, 0), at(16, 49, 0)], '2026-01-06', [7, 16])?.summary).toBe('45 to 49°F, dry');
    expect(windowWeather([at(18, 45, 0)], '2026-01-06', [7, 16])).toBeUndefined();
    expect(windowWeather([at(9, 45, 0)], '2026-01-07', [7, 16])).toBeUndefined();
  });
});

describe('manual weather and the usual low', () => {
  it('turns a band the owner picked into a temperature', () => {
    expect(manualWeather({ band: 'cold', wet: true })).toMatchObject({ lowF: 40, wet: true, source: 'manual', summary: 'Under 50°F, wet (set by you)' });
    expect(manualWeather({ band: 'warm', wet: false }).highF).toBe(80);
  });

  it('averages the coldest daytime hour of each day', () => {
    const hours = hourly([
      { date: '2026-01-06', tempF: 30 },
      { date: '2026-01-07', tempF: 40 },
    ]);
    expect(typicalLow(hours, ['2026-01-06', '2026-01-07', '2026-01-08'])).toBe(35);
    expect(typicalLow([], ['2026-01-06'])).toBeUndefined();
  });
});

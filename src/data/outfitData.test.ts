import { describe, expect, it, vi } from 'vitest';
import { derbies, hourly, pleats, tee, zip } from '../test/outfitFixtures';
import { sampleProfile } from '../test/fixtures';
import { exportBackup, importBackup, parseBackup } from './backup';
import { db } from './db';
import { logNotToday, logWore, recentLog, setRating, setReason, undoEntry } from './outfitLogRepo';
import { clearPlan, plansBetween, setManualWeather, setOccasions } from './planRepo';
import { eraseEverything } from './setup';
import { fetchHours, isFresh, parseHourly, refreshForecast, roundPoint, savedForecast } from './weatherRepo';

const outfit = { mainTop: zip, underLayer: tee, trousers: pleats, shoes: derbies };
const answer = { date: '2026-01-06', occasion: 'office' as const, outfit };

describe('the outfit log', () => {
  it('logs a worn outfit once per day and occasion, and counts a wear on each piece', async () => {
    await db.pieces.bulkAdd([zip, tee, pleats, derbies]);
    await logWore(answer, false);
    const second = await logWore({ ...answer, outfit: { ...outfit, underLayer: undefined } }, true);
    const log = await recentLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: 'wore',
      outfitKey: 'zip||pleats|derbies|',
      swapped: true,
      pieces: { mainTop: 'zip', trousers: 'pleats', shoes: 'derbies' },
    });
    expect((await db.pieces.get('zip'))?.wearCount).toBe(1);
    // The first answer was replaced, so its wear on the tee was taken back.
    expect((await db.pieces.get('tee'))?.wearCount).toBe(0);

    await setRating(second.id, 'loved');
    expect((await recentLog())[0]?.rating).toBe('loved');
    await undoEntry(second.id);
    expect(await recentLog()).toEqual([]);
    expect((await db.pieces.get('zip'))?.wearCount).toBe(0);
  });

  it('keeps "not today" answers with an optional reason, and leaves wear counts alone', async () => {
    await db.pieces.bulkAdd([zip, tee, pleats, derbies]);
    const entry = await logNotToday(answer);
    await setReason(entry.id, 'too-formal');
    expect(await recentLog()).toMatchObject([{ action: 'not-today', reason: 'too-formal', outfitKey: 'zip|tee|pleats|derbies|' }]);
    expect((await db.pieces.get('zip'))?.wearCount).toBe(0);
  });
});

describe('day plans', () => {
  it('stores the occasions of a day and goes back to the usual when cleared', async () => {
    await setOccasions('2026-01-10', ['date', 'date', 'casual']);
    await setManualWeather('2026-01-10', { band: 'cool', wet: true }, []);
    await setManualWeather('2026-01-11', { band: 'cold', wet: false }, ['office']);
    const plans = await plansBetween('2026-01-06', '2026-01-12');
    expect(plans.get('2026-01-10')).toMatchObject({ occasions: ['date', 'casual'], manualWeather: { band: 'cool', wet: true } });
    expect(plans.get('2026-01-11')).toMatchObject({ occasions: ['office'] });
    await clearPlan('2026-01-10');
    expect((await plansBetween('2026-01-06', '2026-01-12')).has('2026-01-10')).toBe(false);
  });
});

describe('backup of plans and the log', () => {
  it('exports them, restores them, and a setup file leaves them alone', async () => {
    await db.profile.put(sampleProfile());
    await db.pieces.bulkAdd([zip, tee, pleats, derbies]);
    await setOccasions('2026-01-10', ['date']);
    await logWore(answer, false);
    const file = parseBackup(JSON.stringify(await exportBackup()));
    expect(file.dayPlans).toHaveLength(1);
    expect(file.outfitLog).toHaveLength(1);

    await importBackup({ ...file, kind: 'setup', dayPlans: [], outfitLog: [] });
    expect(await db.dayPlans.count()).toBe(1);
    expect(await db.outfitLog.count()).toBe(1);

    await eraseEverything();
    expect(await db.dayPlans.count()).toBe(0);
    expect(await db.outfitLog.count()).toBe(0);
    await importBackup(file);
    expect(await db.dayPlans.count()).toBe(1);
    expect((await recentLog())[0]).toMatchObject({ date: '2026-01-06', action: 'wore' });
  });

  it('still reads a file made before plans and the log existed', async () => {
    const old = { ...(await exportBackup()), dayPlans: undefined, outfitLog: undefined };
    await setOccasions('2026-01-10', ['date']);
    await importBackup(parseBackup(JSON.stringify(old)));
    expect(await db.dayPlans.count()).toBe(0);
    expect(() => parseBackup(JSON.stringify({ ...old, outfitLog: [{ nope: true }] }))).toThrow('cannot read');
  });
});

describe('the forecast', () => {
  const point = { lat: 40.004, lon: -74.006 };
  const period = {
    startTime: '2026-01-06T07:00:00-05:00',
    temperature: 34,
    temperatureUnit: 'F',
    probabilityOfPrecipitation: { value: 20 },
    shortForecast: 'Sunny',
  };

  function fakeFetch(hourlyBody: unknown = { properties: { periods: [period] } }) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/points/') ? { properties: { forecastHourly: 'https://api.weather.gov/gridpoints/ABC/1,2/forecast/hourly' } } : hourlyBody;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it('sends only the rounded map point, and reads the hourly periods', async () => {
    const fetchImpl = fakeFetch();
    const hours = await fetchHours(point, fetchImpl);
    const calls = vi.mocked(fetchImpl).mock.calls.map((call) => String(call[0]));
    expect(calls).toEqual(['https://api.weather.gov/points/40,-74.01', 'https://api.weather.gov/gridpoints/ABC/1,2/forecast/hourly']);
    expect(hours).toEqual([{ startTime: '2026-01-06T07:00:00-05:00', temperatureF: 34, precipChance: 20, shortForecast: 'Sunny' }]);
    expect(roundPoint(point)).toEqual({ lat: 40, lon: -74.01 });
  });

  it('converts Celsius and drops periods it cannot read', () => {
    const hours = parseHourly({
      properties: { periods: [{ ...period, temperature: 0, temperatureUnit: 'C', probabilityOfPrecipitation: { value: null } }, { startTime: 5 }, 'junk'] },
    });
    expect(hours).toEqual([{ startTime: period.startTime, temperatureF: 32, precipChance: null, shortForecast: 'Sunny' }]);
    expect(parseHourly(null)).toEqual([]);
  });

  it('refuses an answer with no forecast in it, and one that points somewhere else', async () => {
    await expect(fetchHours(point, fakeFetch({ properties: { periods: [] } }))).rejects.toThrow('empty forecast');
    const elsewhere = vi.fn(
      async () => new Response(JSON.stringify({ properties: { forecastHourly: 'https://example.com/hourly' } })),
    ) as unknown as typeof fetch;
    await expect(fetchHours(point, elsewhere)).rejects.toThrow('no forecast for that point');
    const down = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchHours(point, down)).rejects.toThrow('503');
  });

  it('keeps the last forecast on the phone, for the same point only, and out of a backup', async () => {
    expect(await savedForecast(point)).toBeUndefined();
    const saved = await refreshForecast(
      point,
      fakeFetch({
        properties: {
          periods: hourly([{ date: '2026-01-06' }]).map((h) => ({
            startTime: h.startTime,
            temperature: h.temperatureF,
            temperatureUnit: 'F',
            shortForecast: h.shortForecast,
          })),
        },
      }),
    );
    expect(saved.hours).toHaveLength(24);
    expect((await savedForecast(point))?.hours).toHaveLength(24);
    expect(await savedForecast({ lat: 41, lon: -74 })).toBeUndefined();
    expect(isFresh(saved)).toBe(true);
    expect(isFresh(saved, Date.now() + 3 * 60 * 60 * 1000)).toBe(false);
    expect(JSON.stringify(await exportBackup())).not.toContain('weather.forecast');
  });
});

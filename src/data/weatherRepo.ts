import { db, nowIso } from './db';
import type { MapPoint } from '../domain/types';
import type { HourForecast } from '../domain/weather';

/**
 * The hourly forecast from the US National Weather Service, which is free and
 * needs no key. The only thing sent is a map point for the town, rounded to two
 * decimals. The last forecast is kept on the phone, so the app still has one
 * when it opens with no connection.
 *
 * A second source (such as the app's own server) can be added in `fetchHours`
 * if the weather service stops answering a web page directly.
 */
const NWS = 'https://api.weather.gov';
const CACHE_KEY = 'weather.forecast';
/** Ask again once the saved forecast is this old. */
export const FRESH_FOR_MS = 2 * 60 * 60 * 1000;
/** A saved forecast older than this is not used at all. */
export const USABLE_FOR_MS = 36 * 60 * 60 * 1000;

export interface SavedForecast {
  point: MapPoint;
  fetchedAt: string;
  hours: HourForecast[];
}

export function roundPoint(point: MapPoint): MapPoint {
  const round = (n: number) => Math.round(n * 100) / 100;
  return { lat: round(point.lat), lon: round(point.lon) };
}

function samePoint(a: MapPoint, b: MapPoint): boolean {
  return a.lat === b.lat && a.lon === b.lon;
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { Accept: 'application/geo+json' } });
  if (!response.ok) throw new Error(`The weather service answered ${response.status}.`);
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Reads the weather service's hourly periods. Anything unexpected is dropped, not guessed. */
export function parseHourly(raw: unknown): HourForecast[] {
  const properties = isRecord(raw) ? raw.properties : undefined;
  const periods = isRecord(properties) && Array.isArray(properties.periods) ? properties.periods : [];
  const hours: HourForecast[] = [];
  for (const period of periods) {
    if (!isRecord(period) || typeof period.startTime !== 'string' || typeof period.temperature !== 'number') continue;
    const tempF = period.temperatureUnit === 'C' ? (period.temperature * 9) / 5 + 32 : period.temperature;
    const chance = isRecord(period.probabilityOfPrecipitation) ? period.probabilityOfPrecipitation.value : null;
    hours.push({
      startTime: period.startTime,
      temperatureF: tempF,
      precipChance: typeof chance === 'number' ? chance : null,
      shortForecast: typeof period.shortForecast === 'string' ? period.shortForecast : '',
    });
  }
  return hours;
}

/** Two calls: the point gives the address of its hourly forecast, then the forecast itself. */
export async function fetchHours(point: MapPoint, fetchImpl: typeof fetch = fetch): Promise<HourForecast[]> {
  const { lat, lon } = roundPoint(point);
  const place = await getJson(`${NWS}/points/${lat},${lon}`, fetchImpl);
  const properties = isRecord(place) ? place.properties : undefined;
  const url = isRecord(properties) ? properties.forecastHourly : undefined;
  if (typeof url !== 'string' || !url.startsWith(`${NWS}/`)) throw new Error('The weather service has no forecast for that point.');
  const hours = parseHourly(await getJson(url, fetchImpl));
  if (hours.length === 0) throw new Error('The weather service sent an empty forecast.');
  return hours;
}

export async function savedForecast(point: MapPoint): Promise<SavedForecast | undefined> {
  const row = await db.meta.get(CACHE_KEY);
  if (!row) return undefined;
  try {
    const saved = JSON.parse(row.value) as SavedForecast;
    if (!samePoint(saved.point, roundPoint(point))) return undefined;
    if (Date.now() - Date.parse(saved.fetchedAt) > USABLE_FOR_MS) return undefined;
    return saved;
  } catch {
    return undefined;
  }
}

export async function refreshForecast(point: MapPoint, fetchImpl: typeof fetch = fetch): Promise<SavedForecast> {
  const hours = await fetchHours(point, fetchImpl);
  const saved: SavedForecast = { point: roundPoint(point), fetchedAt: nowIso(), hours };
  await db.meta.put({ key: CACHE_KEY, value: JSON.stringify(saved) });
  return saved;
}

export function isFresh(saved: SavedForecast | undefined, now: number = Date.now()): boolean {
  return saved !== undefined && now - Date.parse(saved.fetchedAt) < FRESH_FOR_MS;
}

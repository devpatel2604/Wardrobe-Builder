import type { D1Database, Fetch } from './env';
import { HttpError, json } from './http';
import { getConfig, setConfig } from './schema';

/**
 * The forecast, from the US National Weather Service (api.weather.gov).
 * It is free, needs no key, and is sent only a point on the map.
 */
export interface MapPoint {
  lat: number;
  lon: number;
}

/** One hour of forecast. The app's own weather code uses the same shape. */
export interface ForecastHour {
  /** Local time at the place, such as 2026-11-16T07:00:00-05:00. */
  startTime: string;
  temperatureF: number;
  /** Chance of rain or snow, 0 to 100. */
  precipChance: number;
  shortForecast: string;
}

// The service asks every caller to say who it is. This names the app only.
const HEADERS = { 'User-Agent': 'wardrobe-builder (personal wardrobe app)', Accept: 'application/geo+json' };

/** Rounds to two decimals, about a kilometer. A town, not an address. */
export function toMapPoint(lat: unknown, lon: unknown): MapPoint | undefined {
  const a = typeof lat === 'string' && lat.trim() ? Number(lat) : lat;
  const b = typeof lon === 'string' && lon.trim() ? Number(lon) : lon;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  if (a < -90 || a > 90 || b < -180 || b > 180) return undefined;
  return { lat: Math.round(a * 100) / 100, lon: Math.round(b * 100) / 100 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function getJson(fetcher: Fetch, url: string): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`weather service answered ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !isRecord(body.properties)) throw new Error('weather service sent something unexpected');
  return body.properties;
}

/** The service keeps forecasts per grid square. This finds the square once and remembers it. */
async function hourlyUrl(db: D1Database, fetcher: Fetch, point: MapPoint): Promise<string> {
  const key = `nws:${point.lat},${point.lon}`;
  const known = await getConfig(db, key);
  if (known) return known;
  const properties = await getJson(fetcher, `https://api.weather.gov/points/${point.lat},${point.lon}`);
  const url = properties.forecastHourly;
  if (typeof url !== 'string' || !url.startsWith('https://api.weather.gov/')) throw new Error('weather service gave no forecast address');
  await setConfig(db, key, url);
  return url;
}

function toFahrenheit(value: number, unit: unknown): number {
  return Math.round(unit === 'C' ? (value * 9) / 5 + 32 : value);
}

export async function fetchForecast(db: D1Database, fetcher: Fetch, point: MapPoint): Promise<ForecastHour[]> {
  const properties = await getJson(fetcher, await hourlyUrl(db, fetcher, point));
  if (!Array.isArray(properties.periods)) throw new Error('weather service sent no hours');
  const hours: ForecastHour[] = [];
  for (const period of properties.periods) {
    if (!isRecord(period) || typeof period.startTime !== 'string' || typeof period.temperature !== 'number') continue;
    const chance = isRecord(period.probabilityOfPrecipitation) ? period.probabilityOfPrecipitation.value : undefined;
    hours.push({
      startTime: period.startTime,
      temperatureF: toFahrenheit(period.temperature, period.temperatureUnit),
      precipChance: typeof chance === 'number' ? chance : 0,
      shortForecast: typeof period.shortForecast === 'string' ? period.shortForecast : '',
    });
  }
  return hours;
}

/** GET /api/forecast?lat=..&lon=.. : the next two days, hour by hour. */
export async function getForecast(db: D1Database, fetcher: Fetch, url: URL): Promise<Response> {
  const point = toMapPoint(url.searchParams.get('lat') ?? undefined, url.searchParams.get('lon') ?? undefined);
  if (!point) throw new HttpError(400, 'Give a latitude and a longitude.');
  try {
    const periods = await fetchForecast(db, fetcher, point);
    return json({ point, periods: periods.slice(0, 48) });
  } catch (error) {
    console.warn('Forecast failed', error);
    throw new HttpError(502, 'The weather service did not answer.');
  }
}

function hourLabel(hour: number): string {
  if (hour === 0) return '12 am';
  if (hour === 12) return '12 pm';
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/** A short line for the alert, such as "35°F at 7 am, dry". */
export function describeMorning(hours: ForecastHour[], date: string, hour: number): string | undefined {
  const prefix = `${date}T${String(hour).padStart(2, '0')}:`;
  const match = hours.find((h) => h.startTime.startsWith(prefix));
  if (!match) return undefined;
  const sky = match.precipChance >= 30 && match.shortForecast ? `${match.shortForecast.toLowerCase()} (${match.precipChance}%)` : 'dry';
  return `${match.temperatureF}°F at ${hourLabel(hour)}, ${sky}`;
}

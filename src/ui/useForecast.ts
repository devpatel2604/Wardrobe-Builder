import { useEffect, useState } from 'react';
import { isFresh, refreshForecast, savedForecast } from '../data/weatherRepo';
import type { MapPoint } from '../domain/types';
import type { HourForecast } from '../domain/weather';

export interface ForecastState {
  /** "none" means there is no map point to ask about. */
  status: 'none' | 'loading' | 'ready' | 'unavailable';
  hours: HourForecast[];
  fetchedAt?: string;
  /** True when the newest try failed and an older forecast, or none, is shown. */
  failed: boolean;
}

const NONE: ForecastState = { status: 'none', hours: [], failed: false };
const LOADING: ForecastState = { status: 'loading', hours: [], failed: false };

/**
 * The hourly forecast for the town's map point. Shows the saved forecast at
 * once, then asks for a new one when the saved one is more than two hours old.
 * With no connection the saved forecast stays.
 */
export function useForecast(point: MapPoint | undefined): ForecastState {
  const key = point ? `${point.lat},${point.lon}` : undefined;
  const [loaded, setLoaded] = useState<{ key: string; state: ForecastState }>();

  useEffect(() => {
    if (!key) return;
    const [lat, lon] = key.split(',').map(Number) as [number, number];
    const at = { lat, lon };
    let live = true;
    void (async () => {
      const saved = await savedForecast(at).catch(() => undefined);
      if (!live) return;
      if (saved) setLoaded({ key, state: { status: 'ready', hours: saved.hours, fetchedAt: saved.fetchedAt, failed: false } });
      if (isFresh(saved)) return;
      try {
        const fresh = await refreshForecast(at);
        if (live) setLoaded({ key, state: { status: 'ready', hours: fresh.hours, fetchedAt: fresh.fetchedAt, failed: false } });
      } catch {
        if (!live) return;
        setLoaded({
          key,
          state: saved ? { status: 'ready', hours: saved.hours, fetchedAt: saved.fetchedAt, failed: true } : { status: 'unavailable', hours: [], failed: true },
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [key]);

  if (!key) return NONE;
  return loaded?.key === key ? loaded.state : LOADING;
}

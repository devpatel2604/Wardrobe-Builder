import { useState } from 'react';
import { updateProfile } from '../data/profileRepo';
import { roundPoint } from '../data/weatherRepo';
import type { MapPoint, Profile } from '../domain/types';
import { TextField } from './controls';

function readPoint(lat: string, lon: string): MapPoint | undefined {
  const point = { lat: Number(lat), lon: Number(lon) };
  if (lat.trim() === '' || lon.trim() === '' || Number.isNaN(point.lat) || Number.isNaN(point.lon)) return undefined;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) return undefined;
  return roundPoint(point);
}

/**
 * Sets the map point the forecast is asked for. The point is rounded to two
 * decimals, about half a mile, before it is saved or sent anywhere.
 */
export function WeatherSetup({ profile }: { profile: Profile }) {
  const saved = profile.home.point;
  const [lat, setLat] = useState(saved ? String(saved.lat) : '');
  const [lon, setLon] = useState(saved ? String(saved.lon) : '');
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(point: MapPoint | undefined) {
    await updateProfile({ home: { ...profile.home, point } });
    setLat(point ? String(point.lat) : '');
    setLon(point ? String(point.lon) : '');
    setNote(point ? `Saved: ${point.lat}, ${point.lon}.` : 'Removed. The app will not ask for a forecast.');
  }

  function useLocation() {
    if (!navigator.geolocation) {
      setNote('This browser cannot give a location. Type the numbers in below.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setBusy(false);
        void save(roundPoint({ lat: position.coords.latitude, lon: position.coords.longitude }));
      },
      () => {
        setBusy(false);
        setNote('The phone did not share a location. Type the numbers in below.');
      },
      { maximumAge: 3_600_000, timeout: 15_000 },
    );
  }

  return (
    <div className="stack">
      <p className="hint">
        The forecast comes from the US National Weather Service. The only thing sent is a map point for your town, rounded to about half a mile.
        {saved ? ` Yours is ${saved.lat}, ${saved.lon}.` : ' None is set yet.'}
      </p>
      <button type="button" className="btn" disabled={busy} onClick={useLocation}>
        {busy ? 'Asking the phone' : "Use this phone's location"}
      </button>
      <div className="two-up">
        <TextField label="Latitude" value={lat} onChange={setLat} inputMode="decimal" placeholder="40.00" />
        <TextField label="Longitude" value={lon} onChange={setLon} inputMode="decimal" placeholder="-74.00" />
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={() => {
            const point = readPoint(lat, lon);
            if (point) void save(point);
            else setNote('Those are not a latitude and a longitude. Example: 40.00 and -74.00.');
          }}
        >
          Save map point
        </button>
        {saved && (
          <button type="button" className="btn btn-small" onClick={() => void save(undefined)}>
            Remove it
          </button>
        )}
      </div>
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

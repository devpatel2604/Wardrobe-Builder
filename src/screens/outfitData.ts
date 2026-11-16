import { useLiveQuery } from 'dexie-react-hooks';
import { recentLog } from '../data/outfitLogRepo';
import { coverPhotos, listPieces } from '../data/piecesRepo';
import { plansBetween } from '../data/planRepo';
import { getProfile } from '../data/profileRepo';
import { addDays, weekdayOf } from '../domain/dates';
import { OCCASION_RULES, defaultOccasions, officeHours } from '../domain/outfits/occasions';
import type { DayPlan, OutfitIds, OutfitLogEntry } from '../domain/outfits/records';
import type { DayWeather, Occasion, Outfit } from '../domain/outfits/types';
import type { Photo, Piece, Profile } from '../domain/types';
import { manualWeather, windowWeather, type HourForecast } from '../domain/weather';

export interface OutfitData {
  profile: Profile;
  pieces: Piece[];
  covers: Map<string, Photo>;
  log: OutfitLogEntry[];
  plans: Map<string, DayPlan>;
}

/** Everything the Today and Week screens read, kept current as the database changes. */
export function useOutfitData(today: string): OutfitData | undefined {
  return useLiveQuery(async () => {
    const [profile, pieces, covers, log, plans] = await Promise.all([
      getProfile(),
      listPieces(),
      coverPhotos(),
      recentLog(),
      plansBetween(today, addDays(today, 7)),
    ]);
    return profile ? { profile, pieces, covers, log, plans } : undefined;
  }, [today]);
}

/** The occasions of a day: what the owner set, or else the office on office days. */
export function occasionsOn(date: string, data: Pick<OutfitData, 'plans' | 'profile'>): Occasion[] {
  return data.plans.get(date)?.occasions ?? defaultOccasions(weekdayOf(date), data.profile.week.officeDays);
}

export function hoursFor(profile: Profile, occasion: Occasion): [number, number] {
  return occasion === 'office' ? officeHours(profile.week.officeHours) : OCCASION_RULES[occasion].hours;
}

/** The forecast for the occasion's own hours, or else the weather the owner set for that day. */
export function weatherFor(data: Pick<OutfitData, 'plans' | 'profile'>, hours: HourForecast[], date: string, occasion: Occasion): DayWeather | undefined {
  const fromForecast = windowWeather(hours, date, hoursFor(data.profile, occasion));
  if (fromForecast) return fromForecast;
  const manual = data.plans.get(date)?.manualWeather;
  return manual ? manualWeather(manual) : undefined;
}

/** Rebuilds a logged outfit from its piece ids. Nothing comes back when a main piece has been deleted. */
export function outfitFromIds(ids: OutfitIds, pieces: Piece[]): Outfit | undefined {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const find = (id: string | undefined) => (id ? byId.get(id) : undefined);
  const mainTop = find(ids.mainTop);
  const trousers = find(ids.trousers);
  const shoes = find(ids.shoes);
  if (!mainTop || !trousers || !shoes) return undefined;
  return { mainTop, trousers, shoes, underLayer: find(ids.underLayer), thirdLayer: find(ids.thirdLayer), coat: find(ids.coat), belt: find(ids.belt) };
}

export function isOccasion(value: string | null | undefined): value is Occasion {
  return value !== null && value !== undefined && value in OCCASION_RULES;
}

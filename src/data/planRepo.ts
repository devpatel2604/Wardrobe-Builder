import { db, nowIso } from './db';
import type { DayPlan, ManualWeather } from '../domain/outfits/records';
import type { Occasion } from '../domain/outfits/types';

/** The plans for a run of days, by date. Days the owner never touched have no row. */
export async function plansBetween(from: string, to: string): Promise<Map<string, DayPlan>> {
  const rows = await db.dayPlans.where('date').between(from, to, true, true).toArray();
  return new Map(rows.map((row) => [row.date, row]));
}

/** Sets every occasion of a day. An empty list means "nothing on that day", office included. */
export async function setOccasions(date: string, occasions: Occasion[]): Promise<void> {
  await db.transaction('rw', db.dayPlans, async () => {
    const current = await db.dayPlans.get(date);
    await db.dayPlans.put({ ...current, date, occasions: [...new Set(occasions)], updatedAt: nowIso() });
  });
}

/** Stores the weather the owner set by hand. Needs the day's occasions so a new row is complete. */
export async function setManualWeather(date: string, manualWeather: ManualWeather | undefined, occasions: Occasion[]): Promise<void> {
  await db.transaction('rw', db.dayPlans, async () => {
    const current = await db.dayPlans.get(date);
    await db.dayPlans.put({ date, occasions: current?.occasions ?? occasions, manualWeather, updatedAt: nowIso() });
  });
}

/** Back to the default for that day: the office on office days. */
export async function clearPlan(date: string): Promise<void> {
  await db.dayPlans.delete(date);
}

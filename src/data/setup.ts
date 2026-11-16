import { db } from './db';
import { emptyProfile } from '../domain/types';

/**
 * The app ships with no personal data. On first run there is no profile, and
 * the welcome screen offers two ways in: load a setup file, or start empty.
 */
export async function startEmpty(): Promise<void> {
  await db.transaction('rw', db.profile, async () => {
    if (!(await db.profile.get('me'))) await db.profile.put(emptyProfile());
  });
}

/** Deletes everything on this device, including saved settings. */
export async function eraseEverything(): Promise<void> {
  const tables = [db.profile, db.pieces, db.photos, db.meta, db.colorTests, db.dayPlans, db.outfitLog];
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((table) => table.clear()));
  });
}

export type StorageStatus = 'protected' | 'not-protected' | 'unknown';

/**
 * Ask the browser not to clear this app's data when storage runs low.
 * Safari grants this to an app on the Home Screen far more readily than to a
 * tab, so the answer is worth showing in Settings.
 */
export async function requestPersistentStorage(): Promise<StorageStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'unknown';
  try {
    if (await navigator.storage.persisted()) return 'protected';
    return (await navigator.storage.persist()) ? 'protected' : 'not-protected';
  } catch {
    return 'unknown';
  }
}

/** True when the app was opened from the Home Screen, not in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

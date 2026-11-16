import { db, nowIso } from './db';
import type { Profile } from '../domain/types';

export async function getProfile(): Promise<Profile | undefined> {
  return db.profile.get('me');
}

/** Replace part of the profile. Sections are replaced whole, not merged. */
export async function updateProfile(changes: Partial<Omit<Profile, 'id'>>): Promise<Profile> {
  return db.transaction('rw', db.profile, async () => {
    const current = await db.profile.get('me');
    if (!current) throw new Error('There is no profile to update.');
    const next: Profile = { ...current, ...changes, id: 'me', updatedAt: nowIso() };
    await db.profile.put(next);
    return next;
  });
}

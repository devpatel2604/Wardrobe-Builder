import Dexie, { type EntityTable, type Table } from 'dexie';
import type { ColorTest } from '../domain/colorTest';
import type { InboxItem } from '../domain/inbox';
import type { SavedLook } from '../domain/looks';
import type { DayPlan, OutfitLogEntry } from '../domain/outfits/records';
import type { Photo, Piece, Profile } from '../domain/types';

export interface MetaRow {
  key: string;
  value: string;
}

/**
 * Everything the app stores, in the browser's IndexedDB on the phone.
 * Screens never touch this directly. They go through the repository modules
 * in this folder, so a sync server can be added later behind the same calls.
 */
export class WardrobeDb extends Dexie {
  profile!: EntityTable<Profile, 'id'>;
  pieces!: EntityTable<Piece, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  meta!: Table<MetaRow, string>;
  colorTests!: EntityTable<ColorTest, 'id'>;
  dayPlans!: EntityTable<DayPlan, 'date'>;
  outfitLog!: EntityTable<OutfitLogEntry, 'id'>;
  inbox!: EntityTable<InboxItem, 'id'>;
  looks!: EntityTable<SavedLook, 'id'>;

  constructor(name = 'wardrobe-builder') {
    super(name);
    this.version(1).stores({
      profile: 'id',
      pieces: 'id, status, *slots, updatedAt',
      photos: 'id, pieceId, kind',
      meta: 'key',
    });
    // The color photo test: one row, id "current". Its photos live in `photos` as "of-me".
    this.version(2).stores({
      colorTests: 'id',
    });
    // Today and Week: what each day is for, and which outfits were worn or passed over.
    this.version(3).stores({
      dayPlans: 'date',
      outfitLog: 'id, date',
    });
    // Things waiting to be added: shared from the share menu, pasted, or picked.
    this.version(4).stores({
      inbox: 'id, kind, receivedAt',
    });
    // Saved inspiration: one row per look. Its screenshots live in `photos`
    // as "inspiration", under the id "look:<id>".
    this.version(5).stores({
      looks: 'id, updatedAt',
    });
  }
}

export const db = new WardrobeDb();

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

import Dexie, { type EntityTable, type Table } from 'dexie';
import type { ColorTest } from '../domain/colorTest';
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
  }
}

export const db = new WardrobeDb();

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

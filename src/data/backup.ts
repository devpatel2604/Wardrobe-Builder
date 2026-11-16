import { db, nowIso } from './db';
import type { DayPlan, OutfitLogEntry } from '../domain/outfits/records';
import type { Photo, Piece, Profile } from '../domain/types';

/**
 * Export and import of what the app stores, as one JSON file.
 *
 * Two kinds of file share the format:
 * - "backup": a full copy made by Export. Importing it replaces everything.
 * - "setup": a starting profile and list of pieces, written outside the app.
 *   Importing it replaces the profile and adds the pieces that are not there
 *   yet. Photos and pieces already on the phone are kept.
 *
 * Saved settings (the key-value table) are never exported, so a key stored
 * there later cannot end up in a file.
 */
export const BACKUP_APP = 'wardrobe-builder';
export const BACKUP_FORMAT_VERSION = 1;

type StoredPhoto = Omit<Photo, 'data' | 'thumb'> & { data: string; thumb: string };

export interface BackupFile {
  app: typeof BACKUP_APP;
  formatVersion: number;
  kind: 'backup' | 'setup';
  exportedAt: string;
  /** False when photos of the owner were left out, which is the default. */
  includesPrivatePhotos: boolean;
  profile: Profile | null;
  pieces: Piece[];
  photos: StoredPhoto[];
  /** What each day is for. Missing in files made before the Today and Week screens. */
  dayPlans?: DayPlan[];
  /** Outfits worn or passed over. Missing in older files. */
  outfitLog?: OutfitLogEntry[];
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function exportBackup(options: { includePrivatePhotos?: boolean } = {}): Promise<BackupFile> {
  const includePrivate = options.includePrivatePhotos ?? false;
  const [profile, pieces, photos, dayPlans, outfitLog] = await Promise.all([
    db.profile.get('me'),
    db.pieces.toArray(),
    db.photos.toArray(),
    db.dayPlans.toArray(),
    db.outfitLog.toArray(),
  ]);
  return {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    kind: 'backup',
    exportedAt: nowIso(),
    includesPrivatePhotos: includePrivate,
    profile: profile ?? null,
    pieces,
    photos: photos
      .filter((p) => includePrivate || p.kind !== 'of-me')
      .map((p) => ({ ...p, data: toBase64(p.data), thumb: toBase64(p.thumb) })),
    dayPlans,
    outfitLog,
  };
}

export function backupFileName(exportedAt: string): string {
  return `wardrobe-backup-${exportedAt.slice(0, 10)}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks the shape of a file and returns it, or throws with a plain message. */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not a wardrobe file.');
  }
  if (!isRecord(raw) || raw.app !== BACKUP_APP) throw new Error('That file is not a wardrobe file.');
  if (typeof raw.formatVersion !== 'number' || raw.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error('That file was made by a newer version of the app.');
  }
  if (raw.kind !== 'backup' && raw.kind !== 'setup') throw new Error('That file is not a wardrobe file.');
  if (!Array.isArray(raw.pieces) || !Array.isArray(raw.photos)) throw new Error('That file is incomplete.');
  for (const list of [raw.dayPlans, raw.outfitLog]) {
    if (list !== undefined && !(Array.isArray(list) && list.every((row) => isRecord(row) && typeof row.date === 'string'))) {
      throw new Error('That file has a day plan or outfit log the app cannot read.');
    }
  }
  for (const piece of raw.pieces) {
    if (
      !isRecord(piece) ||
      typeof piece.id !== 'string' ||
      typeof piece.name !== 'string' ||
      !Array.isArray(piece.slots) ||
      !Array.isArray(piece.tags)
    ) {
      throw new Error('That file has a piece the app cannot read.');
    }
  }
  for (const photo of raw.photos) {
    if (
      !isRecord(photo) ||
      typeof photo.id !== 'string' ||
      typeof photo.pieceId !== 'string' ||
      typeof photo.data !== 'string' ||
      typeof photo.thumb !== 'string'
    ) {
      throw new Error('That file has a photo the app cannot read.');
    }
  }
  const profile = raw.profile;
  if (profile !== null) {
    if (
      !isRecord(profile) ||
      profile.id !== 'me' ||
      !Array.isArray(profile.rules) ||
      !Array.isArray(profile.sizes) ||
      !Array.isArray(profile.stores) ||
      !Array.isArray(profile.palette) ||
      !isRecord(profile.body) ||
      !isRecord(profile.coloring) ||
      !isRecord(profile.week) ||
      !isRecord(profile.home)
    ) {
      throw new Error('That file has a profile the app cannot read.');
    }
  }
  return raw as unknown as BackupFile;
}

export interface ImportResult {
  kind: BackupFile['kind'];
  piecesAdded: number;
  piecesKept: number;
  photos: number;
}

export async function importBackup(file: BackupFile): Promise<ImportResult> {
  const photos: Photo[] = file.photos.map((p) => ({ ...p, data: fromBase64(p.data), thumb: fromBase64(p.thumb) }));
  return db.transaction('rw', [db.profile, db.pieces, db.photos, db.dayPlans, db.outfitLog], async () => {
    if (file.kind === 'setup') {
      if (file.profile) await db.profile.put({ ...file.profile, updatedAt: nowIso() });
      const existing = new Set(await db.pieces.toCollection().primaryKeys());
      const missing = file.pieces.filter((p) => !existing.has(p.id));
      await db.pieces.bulkAdd(missing);
      const existingPhotos = new Set(await db.photos.toCollection().primaryKeys());
      const newPhotos = photos.filter((p) => !existingPhotos.has(p.id));
      await db.photos.bulkAdd(newPhotos);
      return { kind: 'setup', piecesAdded: missing.length, piecesKept: file.pieces.length - missing.length, photos: newPhotos.length };
    }
    await db.profile.clear();
    await db.pieces.clear();
    // A default backup never holds photos of the owner, so those stay put.
    if (file.includesPrivatePhotos) await db.photos.clear();
    else await db.photos.where('kind').notEqual('of-me').delete();
    if (file.profile) await db.profile.put(file.profile);
    await db.pieces.bulkPut(file.pieces);
    await db.photos.bulkPut(photos);
    // A setup file leaves the day plans and the outfit log alone. A backup replaces them.
    await db.dayPlans.clear();
    await db.outfitLog.clear();
    await db.dayPlans.bulkPut(file.dayPlans ?? []);
    await db.outfitLog.bulkPut(file.outfitLog ?? []);
    return { kind: 'backup', piecesAdded: file.pieces.length, piecesKept: 0, photos: photos.length };
  });
}

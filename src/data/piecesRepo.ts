import { db, newId, nowIso } from './db';
import type { ProcessedImage } from './images';
import { SLOTS } from '../domain/options';
import type { Photo, PhotoKind, Piece, PieceDraft } from '../domain/types';

export interface PhotoChanges {
  /** New photos to attach, in the order they should appear after the kept ones. */
  add?: ProcessedImage[];
  /** Ids of photos to delete. */
  remove?: string[];
}

function clean(draft: PieceDraft): PieceDraft {
  const name = draft.name.trim();
  if (!name) throw new Error('A piece needs a name.');
  if (draft.slots.length === 0) throw new Error('Pick where the piece goes in an outfit.');
  const tags = [...new Set(draft.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const text = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  return {
    ...draft,
    name,
    tags,
    brand: text(draft.brand),
    colorName: text(draft.colorName),
    cloth: text(draft.cloth),
    size: text(draft.size),
    link: text(draft.link),
    notes: text(draft.notes),
    acquiredOn: text(draft.acquiredOn),
  };
}

async function applyPhotoChanges(pieceId: string, changes: PhotoChanges | undefined, kind: PhotoKind): Promise<void> {
  if (!changes) return;
  if (changes.remove?.length) await db.photos.bulkDelete(changes.remove);
  if (changes.add?.length) {
    const kept = await db.photos.where('pieceId').equals(pieceId).toArray();
    let order = kept.reduce((max, p) => Math.max(max, p.order), -1) + 1;
    const now = nowIso();
    const rows: Photo[] = changes.add.map((image) => ({
      id: newId(),
      pieceId,
      kind,
      order: order++,
      createdAt: now,
      ...image,
    }));
    await db.photos.bulkAdd(rows);
  }
}

const SLOT_ORDER = new Map(SLOTS.map((slot, index) => [slot.value, index]));

/** All pieces, in outfit order (tops first, fragrance last), then by name. */
export async function listPieces(): Promise<Piece[]> {
  const pieces = await db.pieces.toArray();
  const rank = (p: Piece) => SLOT_ORDER.get(p.slots[0] ?? 'accessory') ?? SLOT_ORDER.size;
  return pieces.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export async function getPiece(id: string): Promise<Piece | undefined> {
  return db.pieces.get(id);
}

export async function createPiece(draft: PieceDraft, photos?: PhotoChanges): Promise<Piece> {
  const now = nowIso();
  const piece: Piece = { ...clean(draft), id: newId(), wearCount: draft.wearCount ?? 0, createdAt: now, updatedAt: now };
  await db.transaction('rw', db.pieces, db.photos, async () => {
    await db.pieces.add(piece);
    await applyPhotoChanges(piece.id, photos, 'clothing');
  });
  return piece;
}

export async function updatePiece(id: string, draft: PieceDraft, photos?: PhotoChanges): Promise<Piece> {
  return db.transaction('rw', db.pieces, db.photos, async () => {
    const current = await db.pieces.get(id);
    if (!current) throw new Error('That piece no longer exists.');
    const next: Piece = {
      ...clean(draft),
      id,
      wearCount: draft.wearCount ?? current.wearCount,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
    };
    await db.pieces.put(next);
    await applyPhotoChanges(id, photos, 'clothing');
    return next;
  });
}

export async function deletePiece(id: string): Promise<void> {
  await db.transaction('rw', db.pieces, db.photos, async () => {
    await db.photos.where('pieceId').equals(id).delete();
    await db.pieces.delete(id);
  });
}

export async function listPhotos(pieceId: string): Promise<Photo[]> {
  const photos = await db.photos.where('pieceId').equals(pieceId).toArray();
  return photos.sort((a, b) => a.order - b.order);
}

/** The first photo of each piece, for the wardrobe grid. */
export async function coverPhotos(): Promise<Map<string, Photo>> {
  const covers = new Map<string, Photo>();
  await db.photos.each((photo) => {
    const current = covers.get(photo.pieceId);
    if (!current || photo.order < current.order) covers.set(photo.pieceId, photo);
  });
  return covers;
}

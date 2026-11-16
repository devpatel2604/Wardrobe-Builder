import { db, newId, nowIso } from './db';
import type { ProcessedImage } from './images';
import { getInboxItem, removeInboxItem } from './inboxRepo';
import { cleanCreator, parseSharedLink, sameLink } from '../domain/links';
import {
  LOOK_PHOTO_PREFIX,
  cleanTags,
  defaultLookName,
  lookPhotoOwner,
  sortPieces,
  type LookPiece,
  type LookReading,
  type SavedLook,
} from '../domain/looks';
import type { Photo } from '../domain/types';

/**
 * Saved inspiration: looks, their pieces and the owner's screenshots.
 *
 * A screenshot is a photo of kind "inspiration", stored under "look:<id>".
 * It is a private reference copy of a public post. The app never shows it
 * anywhere but on the look's own screens, and never pulls an image out of
 * Instagram's player.
 */

/** Enough to show the outfit from two angles and a close-up or two. */
export const MAX_SCREENSHOTS = 4;

export interface NewLook {
  /** A link, or text with a link in it. */
  link?: string;
  creator?: string;
  name?: string;
  notes?: string;
}

export interface CreatedLook {
  look: SavedLook;
  /** True when a look with this link was already saved, and that one came back. */
  existing: boolean;
}

/** All saved looks, newest first. */
export async function listLooks(): Promise<SavedLook[]> {
  const looks = await db.looks.toArray();
  return looks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getLook(id: string): Promise<SavedLook | undefined> {
  return db.looks.get(id);
}

/**
 * Saves a look. With a link it is tied to that post. Without one it is the
 * owner's own screenshot, credited "in the style of" when a creator is named.
 */
export async function createLook(input: NewLook, at: string = nowIso()): Promise<CreatedLook> {
  const typed = input.link?.trim();
  const shared = typed ? parseSharedLink(typed) : undefined;
  if (typed && !shared) throw new Error('That does not look like a link. Copy the link from the post and try again.');
  const creator = cleanCreator(input.creator) ?? (shared?.instagram?.handle ? `@${shared.instagram.handle}` : undefined);
  return db.transaction('rw', db.looks, async () => {
    if (shared) {
      const existing = (await db.looks.toArray()).find((l) => sameLink(l.link, shared.url));
      if (existing) return { look: existing, existing: true };
    }
    const base = { link: shared?.url, creator, pieces: [] as LookPiece[] };
    const look: SavedLook = {
      id: newId(),
      name: input.name?.trim() || defaultLookName(base),
      ...base,
      notes: input.notes?.trim() || undefined,
      createdAt: at,
      updatedAt: at,
    };
    await db.looks.add(look);
    return { look, existing: false };
  });
}

/** A link that arrived through the share menu becomes a look waiting for its screenshot. */
export function saveLookFromShare(share: { url: string; receivedAt?: string }): Promise<CreatedLook> {
  return createLook({ link: share.url }, share.receivedAt ?? nowIso());
}

async function change(id: string, edit: (look: SavedLook) => SavedLook): Promise<SavedLook> {
  return db.transaction('rw', db.looks, async () => {
    const current = await db.looks.get(id);
    if (!current) throw new Error('That look is no longer saved.');
    const next = { ...edit(current), id, createdAt: current.createdAt, updatedAt: nowIso() };
    await db.looks.put(next);
    return next;
  });
}

export interface LookDetails {
  name: string;
  link: string;
  creator: string;
  notes: string;
}

/** Saves the name, link, creator and notes as typed. An empty link unties the look from its post. */
export function updateLookDetails(id: string, details: LookDetails): Promise<SavedLook> {
  const typed = details.link.trim();
  const shared = typed ? parseSharedLink(typed) : undefined;
  if (typed && !shared) throw new Error('That does not look like a link. Copy the link from the post and try again.');
  return change(id, (look) => {
    const creator = cleanCreator(details.creator) ?? (shared?.instagram?.handle ? `@${shared.instagram.handle}` : undefined);
    const next = { ...look, link: shared?.url, creator, notes: details.notes.trim() || undefined };
    return { ...next, name: details.name.trim() || defaultLookName(next) };
  });
}

function tidyPiece(piece: LookPiece): LookPiece {
  const description = piece.description.replace(/\s+/g, ' ').trim();
  if (!description) throw new Error('Say what the piece is, such as "cream pleated trousers".');
  const isTop = piece.slot === 'main-top' || piece.slot === 'under-layer' || piece.slot === 'outer-layer';
  return {
    ...piece,
    description,
    material: piece.material?.trim().toLowerCase() || undefined,
    tags: cleanTags(piece.tags),
    // Top-only details are dropped when the piece is not a top.
    neckline: isTop ? piece.neckline : undefined,
    fit: isTop ? piece.fit : undefined,
    hem: isTop ? piece.hem : undefined,
  };
}

/** A name the app made up may follow the pieces. A name the owner typed stays. */
function renameIfDefault(before: SavedLook, after: SavedLook): SavedLook {
  return before.name === defaultLookName(before) ? { ...after, name: defaultLookName(after) } : after;
}

/** Adds a piece by hand, or saves an edit to one. An edited piece is the owner's from then on. */
export function saveLookPiece(lookId: string, piece: Omit<LookPiece, 'id' | 'from'> & { id?: string }): Promise<SavedLook> {
  return change(lookId, (look) => {
    const current = piece.id ? look.pieces.find((p) => p.id === piece.id) : undefined;
    const next = tidyPiece({ ...current, ...piece, id: current?.id ?? newId(), from: 'you', confidence: undefined });
    // A stand-in was accepted for the piece as it was. After an edit it has to be accepted again.
    if (current && (current.slot !== next.slot || current.colorFamily !== next.colorFamily)) next.standInId = undefined;
    const pieces = current ? look.pieces.map((p) => (p.id === current.id ? next : p)) : [...look.pieces, next];
    return renameIfDefault(look, { ...look, pieces: sortPieces(pieces) });
  });
}

export function removeLookPiece(lookId: string, pieceId: string): Promise<SavedLook> {
  return change(lookId, (look) => {
    const pieces = look.pieces.filter((p) => p.id !== pieceId);
    return renameIfDefault(look, { ...look, pieces, confirmedAt: pieces.length === 0 ? undefined : look.confirmedAt });
  });
}

/**
 * Takes in the cloud model's reading. It replaces an earlier reading, keeps
 * every piece the owner wrote or edited, and waits for the owner's check.
 */
export function applyReading(lookId: string, read: { pieces: LookPiece[]; account?: string }, reading: LookReading): Promise<SavedLook> {
  return change(lookId, (look) => {
    const mine = look.pieces.filter((p) => p.from === 'you');
    const taken = new Set(mine.map((p) => p.slot));
    // Where the owner already described a slot, their word stands.
    const proposed = read.pieces.filter((p) => !taken.has(p.slot) || p.slot === 'accessory');
    const next = { ...look, pieces: sortPieces([...mine, ...proposed]), reading, confirmedAt: undefined };
    // The account name on a screenshot is only a suggestion. It never ties the look to a post.
    return renameIfDefault(look, { ...next, creator: look.creator ?? read.account });
  });
}

/** The owner has checked the pieces. From here the look is matched to the wardrobe. */
export function confirmLook(lookId: string): Promise<SavedLook> {
  return change(lookId, (look) => {
    if (look.pieces.length === 0) throw new Error('List at least one piece first.');
    return { ...look, confirmedAt: nowIso() };
  });
}

/** Keep or drop a piece in the owner's version, whatever the rules say. Nothing given hands it back to the rules. */
export function setPieceChoice(lookId: string, pieceId: string, choice: LookPiece['choice']): Promise<SavedLook> {
  return change(lookId, (look) => ({ ...look, pieces: look.pieces.map((p) => (p.id === pieceId ? { ...p, choice } : p)) }));
}

/** Accepts an owned piece as close enough for a piece of the look, or takes that back. */
export function setStandIn(lookId: string, pieceId: string, ownedId: string | undefined): Promise<SavedLook> {
  return change(lookId, (look) => ({ ...look, pieces: look.pieces.map((p) => (p.id === pieceId ? { ...p, standInId: ownedId } : p)) }));
}

export async function listLookPhotos(lookId: string): Promise<Photo[]> {
  const photos = await db.photos.where('pieceId').equals(lookPhotoOwner(lookId)).toArray();
  return photos.sort((a, b) => a.order - b.order);
}

/** Adds screenshots, up to the limit. Returns how many were taken. */
export async function addLookPhotos(lookId: string, images: ProcessedImage[]): Promise<number> {
  return db.transaction('rw', db.looks, db.photos, async () => {
    if (!(await db.looks.get(lookId))) throw new Error('That look is no longer saved.');
    const kept = await db.photos.where('pieceId').equals(lookPhotoOwner(lookId)).toArray();
    const room = Math.max(0, MAX_SCREENSHOTS - kept.length);
    let order = kept.reduce((max, p) => Math.max(max, p.order), -1) + 1;
    const now = nowIso();
    const rows: Photo[] = images.slice(0, room).map((image) => ({
      id: newId(),
      pieceId: lookPhotoOwner(lookId),
      kind: 'inspiration',
      order: order++,
      createdAt: now,
      ...image,
    }));
    await db.photos.bulkAdd(rows);
    if (rows.length > 0) await db.looks.update(lookId, { updatedAt: now });
    return rows.length;
  });
}

/**
 * Takes a screenshot out of the inbox and adds it to a look. With no look
 * named, it starts a new one, which has no link and so is tied to no post.
 */
export async function attachInboxScreenshot(inboxId: string, lookId?: string): Promise<SavedLook> {
  const item = await getInboxItem(inboxId);
  if (!item?.image) throw new Error('That screenshot is no longer in your inbox.');
  const { mimeType, width, height, data, thumb } = item.image;
  const look = lookId ? await getLook(lookId) : (await createLook({}, item.receivedAt)).look;
  if (!look) throw new Error('That look is no longer saved.');
  const taken = await addLookPhotos(look.id, [{ mimeType, width, height, data, thumb }]);
  if (taken === 0) throw new Error(`That look already has ${MAX_SCREENSHOTS} screenshots. Remove one first, or pick another look.`);
  await removeInboxItem(inboxId);
  return look;
}

export async function removeLookPhoto(photoId: string): Promise<void> {
  await db.photos.delete(photoId);
}

/** The first screenshot of each look and how many it has, for the list. */
export async function lookCovers(): Promise<Map<string, { cover: Photo; count: number }>> {
  const covers = new Map<string, { cover: Photo; count: number }>();
  await db.photos.where('pieceId').startsWith(LOOK_PHOTO_PREFIX).each((photo) => {
    const lookId = photo.pieceId.slice(LOOK_PHOTO_PREFIX.length);
    const current = covers.get(lookId);
    if (!current) covers.set(lookId, { cover: photo, count: 1 });
    else covers.set(lookId, { cover: photo.order < current.cover.order ? photo : current.cover, count: current.count + 1 });
  });
  return covers;
}

export async function deleteLook(id: string): Promise<void> {
  await db.transaction('rw', db.looks, db.photos, async () => {
    await db.photos.where('pieceId').equals(lookPhotoOwner(id)).delete();
    await db.looks.delete(id);
  });
}

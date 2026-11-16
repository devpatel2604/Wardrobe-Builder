import { db, newId, nowIso } from './db';
import type { OutfitIds, OutfitLogEntry, Rating, SkipReason } from '../domain/outfits/records';
import { outfitKey } from '../domain/outfits/traits';
import type { Occasion, Outfit } from '../domain/outfits/types';

export function toIds(outfit: Outfit): OutfitIds {
  return {
    mainTop: outfit.mainTop.id,
    underLayer: outfit.underLayer?.id,
    trousers: outfit.trousers.id,
    shoes: outfit.shoes.id,
    thirdLayer: outfit.thirdLayer?.id,
    coat: outfit.coat?.id,
    belt: outfit.belt?.id,
  };
}

function idList(ids: OutfitIds): string[] {
  return Object.values(ids).filter((id): id is string => typeof id === 'string');
}

/** The newest entries, enough for rotation and the small tallies. */
export async function recentLog(limit = 200): Promise<OutfitLogEntry[]> {
  return db.outfitLog.orderBy('date').reverse().limit(limit).toArray();
}

async function bumpWear(ids: OutfitIds, by: number): Promise<void> {
  await db.pieces
    .where('id')
    .anyOf(idList(ids))
    .modify((piece) => {
      piece.wearCount = Math.max(0, piece.wearCount + by);
    });
}

interface Answer {
  date: string;
  occasion: Occasion;
  outfit: Outfit;
}

/** "Wore it": logs the outfit and adds one wear to each of its pieces. One per day and occasion. */
export async function logWore({ date, occasion, outfit }: Answer, swapped: boolean): Promise<OutfitLogEntry> {
  return db.transaction('rw', db.outfitLog, db.pieces, async () => {
    const earlier = await db.outfitLog
      .where('date')
      .equals(date)
      .and((e) => e.occasion === occasion && e.action === 'wore')
      .toArray();
    for (const entry of earlier) {
      await bumpWear(entry.pieces, -1);
      await db.outfitLog.delete(entry.id);
    }
    const entry: OutfitLogEntry = {
      id: newId(),
      date,
      occasion,
      action: 'wore',
      outfitKey: outfitKey(outfit),
      pieces: toIds(outfit),
      swapped: swapped || undefined,
      createdAt: nowIso(),
    };
    await db.outfitLog.add(entry);
    await bumpWear(entry.pieces, 1);
    return entry;
  });
}

/** "Not today": the outfit is passed over for that day, with an optional reason. */
export async function logNotToday({ date, occasion, outfit }: Answer, reason?: SkipReason): Promise<OutfitLogEntry> {
  const entry: OutfitLogEntry = {
    id: newId(),
    date,
    occasion,
    action: 'not-today',
    outfitKey: outfitKey(outfit),
    pieces: toIds(outfit),
    reason,
    createdAt: nowIso(),
  };
  await db.outfitLog.add(entry);
  return entry;
}

export async function setReason(id: string, reason: SkipReason | undefined): Promise<void> {
  await db.outfitLog.update(id, { reason });
}

export async function setRating(id: string, rating: Rating | undefined): Promise<void> {
  await db.outfitLog.update(id, { rating });
}

/** Takes an answer back. A wear is also taken off each piece. */
export async function undoEntry(id: string): Promise<void> {
  await db.transaction('rw', db.outfitLog, db.pieces, async () => {
    const entry = await db.outfitLog.get(id);
    if (!entry) return;
    if (entry.action === 'wore') await bumpWear(entry.pieces, -1);
    await db.outfitLog.delete(id);
  });
}

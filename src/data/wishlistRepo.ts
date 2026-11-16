import { readWithAi, type AiAnswer } from './ai';
import { db, newId, nowIso } from './db';
import { connectBuyList } from './lookWishes';
import type { FitCheck } from '../domain/buyNext/fitCheck';
import { leadToOption, pageKey, type LeadsRequest, type LeadsResult } from '../domain/buyNext/leads';
import type { LookWish, Purchase, StoreCheck, WishItem, WishOption, WishSpec } from '../domain/buyNext/types';
import { specFromLook, wishKey } from '../domain/buyNext/wishes';
import type { Piece } from '../domain/types';

/**
 * The buy-next list on the phone: needed pieces, each with the products found
 * for it. The score (src/domain/buyNext) ranks the open lines. This module
 * only stores them.
 */

/** Every line: open, bought and dropped. */
export async function listWishes(): Promise<WishItem[]> {
  const items = await db.wishlist.toArray();
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
}

export async function getWish(id: string): Promise<WishItem | undefined> {
  return db.wishlist.get(id);
}

/** What the "needed piece" form edits. */
export type WishDraft = Pick<WishItem, 'name' | 'spec' | 'origin'> &
  Partial<Pick<WishItem, 'lookFor' | 'sizeLabel' | 'beyondSource' | 'why' | 'wearsPerWeek' | 'holdUntil' | 'afterItemId' | 'holdReason' | 'lookIds'>>;

function text(value: string | undefined): string | undefined {
  return value && value.trim() ? value.trim() : undefined;
}

function cleanSpec(spec: WishSpec): WishSpec {
  return { ...spec, tags: [...new Set(spec.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))] };
}

function cleanDraft(draft: WishDraft): WishDraft {
  const name = draft.name.trim();
  if (!name) throw new Error('A needed piece needs a name.');
  if (draft.spec.slots.length === 0) throw new Error('Pick where the piece goes in an outfit.');
  return {
    ...draft,
    name,
    spec: cleanSpec(draft.spec),
    lookFor: text(draft.lookFor),
    why: text(draft.why),
    holdUntil: text(draft.holdUntil),
    holdReason: text(draft.holdReason),
    beyondSource: draft.origin === 'beyond-looks' ? draft.beyondSource : undefined,
  };
}

export async function createWish(draft: WishDraft): Promise<WishItem> {
  const now = nowIso();
  const item: WishItem = { ...cleanDraft(draft), id: newId(), options: [], state: 'open', createdAt: now, updatedAt: now };
  await db.wishlist.add(item);
  return item;
}

async function change(id: string, edit: (item: WishItem) => WishItem): Promise<WishItem> {
  return db.transaction('rw', db.wishlist, async () => {
    const current = await db.wishlist.get(id);
    if (!current) throw new Error('That piece is no longer on the list.');
    const next = { ...edit(current), id, updatedAt: nowIso() };
    await db.wishlist.put(next);
    return next;
  });
}

export async function updateWish(id: string, draft: WishDraft): Promise<WishItem> {
  const clean = cleanDraft(draft);
  return change(id, (item) => ({ ...item, ...clean }));
}

/** Takes a line off the list without deleting it, so it can be put back. */
export function dropWish(id: string): Promise<WishItem> {
  return change(id, (item) => ({ ...item, state: 'dropped' }));
}

export function reopenWish(id: string): Promise<WishItem> {
  return change(id, (item) => ({ ...item, state: 'open' }));
}

export async function deleteWish(id: string): Promise<void> {
  await db.wishlist.delete(id);
}

/* Products under a line */

export type OptionDraft = Omit<WishOption, 'id' | 'addedOn' | 'check' | 'source'> & Partial<Pick<WishOption, 'source'>>;

function cleanOption(draft: OptionDraft): OptionDraft {
  const name = draft.name.trim();
  const store = draft.store.trim();
  if (!name) throw new Error('A product needs a name.');
  if (!store) throw new Error('Say which store it is from.');
  const url = text(draft.url);
  if (url && !pageKey(url)) throw new Error('The link must be a full address that starts with https://');
  return { ...draft, name, store, url, priceText: text(draft.priceText), givesUp: text(draft.givesUp), note: text(draft.note) };
}

export async function addOption(itemId: string, draft: OptionDraft, today: string): Promise<WishItem> {
  const option: WishOption = { source: 'you', ...cleanOption(draft), id: newId(), addedOn: today };
  return change(itemId, (item) => ({ ...item, options: [...withOnePick(item.options, option), option] }));
}

export async function updateOption(itemId: string, optionId: string, draft: OptionDraft): Promise<WishItem> {
  const clean = cleanOption(draft);
  return change(itemId, (item) => ({
    ...item,
    options: item.options.map((o) => (o.id === optionId ? { ...o, ...clean } : clean.chosen ? { ...o, chosen: false } : o)),
  }));
}

/** Only one product on a line is the owner's pick. */
function withOnePick(options: WishOption[], incoming: Pick<WishOption, 'chosen'>): WishOption[] {
  return incoming.chosen ? options.map((o) => ({ ...o, chosen: false })) : options;
}

export function removeOption(itemId: string, optionId: string): Promise<WishItem> {
  return change(itemId, (item) => ({ ...item, options: item.options.filter((o) => o.id !== optionId) }));
}

/** "This is the one I want": marks one product as the pick, or clears the pick. */
export function chooseOption(itemId: string, optionId: string | undefined): Promise<WishItem> {
  return change(itemId, (item) => ({ ...item, options: item.options.map((o) => ({ ...o, chosen: o.id === optionId })) }));
}

/**
 * Records what the owner saw on the store's own page. A later look replaces
 * the earlier one, so a product only ever shows its newest check.
 */
export function recordCheck(itemId: string, optionId: string, check: StoreCheck): Promise<WishItem> {
  return change(itemId, (item) => ({ ...item, options: item.options.map((o) => (o.id === optionId ? { ...o, check } : o)) }));
}

/* Bought it, and the fit check */

export interface BoughtResult {
  item: WishItem;
  piece: Piece;
}

/**
 * "Bought it": the piece moves to the wardrobe with the tags of its spec, and
 * the line leaves the list. The tags start as unconfirmed, because the real
 * thing may differ from the spec: the owner checks them against the care label.
 */
export async function markBought(itemId: string, purchase: Purchase): Promise<BoughtResult> {
  return db.transaction('rw', db.wishlist, db.pieces, async () => {
    const item = await db.wishlist.get(itemId);
    if (!item) throw new Error('That piece is no longer on the list.');
    if (item.state === 'bought') throw new Error('That piece is already in your wardrobe.');
    const option = item.options.find((o) => o.id === purchase.optionId);
    const now = nowIso();
    const piece: Piece = {
      ...item.spec,
      id: newId(),
      name: item.name,
      brand: undefined,
      status: 'owned',
      link: option?.url,
      pricePaid: purchase.pricePaid,
      acquiredOn: purchase.on,
      notes: option ? `${option.name}, ${option.store}.` : undefined,
      wearCount: 0,
      detailsConfirmed: false,
      createdAt: now,
      updatedAt: now,
    };
    await db.pieces.add(piece);
    const next: WishItem = { ...item, state: 'bought', pieceId: piece.id, bought: purchase, fitCheck: undefined, updatedAt: now };
    await db.wishlist.put(next);
    return { item: next, piece };
  });
}

/** Bought lines whose fit check has not been answered yet, oldest purchase first. */
export async function awaitingFitCheck(): Promise<WishItem[]> {
  const bought = await db.wishlist.where('state').equals('bought').toArray();
  return bought.filter((item) => !item.fitCheck).sort((a, b) => (a.bought?.on ?? '').localeCompare(b.bought?.on ?? ''));
}

/**
 * Saves the fit check. "Keep" and "tailor" leave the piece in the wardrobe.
 * "Return" takes it out again and puts the line back on the list, with a note
 * on the product that went back so it is not bought twice.
 */
export async function saveFitCheck(itemId: string, check: FitCheck): Promise<WishItem> {
  return db.transaction('rw', db.wishlist, db.pieces, db.photos, async () => {
    const item = await db.wishlist.get(itemId);
    if (!item) throw new Error('That piece is no longer on the list.');
    const now = nowIso();
    if (check.verdict !== 'return') {
      const next: WishItem = { ...item, fitCheck: check, updatedAt: now };
      await db.wishlist.put(next);
      if (item.pieceId && check.verdict === 'tailor') {
        await db.pieces.where('id').equals(item.pieceId).modify((piece) => {
          piece.notes = [piece.notes, `Fit check ${check.on}: needs a tailor.${check.note ? ` ${check.note}` : ''}`].filter(Boolean).join(' ');
          piece.updatedAt = now;
        });
      }
      return next;
    }
    if (item.pieceId) {
      await db.photos.where('pieceId').equals(item.pieceId).delete();
      await db.pieces.delete(item.pieceId);
    }
    const reason = `Bought and sent back after the fit check on ${check.on}.${check.note ? ` ${check.note}` : ''}`;
    const next: WishItem = {
      ...item,
      state: 'open',
      pieceId: undefined,
      bought: undefined,
      fitCheck: undefined,
      options: item.options.map((o) => (o.id === item.bought?.optionId ? { ...o, chosen: false, note: [o.note, reason].filter(Boolean).join(' ') } : o)),
      updatedAt: now,
    };
    await db.wishlist.put(next);
    return next;
  });
}

/* Pieces missing from saved looks */

/**
 * Adds the pieces a saved look is missing. When an open line already asks for
 * the same thing, the look is attached to that line and no second line is made.
 * Returns one line for each piece handed in, in the same order.
 */
export async function addWishes(wishes: LookWish[]): Promise<WishItem[]> {
  return db.transaction('rw', db.wishlist, async () => {
    const open = (await db.wishlist.toArray()).filter((item) => item.state === 'open');
    const result: WishItem[] = [];
    for (const wish of wishes) {
      const spec = specFromLook(wish);
      const name = wish.name.trim();
      if (!name) throw new Error('A needed piece needs a name.');
      const key = wishKey({ name, spec });
      const now = nowIso();
      const same = open.find((item) => wishKey(item) === key);
      if (same) {
        if (!same.lookIds?.includes(wish.lookId)) {
          same.lookIds = [...(same.lookIds ?? []), wish.lookId];
          same.updatedAt = now;
          await db.wishlist.put(same);
        }
        result.push(same);
        continue;
      }
      const item: WishItem = {
        id: newId(),
        name,
        lookFor: text(wish.note),
        spec,
        origin: 'your-looks',
        lookIds: [wish.lookId],
        options: [],
        state: 'open',
        createdAt: now,
        updatedAt: now,
      };
      await db.wishlist.add(item);
      open.push(item);
      result.push(item);
    }
    return result;
  });
}

/**
 * Detaches a saved look from the list, for when the look is deleted or broken
 * down again. Lines named in `keep` stay attached. A line that came only from
 * this look and has no products under it is deleted. Any other line just
 * loses the look.
 */
export async function removeLookFromWishes(lookId: string, keep: string[] = []): Promise<void> {
  await db.transaction('rw', db.wishlist, async () => {
    const items = await db.wishlist.toArray();
    for (const item of items) {
      if (!item.lookIds?.includes(lookId) || keep.includes(item.id)) continue;
      const rest = item.lookIds.filter((id) => id !== lookId);
      if (rest.length === 0 && item.options.length === 0 && item.state === 'open') {
        await db.wishlist.delete(item.id);
      } else {
        await db.wishlist.put({ ...item, lookIds: rest.length > 0 ? rest : undefined, updatedAt: nowIso() });
      }
    }
  });
}

/* Find options */

export interface FoundOptions {
  item: WishItem;
  /** Products added to the line. */
  added: number;
  result: LeadsResult;
  today: AiAnswer<LeadsResult>['today'];
}

/**
 * "Find options": asks the server for leads from the AI provider's web search
 * and stores them under the line, marked as AI leads with no store check.
 * A link that is already on the line is not added twice.
 */
export async function findOptions(itemId: string, request: LeadsRequest, today: string): Promise<FoundOptions> {
  const answer = await readWithAi<LeadsResult>('leads', request);
  let added = 0;
  const item = await change(itemId, (current) => {
    const have = new Set(current.options.map((o) => (o.url ? pageKey(o.url) : undefined)).filter(Boolean));
    const fresh = answer.result.leads.filter((lead) => !have.has(pageKey(lead.url)));
    added = fresh.length;
    return { ...current, options: [...current.options, ...fresh.map((lead) => leadToOption(lead, newId(), today))] };
  });
  return { item, added, result: answer.result, today: answer.today };
}

// The saved-look screens send their missing pieces here. They are written
// against a small interface, so they do not depend on this module.
connectBuyList({ addWishes, removeLookFromWishes, listWishes });

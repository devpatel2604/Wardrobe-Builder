import { db } from './db';
import { getLook } from './looksRepo';
import { listPieces } from './piecesRepo';
import { getProfile } from './profileRepo';
import { matchLook, specFromMatch, type PieceMatch, type SavedLook } from '../domain/looks';
import type { ColorFamily, Depth, DressLevel, Neckline, Slot, Texture } from '../domain/types';

/**
 * The bridge from a saved look to the buy list. The list itself belongs to
 * the Buy next screen. A missing piece is sent as a spec marked with the look
 * it completes, and each piece remembers the line it went to, so the line can
 * be let go when the piece is no longer missing.
 *
 * The buy list plugs in through connectBuyList. Until it has, nothing is
 * sent and the look's screen leaves its buy-list buttons out.
 */

/** A piece to find, as the buy list takes it. */
export interface LookWish {
  slot: Slot;
  name: string;
  colorFamily?: ColorFamily;
  depth?: Depth;
  texture?: Texture;
  neckline?: Neckline;
  dressLevel?: DressLevel;
  tags: string[];
  note?: string;
  lookId: string;
}

/** What this bridge needs to know of a line on the buy list. */
export interface BuyListLine {
  id: string;
  /** "open" while the piece is still to be bought. */
  state: string;
}

export interface BuyList {
  /** Adds the pieces, or joins each to an open line for the same thing. Returns one line per piece, in order. */
  addWishes(items: LookWish[]): Promise<BuyListLine[]>;
  /** Lets go of every line this look asked for, apart from the ids in keep. */
  removeLookFromWishes(lookId: string, keep?: string[]): Promise<void>;
  listWishes(): Promise<BuyListLine[]>;
}

let buyList: BuyList | undefined;

/** Called once by the buy list's own module when the app starts. Nothing given unplugs it. */
export function connectBuyList(list: BuyList | undefined): void {
  buyList = list;
}

export function buyListReady(): boolean {
  return buyList !== undefined;
}

async function currentMatch(look: SavedLook) {
  const [profile, pieces] = await Promise.all([getProfile(), listPieces()]);
  return matchLook(look, profile?.rules ?? [], pieces);
}

async function send(look: SavedLook, matches: PieceMatch[]): Promise<number> {
  const fresh = matches.filter((m) => m.toFind);
  if (!buyList || fresh.length === 0) return 0;
  const lines = await buyList.addWishes(
    fresh.map((m) => {
      const spec = specFromMatch(m);
      return {
        slot: spec.slot,
        name: spec.spec,
        colorFamily: spec.colorFamily,
        depth: spec.depth,
        texture: spec.texture,
        neckline: spec.neckline,
        dressLevel: spec.dressLevel,
        tags: spec.tags,
        note: spec.note,
        lookId: look.id,
      };
    }),
  );
  const wishOf = new Map(fresh.map((m, i) => [m.wanted.id, lines[i]?.id]));
  await db.looks.update(look.id, {
    pieces: look.pieces.map((p) => (wishOf.get(p.id) ? { ...p, wishId: wishOf.get(p.id) } : p)),
  });
  return fresh.length;
}

/** Sends every main piece that is still to be found to the buy list. Returns how many went. */
export async function sendMissingToBuyList(lookId: string): Promise<number> {
  const look = await getLook(lookId);
  if (!look?.confirmedAt) return 0;
  const match = await currentMatch(look);
  return send(look, match.missing);
}

/** Sends one piece, such as a belt the owner wants as well. */
export async function sendPieceToBuyList(lookId: string, pieceId: string): Promise<number> {
  const look = await getLook(lookId);
  if (!look?.confirmedAt) return 0;
  const match = await currentMatch(look);
  return send(look, match.lines.filter((l) => l.wanted.id === pieceId));
}

/**
 * Call after a look changes. A piece that is no longer to be found (it was
 * edited, left out, matched, or the owner accepted a stand-in) lets go of its
 * line on the buy list. A line that came only from this look then goes away.
 */
export async function syncLookWishes(lookId: string): Promise<void> {
  const look = await getLook(lookId);
  if (!buyList || !look) return;
  if (!look.pieces.some((p) => p.wishId)) return;
  const match = await currentMatch(look);
  const stillToFind = new Set(match.lines.filter((l) => l.toFind).map((l) => l.wanted.id));
  const keep = look.pieces.filter((p) => p.wishId && stillToFind.has(p.id)).map((p) => p.wishId!);
  await buyList.removeLookFromWishes(lookId, keep);
  if (look.pieces.some((p) => p.wishId && !stillToFind.has(p.id))) {
    await db.looks.update(lookId, { pieces: look.pieces.map((p) => (p.wishId && !stillToFind.has(p.id) ? { ...p, wishId: undefined } : p)) });
  }
}

/** Call when a look is deleted. */
export async function dropLookFromBuyList(lookId: string): Promise<void> {
  await buyList?.removeLookFromWishes(lookId);
}

/** The ids of buy-list lines that are still open, to tell "on your buy list" from a line that has since gone. */
export async function openWishIds(): Promise<Set<string>> {
  if (!buyList) return new Set();
  return new Set((await buyList.listWishes()).filter((w) => w.state === 'open').map((w) => w.id));
}

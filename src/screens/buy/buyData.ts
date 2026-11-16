import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { listLooks } from '../../data/looksRepo';
import { listPieces } from '../../data/piecesRepo';
import { getProfile } from '../../data/profileRepo';
import { listWishes } from '../../data/wishlistRepo';
import { rankWishlist, type BuyRanking, type RankedWish } from '../../domain/buyNext/score';
import type { WishItem } from '../../domain/buyNext/types';
import { priceOf, standingOf } from '../../domain/buyNext/wishes';
import { formulasWithLooks, type SavedLook } from '../../domain/looks';
import type { Piece, Profile } from '../../domain/types';

export interface BuyData {
  profile: Profile;
  pieces: Piece[];
  wishes: WishItem[];
  /** Saved inspiration. A confirmed look counts as a saved look in the score. */
  looks: SavedLook[];
}

/** Everything the Buy next screens read, kept current as the database changes. */
export function useBuyData(): BuyData | undefined {
  return useLiveQuery(async () => {
    const [profile, pieces, wishes, looks] = await Promise.all([getProfile(), listPieces(), listWishes(), listLooks()]);
    return profile ? { profile, pieces, wishes, looks } : undefined;
  }, []);
}

/** The list in buying order for a day. Worked out again only when the data changes. */
export function useRanking(data: BuyData | undefined, today: string): BuyRanking | undefined {
  return useMemo(() => {
    if (!data) return undefined;
    return rankWishlist({
      items: data.wishes,
      pieces: data.pieces,
      rules: data.profile.rules,
      palette: data.profile.palette,
      formulas: formulasWithLooks(data.profile.formulas ?? [], data.looks, data.profile.rules),
      date: today,
      lat: data.profile.home.point?.lat,
      officeDays: data.profile.week.officeDays.length,
    });
  }, [data, today]);
}

/** New outfits a piece adds once the pieces above it are bought, dry days only. */
export function outfitsAdded(ranked: RankedWish): number {
  return Math.round(ranked.inOrder.filter((g) => !g.wet).reduce((sum, g) => sum + g.added, 0));
}

/** The price a line would cost: the product to buy, when there is one with a price. */
export function priceToPay(item: WishItem): number | undefined {
  const pick = standingOf(item).pick;
  return pick ? priceOf(pick) : undefined;
}

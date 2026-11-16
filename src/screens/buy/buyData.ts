import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { listPieces } from '../../data/piecesRepo';
import { getProfile } from '../../data/profileRepo';
import { listWishes } from '../../data/wishlistRepo';
import { LEADS_LIMITS, type LeadsRequest } from '../../domain/buyNext/leads';
import { rankWishlist, type BuyRanking, type RankedWish } from '../../domain/buyNext/score';
import type { WishItem } from '../../domain/buyNext/types';
import { priceOf, standingOf } from '../../domain/buyNext/wishes';
import type { Piece, Profile } from '../../domain/types';

export interface BuyData {
  profile: Profile;
  pieces: Piece[];
  wishes: WishItem[];
}

/** Everything the Buy next screens read, kept current as the database changes. */
export function useBuyData(): BuyData | undefined {
  return useLiveQuery(async () => {
    const [profile, pieces, wishes] = await Promise.all([getProfile(), listPieces(), listWishes()]);
    return profile ? { profile, pieces, wishes } : undefined;
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
      formulas: data.profile.formulas ?? [],
      date: today,
      lat: data.profile.home.point?.lat,
      officeDays: data.profile.week.officeDays.length,
    });
  }, [data, today]);
}

/** The owner's size for a line, such as "Pants 30 × 30". */
export function sizeFor(item: Pick<WishItem, 'sizeLabel'>, profile: Profile): { label: string; value: string } | undefined {
  const entry = profile.sizes.find((s) => s.label === item.sizeLabel);
  return entry ? { label: entry.label, value: entry.value } : undefined;
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

/** What "find options" sends: the piece, the size, the stores and the rules. Nothing else about the owner. */
export function leadsRequest(item: WishItem, profile: Profile): LeadsRequest {
  const cut = (text: string) => text.slice(0, LEADS_LIMITS.listItemChars);
  const size = sizeFor(item, profile);
  const lookFor = [item.lookFor, item.spec.cloth ? `Cloth: ${item.spec.cloth}.` : undefined].filter(Boolean).join(' ');
  return {
    name: item.name.slice(0, LEADS_LIMITS.name),
    lookFor: lookFor ? lookFor.slice(0, LEADS_LIMITS.lookFor) : undefined,
    size: size ? `${size.label} ${size.value}`.slice(0, LEADS_LIMITS.size) : undefined,
    stores: profile.stores.slice(0, LEADS_LIMITS.listItems).map((s) => cut(s.name)),
    rules: profile.rules
      .filter((r) => r.kind === 'hard' || r.kind === 'default')
      .slice(0, LEADS_LIMITS.listItems)
      .map((r) => cut(r.text)),
    have: item.options.slice(0, LEADS_LIMITS.listItems).map((o) => cut(`${o.name} (${o.store})`)),
  };
}

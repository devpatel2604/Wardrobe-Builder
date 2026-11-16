import { colorGroup } from '../outfits/traits';
import type { Piece, StoreEntry } from '../types';
import { kindOf } from './score';
import type { LookWish, StockSeen, WishItem, WishOption, WishSpec } from './types';

/**
 * Plain helpers for the buy-next list: telling two list lines apart, the
 * state of a line, the dated status of a product, and the links that open a
 * store's own search. Nothing here loads a store page.
 */

/**
 * Two lines with the same key ask for the same thing: the same place in an
 * outfit, the same color group, the same neckline for a top, and the same
 * kind of garment where the name says one (jeans, sneaker, boot, loafer, coat).
 */
export function wishKey(item: { name: string; spec: Pick<WishSpec, 'slots' | 'colorFamily' | 'neckline' | 'tags'> }): string {
  const slot = item.spec.slots[0] ?? 'accessory';
  const isTop = slot === 'main-top' || slot === 'under-layer';
  const color = colorGroup(item.spec as Piece) ?? 'any';
  const kind = kindOf({ name: item.name, tags: item.spec.tags, slots: item.spec.slots, neckline: item.spec.neckline }) ?? '';
  return [slot, color, isTop ? (item.spec.neckline ?? '') : '', kind].join('|');
}

/** The tags of a piece that is missing from a saved look. Only what a picture shows. */
export function specFromLook(wish: LookWish): WishSpec {
  return {
    slots: [wish.slot],
    colorFamily: wish.colorFamily,
    depth: wish.depth,
    texture: wish.texture,
    neckline: wish.neckline,
    dressLevel: wish.dressLevel,
    tags: [...new Set(wish.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
  };
}

/* Dates */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 15", with the year when it is not this year. */
export function monthDay(key: string, today?: string): string {
  const [year, month, day] = key.split('-').map(Number);
  const text = `${MONTHS[(month ?? 1) - 1] ?? ''} ${day ?? ''}`.trim();
  return today && today.slice(0, 4) !== String(year) ? `${text}, ${year}` : text;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A check older than this is shown as old. A working value. */
export const CHECK_OLD_AFTER_DAYS = 7;

/* The status of one product */

export function priceOf(option: WishOption): number | undefined {
  return option.check?.price ?? option.price;
}

export function money(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export function priceText(option: WishOption): string | undefined {
  const price = priceOf(option);
  return price !== undefined ? money(price) : option.priceText;
}

const GONE: StockSeen[] = ['sold-out-in-size', 'sold-out', 'no-longer-made'];

export function isUnavailable(option: WishOption): boolean {
  return option.check?.stock !== undefined && GONE.includes(option.check.stock);
}

export interface CheckLine {
  text: string;
  /** True when nobody has looked at the store page, or the look is old. */
  weak: boolean;
}

/** "Price seen Nov 15, size not checked." Every statement about a store carries its date. */
export function checkLine(option: WishOption, today: string): CheckLine {
  const check = option.check;
  if (!check) {
    if (option.source === 'ai-lead') {
      return { text: `AI lead from ${monthDay(option.addedOn, today)}. Nobody has opened the page: the price, the size and even the link may be wrong.`, weak: true };
    }
    return { text: 'Not checked at the store yet.', weak: true };
  }
  const day = monthDay(check.on, today);
  const parts: string[] = [];
  const size = check.size ? ` in ${check.size}` : '';
  switch (check.stock) {
    case 'in-stock':
      parts.push(`in stock${size}`);
      break;
    case 'low-stock':
      parts.push(`low stock${size}`);
      break;
    case 'sold-out-in-size':
      parts.push(`sold out${size || ' in your size'}`);
      break;
    case 'sold-out':
      parts.push('sold out');
      break;
    case 'no-longer-made':
      parts.push('no longer made');
      break;
    default:
      parts.push('size not checked');
  }
  if (check.pickup === 'today') parts.push('pickup today at your store');
  else if (check.pickup === 'ship-to-store') parts.push('ships to your store');
  else if (check.pickup === 'none') parts.push('no store pickup');
  const price = check.price !== undefined ? `Price seen ${day}` : `Seen ${day}`;
  const age = daysBetween(check.on, today);
  const old = age > CHECK_OLD_AFTER_DAYS;
  const who = check.by === 'research' ? ' by the research, not by you' : '';
  return { text: `${price}${who}, ${parts.join(', ')}.${old ? ` That was ${age} days ago.` : ''}`, weak: old };
}

/* The state of a line */

export type WishStatus =
  | 'buy'
  | 'wait' // sold out in the owner's size
  | 'try-on-first' // a fitting-room decision
  | 'no-longer-made' // the exact item is gone and there is no lookalike
  | 'no-products'; // a spec with nothing under it yet

export interface WishStanding {
  status: WishStatus;
  /** The product to buy, when there is one. */
  pick?: WishOption;
  /** True when every exact item on the line is no longer made. */
  exactGone: boolean;
  text?: string;
}

/** Where a line stands, from what was seen at the stores. */
export function standingOf(item: WishItem): WishStanding {
  const exact = item.options.filter((o) => o.role === 'exact');
  const exactGone = exact.length > 0 && exact.every((o) => o.check?.stock === 'no-longer-made');
  if (item.options.length === 0) return { status: 'no-products', exactGone, text: 'No product under it yet.' };

  const chosen = item.options.find((o) => o.chosen);
  const open = item.options.filter((o) => !isUnavailable(o));
  if (chosen && isUnavailable(chosen) && chosen.check?.stock !== 'no-longer-made') {
    return { status: 'wait', pick: chosen, exactGone, text: `Wait: your pick is sold out${chosen.check?.size ? ` in ${chosen.check.size}` : ' in your size'}.` };
  }
  if (open.length === 0) {
    if (item.options.every((o) => o.check?.stock === 'no-longer-made')) {
      return { status: 'no-longer-made', exactGone, text: 'No longer made, and no lookalike yet.' };
    }
    return { status: 'wait', exactGone, text: 'Wait: sold out in your size.' };
  }
  const pick = (chosen && !isUnavailable(chosen) ? chosen : undefined) ?? open.find((o) => o.role === 'exact') ?? open[0]!;
  if (pick.tryOnFirst) return { status: 'try-on-first', pick, exactGone, text: 'Try it on first. This one is a fitting-room decision.' };
  return { status: 'buy', pick, exactGone, text: exactGone ? 'The exact item is no longer made. These come nearest.' : undefined };
}

/* Cost per wear */

/** Weeks in a first season. */
export const SEASON_WEEKS = 13;

/** A guess, and always shown as one: the price over the wears of a first season. */
export function costPerWear(price: number | undefined, wearsPerWeek: number | undefined): number | undefined {
  if (price === undefined || !wearsPerWeek || wearsPerWeek <= 0) return undefined;
  return price / (wearsPerWeek * SEASON_WEEKS);
}

/* Links that open a store's own search */

/**
 * Each store's public search page, with the words filled in. The owner taps
 * the link and looks. The app never opens these pages itself. Working values:
 * a store can change its address, and then the link lands on its front page.
 */
const STORE_SEARCH: [RegExp, (q: string) => string][] = [
  [/macy/i, (q) => `https://www.macys.com/shop/search?keyword=${q}`],
  [/nordstrom rack/i, (q) => `https://www.nordstromrack.com/sr?keyword=${q}`],
  [/nordstrom/i, (q) => `https://www.nordstrom.com/sr?keyword=${q}`],
  [/banana republic/i, (q) => `https://bananarepublic.gap.com/browse/search.do?searchText=${q}`],
  [/\bgap\b/i, (q) => `https://www.gap.com/browse/search.do?searchText=${q}`],
  [/uniqlo/i, (q) => `https://www.uniqlo.com/us/en/search?q=${q}`],
  [/j\.? ?crew/i, (q) => `https://www.jcrew.com/r/search/?N=0&Ntrm=${q}`],
  [/abercrombie/i, (q) => `https://www.abercrombie.com/shop/us/search?searchTerm=${q}`],
  [/h\s?&\s?m/i, (q) => `https://www2.hm.com/en_us/search-results.html?q=${q}`],
  [/zara/i, (q) => `https://www.zara.com/us/en/search?searchTerm=${q}`],
  [/lululemon/i, (q) => `https://shop.lululemon.com/search?Ntt=${q}`],
  [/suitsupply/i, (q) => `https://suitsupply.com/en-us/search?q=${q}`],
  [/\bboss\b|hugo boss/i, (q) => `https://www.hugoboss.com/us/search?q=${q}`],
  [/ralph lauren|\bpolo\b/i, (q) => `https://www.ralphlauren.com/search?q=${q}`],
];

export interface SearchLink {
  store: string;
  url: string;
}

/** The words to search for: the name of the piece, for men. */
export function searchWords(item: Pick<WishItem, 'name'>): string {
  return `men's ${item.name.charAt(0).toLowerCase()}${item.name.slice(1)}`;
}

/** One search link for each of the owner's stores, in the order of the profile. */
export function searchLinks(item: Pick<WishItem, 'name'>, stores: StoreEntry[]): SearchLink[] {
  const words = encodeURIComponent(searchWords(item));
  const links: SearchLink[] = [];
  for (const store of stores) {
    const known = STORE_SEARCH.find(([pattern]) => pattern.test(store.name));
    // A store without a known search page gets a plain web search for the store and the piece.
    const url = known ? known[1](words) : `https://www.google.com/search?q=${encodeURIComponent(`${store.name} ${searchWords(item)}`)}`;
    links.push({ store: store.name, url });
  }
  return links;
}

/** A link is only ever opened when it is a plain https address. */
export function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

import type { Occasion } from '../outfits/types';
import type { Evidence, LookSource, Piece } from '../types';

/**
 * The buy-next list (design brief, sections 6.4 and 7.4).
 *
 * A needed piece is a spec, not a product: "cream pleated trousers in a winter
 * cloth". The spec carries the same tags as a piece in the wardrobe, so the
 * outfit rules can put it in the wardrobe on paper and count what it adds.
 * Products hang off the spec as options: the exact item and its lookalikes.
 */

/** The tags of the piece as it would sit in the wardrobe. */
export type WishSpec = Pick<
  Piece,
  'slots' | 'colorFamily' | 'colorName' | 'depth' | 'texture' | 'neckline' | 'fit' | 'hem' | 'dressLevel' | 'cloth' | 'hardware' | 'warmth' | 'wetOk' | 'tags'
>;

export type WishState =
  | 'open' // on the list
  | 'bought' // moved to the wardrobe
  | 'dropped'; // taken off the list by the owner

/**
 * Where the idea for a piece comes from. Shown on every piece, and a piece
 * from beyond the saved looks is always flagged (design brief, section 7.3).
 * "Fills a gap" is not an origin: the score works that out from the wardrobe.
 */
export type WishOrigin =
  | 'your-looks' // it is in a look the owner saved, or a creator they follow wears it
  | 'beyond-looks'; // weather, a trend or a suits-you finding

export interface WishItem {
  id: string;
  /** "Cream pleated trousers in a winter cloth" */
  name: string;
  /** What to look for, in the owner's words: cut, cloth, details. */
  lookFor?: string;
  /** Which size applies, as a label from the profile's sizes, such as "Pants". */
  sizeLabel?: string;
  spec: WishSpec;
  origin: WishOrigin;
  /** For a piece from beyond the saved looks: where the idea comes from. */
  beyondSource?: Exclude<LookSource, 'your-looks' | 'test'>;
  /** One or two sentences on why it is here, written when it was added. */
  why?: string;
  /** Wears a week in season, a guess. Used only for the cost-per-wear line. */
  wearsPerWeek?: number;
  /** Do not suggest before this day (YYYY-MM-DD), with the reason. "The white sneaker waits for March." */
  holdUntil?: string;
  /** Do not suggest until this other list piece is bought and has been worn a few times. */
  afterItemId?: string;
  /** The reason for either kind of wait, in a sentence. */
  holdReason?: string;
  /** Where the piece stood on a hand-made list, when there was one. Never used by the score. */
  reportRank?: number;
  /** Saved looks (ids from the inspiration screens) that this piece is missing from. */
  lookIds?: string[];
  options: WishOption[];
  state: WishState;
  /** Set when bought: the wardrobe piece it became. */
  pieceId?: string;
  createdAt: string;
  updatedAt: string;
}

export type OptionRole = 'exact' | 'lookalike';

/** Who put an option on the list. Decides how much its details can be trusted. */
export type OptionSource =
  | 'research' // a research thread read the page
  | 'ai-lead' // "find options": from web search results, never checked against the page
  | 'you'; // the owner added it

/** What the owner, or the research, saw on the store's own page. */
export type StockSeen =
  | 'in-stock'
  | 'low-stock'
  | 'sold-out-in-size'
  | 'sold-out'
  | 'no-longer-made';

export type PickupSeen = 'today' | 'ship-to-store' | 'none';

/** One look at the store page, with its date. A later look replaces it. */
export interface StoreCheck {
  /** YYYY-MM-DD */
  on: string;
  by: 'you' | 'research';
  price?: number;
  stock?: StockSeen;
  /** The size that was looked at. */
  size?: string;
  /** Same-day pickup at the owner's own store. */
  pickup?: PickupSeen;
  note?: string;
}

export interface WishOption {
  id: string;
  role: OptionRole;
  /** The product's name as the store gives it. */
  name: string;
  store: string;
  url?: string;
  /** The single-item price in US dollars, not a sale banner or a multibuy price. */
  price?: number;
  /** A price in another currency, or a range, as text. Shown as it is. */
  priceText?: string;
  /** For a lookalike: what it gives up against the exact item. For an exact item: how it differs from the look. */
  givesUp?: string;
  note?: string;
  /** True when the store is in the owner's mall, so it can be tried on. */
  nearby?: boolean;
  /** The owner's own pick among the options. */
  chosen?: boolean;
  /** "Try on first": a fitting-room decision. */
  tryOnFirst?: boolean;
  source: OptionSource;
  /** YYYY-MM-DD the option was added. For an AI lead, the day of the search. */
  addedOn: string;
  /** Missing until someone has looked at the store page. */
  check?: StoreCheck;
}

/* The score */

export type BuyPartId =
  | 'unlocks' // new outfits, thin cells counting more
  | 'ahead' // what it adds together with the next pieces on the list
  | 'saved-looks' // saved looks it finishes or moves toward
  | 'basic' // a coat or belt the wardrobe lacks, worn with what is already there
  | 'suits-you' // how sure the palette is of the color near the face
  | 'beyond-looks' // from beyond the saved looks
  | 'covered' // something owned already does the job
  | 'price';

export interface BuyPart {
  id: BuyPartId;
  points: number;
  /** A full sentence. Parts without one never show as a reason. */
  text?: string;
  evidence: Evidence;
}

/** New outfits for one occasion in one kind of weather. */
export interface CellGain {
  occasion: Occasion;
  wet: boolean;
  /** Outfits there already. */
  before: number;
  /** Outfits the piece adds on its own. */
  added: number;
}

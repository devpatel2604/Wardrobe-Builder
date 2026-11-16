import { COLOR_FAMILIES, DEPTHS, DRESS_LEVELS, FITS, HARDWARE, NECKLINES, SLOTS, TEXTURES, TOP_SLOTS, WARMTHS, type Option } from './options';
import type { ColorFamily, Depth, DressLevel, Fit, Hardware, Neckline, Slot, Texture, Warmth } from './types';

/**
 * What a cloud model proposes for a piece, from a photo or a store page.
 *
 * A proposal is never saved as it is. The app fills the form with it, marks
 * every field it filled, and the owner confirms or changes each one. The
 * server and the app both use this file, so the lists the model may choose
 * from are the same lists the form shows.
 */

/** What the model was shown. Anything but a garment or a product gets no tags. */
export type ProposalSubject =
  | 'garment' // one piece of clothing, shoes or an accessory
  | 'product-page' // a store page for one product
  | 'worn-by-person' // someone is wearing it
  | 'several-items'
  | 'not-clothing';

/** The fields a proposal can fill. Also the names the model uses in `unsure`. */
export const PROPOSAL_FIELDS = [
  'name',
  'brand',
  'slots',
  'colorFamily',
  'colorName',
  'depth',
  'texture',
  'neckline',
  'fit',
  'dressLevel',
  'cloth',
  'hardware',
  'warmth',
  'wetOk',
  'price',
  'tags',
] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

export interface PieceProposal {
  subject: ProposalSubject;
  name?: string;
  brand?: string;
  slots: Slot[];
  colorFamily?: ColorFamily;
  /** The maker's own word for the color. Only ever read from a page, never from a photo. */
  colorName?: string;
  depth?: Depth;
  texture?: Texture;
  neckline?: Neckline;
  fit?: Fit;
  dressLevel?: DressLevel;
  /** Only ever read from a page or a label. A photo cannot show what a cloth is made of. */
  cloth?: string;
  hardware?: Hardware;
  warmth?: Warmth;
  wetOk?: boolean;
  /** The price shown on the page, in dollars. */
  price?: number;
  tags: string[];
  /** Fields the model filled but was not sure of. */
  unsure: ProposalField[];
  /** One short line for the owner, such as what could not be judged. */
  note?: string;
}

/** A record kept on the piece: what was proposed, by which model, and when. */
export interface TaggingRecord {
  source: 'photo' | 'page';
  model: string;
  /** ISO time of the proposal. */
  at: string;
  proposal: PieceProposal;
}

const SUBJECTS: ProposalSubject[] = ['garment', 'product-page', 'worn-by-person', 'several-items', 'not-clothing'];

function oneOf<T>(options: Option<T>[], value: unknown): T | undefined {
  return options.find((o) => o.value === value)?.value;
}

function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

/**
 * Tidies whatever the server sent into a proposal the form can trust.
 * Anything that is not on the app's own lists is dropped, so a model that
 * invents a value can never put it on a piece.
 */
export function cleanProposal(raw: unknown): PieceProposal {
  const data = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const subject = SUBJECTS.find((s) => s === data.subject) ?? 'not-clothing';
  const slots = Array.isArray(data.slots) ? [...new Set(data.slots.map((s) => oneOf(SLOTS, s)).filter((s): s is Slot => s !== undefined))] : [];
  const isTop = slots.some((s) => TOP_SLOTS.includes(s));
  const tags = Array.isArray(data.tags)
    ? [...new Set(data.tags.map((t) => shortText(t, 30)?.toLowerCase()).filter((t): t is string => t !== undefined))].slice(0, 6)
    : [];
  const price = typeof data.price === 'number' && Number.isFinite(data.price) && data.price > 0 ? Math.round(data.price * 100) / 100 : undefined;
  const proposal: PieceProposal = {
    subject,
    name: shortText(data.name, 80),
    brand: shortText(data.brand, 60),
    slots,
    colorFamily: oneOf(COLOR_FAMILIES, data.colorFamily),
    colorName: shortText(data.colorName, 60),
    depth: oneOf(DEPTHS, data.depth),
    texture: oneOf(TEXTURES, data.texture),
    // Shape tags only make sense on a top, so they are dropped elsewhere.
    neckline: isTop ? oneOf(NECKLINES, data.neckline) : undefined,
    fit: isTop ? oneOf(FITS, data.fit) : undefined,
    dressLevel: oneOf(DRESS_LEVELS, data.dressLevel),
    cloth: shortText(data.cloth, 160),
    hardware: oneOf(HARDWARE, data.hardware),
    warmth: oneOf(WARMTHS, data.warmth),
    wetOk: typeof data.wetOk === 'boolean' ? data.wetOk : undefined,
    price,
    tags,
    unsure: [],
    note: shortText(data.note, 240),
  };
  const filled = filledFields(proposal);
  if (Array.isArray(data.unsure)) {
    proposal.unsure = PROPOSAL_FIELDS.filter((field) => (data.unsure as unknown[]).includes(field) && filled.includes(field));
  }
  return proposal;
}

/** The fields a proposal actually has a value for. */
export function filledFields(proposal: PieceProposal): ProposalField[] {
  return PROPOSAL_FIELDS.filter((field) => {
    const value = proposal[field];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });
}

/** True when the model was shown something it could tag. */
export function isUsable(proposal: PieceProposal): boolean {
  return (proposal.subject === 'garment' || proposal.subject === 'product-page') && proposal.slots.length > 0;
}

/** Why a proposal has no tags, in words for the owner. */
export function subjectProblem(subject: ProposalSubject): string | undefined {
  switch (subject) {
    case 'worn-by-person':
      return 'This looks like a photo of someone wearing the piece. Use a photo of the piece on its own, so no photo of a person leaves your phone.';
    case 'several-items':
      return 'There is more than one piece here. Add them one at a time.';
    case 'not-clothing':
      return 'This does not look like clothing, so there are no tags to suggest.';
    default:
      return undefined;
  }
}

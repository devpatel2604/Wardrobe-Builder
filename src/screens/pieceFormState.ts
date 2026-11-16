import type { InboxItem } from '../domain/inbox';
import { TOP_SLOTS } from '../domain/options';
import { filledFields, isUsable, type PieceProposal, type ProposalField, type TaggingRecord } from '../domain/tagging';
import type { Piece, PieceDraft } from '../domain/types';

/** The form keeps text as typed. It is tidied into a draft on save. */
export interface FormState
  extends Omit<
    PieceDraft,
    'pricePaid' | 'listPrice' | 'listPriceOn' | 'tagging' | 'tags' | 'brand' | 'colorName' | 'cloth' | 'size' | 'link' | 'notes' | 'acquiredOn'
  > {
  brand: string;
  colorName: string;
  cloth: string;
  size: string;
  link: string;
  notes: string;
  acquiredOn: string;
  price: string;
  listPrice: string;
  tagText: string;
}

export function blankForm(): FormState {
  return {
    name: '',
    brand: '',
    status: 'owned',
    slots: [],
    colorName: '',
    cloth: '',
    size: '',
    link: '',
    notes: '',
    acquiredOn: '',
    price: '',
    listPrice: '',
    tagText: '',
    // A piece added by hand has been looked at, so it starts as checked.
    detailsConfirmed: true,
  };
}

export function formFromPiece(piece: Piece): FormState {
  return {
    name: piece.name,
    brand: piece.brand ?? '',
    status: piece.status,
    slots: piece.slots,
    colorFamily: piece.colorFamily,
    colorName: piece.colorName ?? '',
    depth: piece.depth,
    texture: piece.texture,
    neckline: piece.neckline,
    fit: piece.fit,
    hem: piece.hem,
    dressLevel: piece.dressLevel,
    cloth: piece.cloth ?? '',
    hardware: piece.hardware,
    warmth: piece.warmth,
    wetOk: piece.wetOk,
    size: piece.size ?? '',
    link: piece.link ?? '',
    notes: piece.notes ?? '',
    acquiredOn: piece.acquiredOn ?? '',
    price: piece.pricePaid === undefined ? '' : String(piece.pricePaid),
    listPrice: piece.listPrice === undefined ? '' : String(piece.listPrice),
    tagText: piece.tags.join(', '),
    detailsConfirmed: piece.detailsConfirmed,
  };
}

/**
 * Where a value on the form came from, when it was not typed by the owner.
 * Shown as a small mark next to the field, and cleared when the owner changes it.
 */
export type Mark = 'ai' | 'ai-unsure' | 'page-title';
export type Marks = Partial<Record<ProposalField, Mark>>;

export const MARK_WORDS: Record<Mark, string> = {
  ai: 'AI',
  'ai-unsure': 'AI, not sure',
  'page-title': 'From the page title',
};

/** A store's page title is "Name | Store" more often than not. Keeps the name. */
function nameFromTitle(title: string | undefined): string {
  const first = title?.split(/\s[|–—-]\s/)[0]?.trim() ?? '';
  return first.slice(0, 80);
}

/** The form for something from the waiting list, before any AI proposal. */
export function formFromItem(item: InboxItem): { form: FormState; marks: Marks } {
  if (item.kind === 'photo') return { form: blankForm(), marks: {} };
  const name = nameFromTitle(item.title);
  return {
    // A store page is something not bought yet, and nobody has had it in hand.
    form: { ...blankForm(), status: 'considering', link: item.url ?? '', name, detailsConfirmed: false },
    marks: name ? { name: 'page-title' } : {},
  };
}

/** Which form field holds each thing a proposal can fill. */
const FORM_KEY: Record<ProposalField, keyof FormState> = {
  name: 'name',
  brand: 'brand',
  slots: 'slots',
  colorFamily: 'colorFamily',
  colorName: 'colorName',
  depth: 'depth',
  texture: 'texture',
  neckline: 'neckline',
  fit: 'fit',
  dressLevel: 'dressLevel',
  cloth: 'cloth',
  hardware: 'hardware',
  warmth: 'warmth',
  wetOk: 'wetOk',
  price: 'listPrice',
  tags: 'tagText',
};

/** The proposal field a form field belongs to, if any. */
export function fieldOf(key: keyof FormState): ProposalField | undefined {
  return (Object.keys(FORM_KEY) as ProposalField[]).find((field) => FORM_KEY[field] === key);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Puts a model's proposal into the form. It only fills fields that are empty
 * or that still hold something the owner did not type, so nothing the owner
 * entered is ever replaced. Every field it fills gets a mark.
 */
export function applyProposal(form: FormState, marks: Marks, proposal: PieceProposal): { form: FormState; marks: Marks } {
  if (!isUsable(proposal)) return { form, marks };
  const next: Record<string, unknown> = { ...form };
  const nextMarks: Marks = { ...marks };
  let filled = 0;
  for (const field of filledFields(proposal)) {
    const key = FORM_KEY[field];
    if (!isEmpty(form[key]) && !marks[field]) continue;
    next[key] = field === 'price' ? String(proposal.price) : field === 'tags' ? proposal.tags.join(', ') : proposal[field];
    nextMarks[field] = proposal.unsure.includes(field) ? 'ai-unsure' : 'ai';
    filled++;
  }
  // A model's reading is a suggestion until the owner has checked it.
  if (filled > 0) next.detailsConfirmed = false;
  return { form: next as unknown as FormState, marks: nextMarks };
}

export function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

function parsePrice(text: string): number | undefined {
  const price = text.trim() === '' ? undefined : Number(text);
  return price !== undefined && Number.isFinite(price) && price >= 0 ? price : undefined;
}

export interface DraftExtras {
  /** The piece being edited, whose records the form does not show are kept. */
  piece?: Piece;
  /** The AI proposal this new piece started from. */
  tagging?: TaggingRecord;
  /** Today as YYYY-MM-DD, the date put on a newly entered store price. */
  today: string;
}

export function draftFromForm(form: FormState, extras: DraftExtras): PieceDraft {
  const isTop = form.slots.some((s) => TOP_SLOTS.includes(s));
  const { piece } = extras;
  const listPrice = parsePrice(form.listPrice);
  return {
    name: form.name,
    brand: form.brand,
    status: form.status,
    slots: form.slots,
    colorFamily: form.colorFamily,
    colorName: form.colorName,
    depth: form.depth,
    texture: form.texture,
    // Top-only tags are dropped if the piece is no longer a top.
    neckline: isTop ? form.neckline : undefined,
    fit: isTop ? form.fit : undefined,
    hem: isTop ? form.hem : undefined,
    dressLevel: form.dressLevel,
    cloth: form.cloth,
    hardware: form.hardware,
    warmth: form.warmth,
    wetOk: form.wetOk,
    size: form.size,
    link: form.link,
    notes: form.notes,
    acquiredOn: form.acquiredOn,
    pricePaid: parsePrice(form.price),
    listPrice,
    // A price keeps the date it was read on until the price itself changes.
    listPriceOn: listPrice === undefined ? undefined : piece?.listPrice === listPrice && piece.listPriceOn ? piece.listPriceOn : extras.today,
    tags: parseTags(form.tagText),
    detailsConfirmed: form.detailsConfirmed,
    tagging: extras.tagging ?? piece?.tagging,
  };
}

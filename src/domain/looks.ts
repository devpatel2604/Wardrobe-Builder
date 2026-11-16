import { parseSharedLink, sameLink } from './links';
import { HARDWARE, NECKLINES, labelOf } from './options';
import { colorWord, depthOf } from './outfits/traits';
import { checkPiece } from './ruleChecks';
import type { ColorFamily, Depth, DressLevel, Evidence, Fit, Formula, FormulaSlot, Hardware, Hem, Neckline, Piece, PieceMatcher, Rule, Slot, Texture } from './types';

/**
 * Saved inspiration (design brief, section 6.5). A saved look is a link, the
 * owner's own screenshots, and the pieces of the outfit by slot. From those
 * the app works out the owner's version of the look, what in the wardrobe
 * matches it, and what is missing.
 *
 * Everything here is plain rules. A cloud model only proposes the pieces
 * from a screenshot, and the owner confirms them.
 */

/** One piece of a look, as seen in a screenshot. A description, not a product. */
export interface LookPiece {
  id: string;
  slot: Slot;
  /** A short plain name, color first: "Cream cable-knit full-zip cardigan". */
  description: string;
  colorFamily?: ColorFamily;
  depth?: Depth;
  texture?: Texture;
  neckline?: Neckline;
  fit?: Fit;
  hem?: Hem;
  /** What it looks like it is made of. A guess from a picture, never a label. */
  material?: string;
  hardware?: Hardware;
  /** How dressy it is on its own: 1 casual, 2 smart casual, 3 dressy. */
  dressLevel?: DressLevel;
  /** Lower case. */
  tags: string[];
  /** Who wrote this entry: the cloud model's reading, or the owner. */
  from: 'ai' | 'you';
  /** How sure the model was. Dropped once the owner edits the piece. */
  confidence?: 'high' | 'medium' | 'low';
  /** The owner's say on their version. Left out, the rules decide. */
  choice?: 'keep' | 'drop';
  /** An owned piece the owner accepted as close enough. */
  standInId?: string;
  /** The line of the buy list this piece was sent to. */
  wishId?: string;
}

export interface LookReading {
  /** When the cloud model read the screenshots. */
  at: string;
  model?: string;
  /** Anything the model wanted to say about the picture. */
  notes?: string;
}

export interface SavedLook {
  id: string;
  name: string;
  /** The post or page the look comes from. A look is tied to its creator only when this is saved. */
  link?: string;
  /** The creator's handle or name. */
  creator?: string;
  notes?: string;
  pieces: LookPiece[];
  /** When the owner confirmed the pieces. Unset while there is nothing to go on, or a reading waits for a check. */
  confirmedAt?: string;
  reading?: LookReading;
  createdAt: string;
  updatedAt: string;
}

/** Photos of a look are stored in the photos table under this id. */
export const LOOK_PHOTO_PREFIX = 'look:';
export const lookPhotoOwner = (lookId: string) => `${LOOK_PHOTO_PREFIX}${lookId}`;

/** The slots that make up an outfit. A missing piece in one of these is a piece away. */
export const LOOK_CORE_SLOTS: Slot[] = ['main-top', 'under-layer', 'trousers', 'shoes', 'outer-layer'];
/** The order pieces are listed in. */
export const LOOK_SLOT_ORDER: Slot[] = ['outer-layer', 'main-top', 'under-layer', 'trousers', 'shoes', 'belt', 'watch', 'glasses', 'accessory', 'fragrance'];

export function sortPieces<T extends { slot: Slot }>(pieces: T[]): T[] {
  return [...pieces].sort((a, b) => LOOK_SLOT_ORDER.indexOf(a.slot) - LOOK_SLOT_ORDER.indexOf(b.slot));
}

// ---------------------------------------------------------------------------
// Credit: the owner's rule on naming a creator.

export interface LookCredit {
  /** "@some.creator, post saved", "in the style of Some Name", or "Post saved". */
  text: string;
  /** True when the look is tied to a saved post. */
  tied: boolean;
}

/**
 * A look is tied to a creator only when its link is saved. With a name and no
 * link it is "in the style of". With neither there is nobody to credit.
 */
export function lookCredit(look: Pick<SavedLook, 'link' | 'creator'>): LookCredit | undefined {
  if (look.link) return { text: look.creator ? `${look.creator}, post saved` : 'Post saved', tied: true };
  if (look.creator) return { text: `in the style of ${look.creator}`, tied: false };
  return undefined;
}

/** A name for a look that has none yet. */
export function defaultLookName(look: Pick<SavedLook, 'link' | 'creator' | 'pieces'>): string {
  const main = sortPieces(look.pieces.filter((p) => LOOK_CORE_SLOTS.includes(p.slot))).slice(0, 3);
  if (main.length > 0) return capitalize(main.map((p) => p.description.toLowerCase()).join(', '));
  if (look.creator) return look.link ? `Look from ${look.creator}` : `Look in the style of ${look.creator}`;
  const shared = look.link ? parseSharedLink(look.link) : undefined;
  if (shared?.instagram) return shared.instagram.kind === 'reel' ? 'Saved reel' : 'Saved post';
  if (shared) return `Look from ${shared.host}`;
  return 'Saved look';
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Where a look stands.

export type LookStage =
  | 'needs-screenshot' // a link and nothing else
  | 'needs-pieces' // screenshots, but no pieces listed yet
  | 'needs-check' // pieces proposed, waiting for the owner
  | 'ready';

export function lookStage(look: SavedLook, screenshots: number): LookStage {
  if (look.pieces.length === 0) return screenshots === 0 ? 'needs-screenshot' : 'needs-pieces';
  return look.confirmedAt ? 'ready' : 'needs-check';
}

// ---------------------------------------------------------------------------
// What kind of garment a description names.

export type GarmentKind =
  | 'tee'
  | 'shirt'
  | 'polo'
  | 'knit'
  | 'hoodie'
  | 'coat'
  | 'overshirt'
  | 'blazer'
  | 'jacket'
  | 'jeans'
  | 'shorts'
  | 'trousers'
  | 'loafer'
  | 'sneaker'
  | 'boot'
  | 'lace-up'
  | 'sandal';

const KIND_WORDS: Partial<Record<Slot, [GarmentKind, RegExp][]>> = {
  'main-top': [
    ['polo', /\bpolos?\b/],
    ['tee', /\b(tees?|t-?shirts?)\b/],
    ['hoodie', /\b(hoodies?|sweatshirts?)\b/],
    ['shirt', /\b(shirts?|oxford|poplin|button-?down)\b/],
    ['knit', /\b(cardigans?|sweaters?|jumpers?|knit(s|ted|wear)?|cable|crew-?neck|quarter-?zip|half-?zip|full-?zip|zip|pullover|turtleneck|roll-?neck)\b/],
  ],
  'outer-layer': [
    ['coat', /\b(coat|peacoat|overcoat|topcoat|parka|puffer)\b/],
    ['overshirt', /\b(overshirt|shacket|shirt jacket)\b/],
    ['blazer', /\b(blazer|sport coat|suit jacket)\b/],
    ['jacket', /\b(jacket|bomber|harrington|gilet|vest)\b/],
  ],
  trousers: [
    ['jeans', /\b(jeans|denim)\b/],
    ['shorts', /\bshorts\b/],
    ['trousers', /\b(trousers?|pants?|chinos?|slacks|cords?|corduroys?)\b/],
  ],
  shoes: [
    ['loafer', /\b(loafers?|moccasins?)\b/],
    ['sneaker', /\b(sneakers?|trainers?|runners?)\b/],
    ['boot', /\b(boots?|chelsea|chukkas?)\b/],
    ['lace-up', /\b(lace-?ups?|derby|derbies|oxfords?|wing-?tips?|brogues?|dress shoes?)\b/],
    ['sandal', /\b(sandals?|slides?)\b/],
  ],
};
KIND_WORDS['under-layer'] = KIND_WORDS['main-top'];

/** The kind of garment, read from its name and tags. Nothing when the words do not say. */
export function garmentKind(slot: Slot, text: string, tags: string[] = []): GarmentKind | undefined {
  const words = `${text} ${tags.join(' ')}`.toLowerCase();
  return KIND_WORDS[slot]?.find(([, pattern]) => pattern.test(words))?.[0];
}

const TAG_ALIASES: Record<string, string> = {
  pleats: 'pleated',
  'wide leg': 'wide-leg',
  wide: 'wide-leg',
  'straight leg': 'straight-leg',
  straight: 'straight-leg',
  'short-sleeve': 'short sleeve',
  'lace up': 'lace-up',
  sneakers: 'sneaker',
  loafers: 'loafer',
  boots: 'boot',
};

export function cleanTags(tags: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const tidy = tag.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
    if (tidy) out.add(TAG_ALIASES[tidy] ?? tidy);
  }
  return [...out].slice(0, 10);
}

/** Families that count as the same color when matching a look to the wardrobe. */
const COLOR_GROUPS: Partial<Record<ColorFamily, string>> = {
  white: 'white',
  cream: 'white',
  burgundy: 'burgundy',
  plum: 'burgundy',
  brown: 'brown',
  'dark-brown': 'brown',
  grey: 'grey',
  'light-grey': 'grey',
};

function colorGroupOf(family: ColorFamily | undefined): string | undefined {
  if (!family || family === 'other') return undefined;
  return COLOR_GROUPS[family] ?? family;
}

function familiesInGroup(family: ColorFamily): ColorFamily[] {
  const group = colorGroupOf(family);
  const members = (Object.keys(COLOR_GROUPS) as ColorFamily[]).filter((f) => COLOR_GROUPS[f] === group);
  return members.length > 0 ? [family, ...members.filter((f) => f !== family)] : [family];
}

// ---------------------------------------------------------------------------
// Your version: the look after the owner's rules.

export type VersionAction = 'keep' | 'adjust' | 'drop';

export interface VersionReason {
  rule: string;
  detail: string;
  evidence: Evidence;
}

export interface VersionLine {
  /** The piece as the look has it. */
  piece: LookPiece;
  action: VersionAction;
  /** The piece as the owner would wear it. Missing when it is dropped. */
  yours?: LookPiece;
  /** What changes, in a few words each: "In a closer fit". */
  changes: string[];
  /** The rules behind the action. Also set when the owner overrode them, so the screen can still say why. */
  reasons: VersionReason[];
  /** What the rules alone would do. */
  ruled: VersionAction;
  /** True when the owner's own choice decides, not the rules. */
  byYou: boolean;
}

const LEATHER = /\b(leather|suede|nubuck|shearling)\b/i;
const TIE = /\b(neck\s?tie|bow\s?tie|tie)\b(?![-\s]?dye)/i;
/** Accessories that are worn like clothing, so the leather rule covers them. */
const WORN_ACCESSORY = /\b(cap|hat|beanie|beret|gloves?|scarf)\b/i;

/** The profile's "no tie" rule: marked with the check, or simply saying so. */
function tieRule(rules: Rule[]): Rule | undefined {
  return rules.find((r) => r.check === 'no-tie') ?? rules.find((r) => /\bno (neck)?ties?\b/i.test(r.text));
}

interface Fix {
  reason: VersionReason;
  drop?: boolean;
  change?: string;
  patch?: Partial<LookPiece>;
}

function fixesFor(piece: LookPiece, rules: Rule[]): Fix[] {
  const fixes: Fix[] = [];
  const words = `${piece.description} ${piece.tags.join(' ')}`;
  const isAccessory = piece.slot === 'accessory';

  const noTie = tieRule(rules);
  if (noTie && isAccessory && TIE.test(words)) {
    fixes.push({ drop: true, reason: { rule: 'No tie', detail: 'A shirt under the knit is fine without one.', evidence: noTie.evidence } });
  }

  const leatherRule = rules.find((r) => r.check === 'no-leather-clothing');
  if (leatherRule && isAccessory && WORN_ACCESSORY.test(words) && LEATHER.test(`${piece.material ?? ''} ${words}`)) {
    fixes.push({
      drop: true,
      reason: { rule: 'No leather clothing', detail: 'Leather and suede are fine for shoes and belts, not for things you wear.', evidence: leatherRule.evidence },
    });
  }

  const isOuter = piece.slot === 'outer-layer';
  const coatRule = rules.find((r) => r.check === 'coat-to-mid-thigh');
  for (const finding of checkPiece({ slots: [piece.slot], cloth: piece.material, hardware: piece.hardware, fit: piece.fit, hem: piece.hem }, rules)) {
    const reason: VersionReason = { rule: finding.rule, detail: finding.detail, evidence: finding.evidence };
    switch (finding.id) {
      case 'leather-clothing':
        fixes.push({ reason, change: 'In cloth, not leather or suede', patch: { material: undefined } });
        break;
      case 'leather-watch-strap':
        fixes.push({ reason, change: 'On a steel bracelet or a fabric strap', patch: { material: 'steel bracelet' } });
        break;
      case 'gold-hardware':
        fixes.push({ reason, change: 'With silver or dark metal, not gold', patch: { hardware: 'silver' } });
        break;
      case 'boxy':
        fixes.push({ reason, change: 'In a closer fit', patch: { fit: 'regular' } });
        break;
      case 'too-long':
        fixes.push(
          isOuter && coatRule ? { reason, change: 'No longer than mid-thigh', patch: { hem: 'mid-thigh' } } : { reason, change: 'Shorter, ending by mid-fly', patch: { hem: 'mid-fly' } },
        );
        break;
      case 'brass-buttons':
      case 'hem-below-fly':
        // Worth a look, but not a reason to change the piece.
        fixes.push({ reason });
        break;
    }
  }
  return fixes;
}

/** The look after the owner's rules: what stays, what changes and what goes. */
export function yourVersion(look: Pick<SavedLook, 'pieces'>, rules: Rule[]): VersionLine[] {
  return sortPieces(look.pieces).map((piece) => {
    const fixes = fixesFor(piece, rules);
    const reasons = fixes.map((f) => f.reason);
    const changes = fixes.map((f) => f.change).filter((c): c is string => Boolean(c));
    const ruled: VersionAction = fixes.some((f) => f.drop) ? 'drop' : changes.length > 0 ? 'adjust' : 'keep';

    if (piece.choice === 'drop') return { piece, action: 'drop', changes: [], reasons, ruled, byYou: true };
    if (piece.choice === 'keep' && ruled !== 'keep') return { piece, action: 'keep', yours: piece, changes: [], reasons, ruled, byYou: true };
    if (ruled === 'drop') return { piece, action: 'drop', changes: [], reasons, ruled, byYou: false };
    if (ruled === 'adjust') {
      const yours = fixes.reduce<LookPiece>((current, fix) => ({ ...current, ...fix.patch }), piece);
      return { piece, action: 'adjust', yours, changes, reasons, ruled, byYou: false };
    }
    return { piece, action: 'keep', yours: piece, changes: [], reasons, ruled, byYou: false };
  });
}

// ---------------------------------------------------------------------------
// Matching the owner's version to the wardrobe.

export type MatchLevel =
  | 'have' // an owned piece fits the description
  | 'close' // an owned piece is near, with differences worth reading
  | 'missing';

export interface PieceMatch {
  line: VersionLine;
  /** The piece as the owner would wear it. */
  wanted: LookPiece;
  level: MatchLevel;
  /** The best owned piece, for "have" and "close". */
  owned?: Piece;
  /** For "close": what differs, one sentence each. */
  differences: string[];
  /** True for a slot that makes up the outfit. Belts, watches and the like are finishing touches. */
  core: boolean;
  /** True when the owner said a close piece is close enough. */
  accepted: boolean;
  /** True when the piece is still to be found: not owned, and no stand-in accepted. */
  toFind: boolean;
}

export interface LookMatch {
  lines: PieceMatch[];
  /** Core pieces still to be found. */
  missing: PieceMatch[];
  /** Finishing touches still to be found. They do not count as pieces away. */
  extras: PieceMatch[];
  status: 'no-pieces' | 'make-now' | 'one-away' | 'several-away';
  /** "You can make this now", "One piece away: cream pleated trousers", "3 pieces away". */
  summary: string;
}

const SLIM = ['slim', 'tapered', 'skinny'];
const FULL = ['pleated', 'wide-leg', 'relaxed', 'baggy'];

/** How an owned piece differs from a wanted one. Nothing comes back when the two are not the same kind of thing. */
export function comparePiece(wanted: LookPiece, owned: Piece): string[] | undefined {
  if (!owned.slots.includes(wanted.slot)) return undefined;
  if (wanted.slot === 'watch') {
    // A watch is matched on its metal. Its color is the dial's or the strap's, and is seldom noted.
    const metals = [wanted.hardware, owned.hardware].filter((m): m is Hardware => m !== undefined && m !== 'none');
    return metals.length === 2 && metals[0] !== metals[1] ? [`Yours is ${metalWord(metals[1]!)}, the look has ${metalWord(metals[0]!)}.`] : [];
  }
  const wantedGroup = colorGroupOf(wanted.colorFamily);
  const ownedGroup = colorGroupOf(owned.colorFamily);
  // A color that is "other" or not set cannot be matched on.
  if (!wantedGroup || !ownedGroup || wantedGroup !== ownedGroup) return undefined;
  const wantedKind = garmentKind(wanted.slot, wanted.description, wanted.tags);
  const ownedKind = garmentKind(wanted.slot, owned.name, owned.tags);
  if (wantedKind && ownedKind && wantedKind !== ownedKind) return undefined;

  const plural = wanted.slot === 'trousers' || wanted.slot === 'shoes' || wanted.slot === 'glasses';
  const yours = plural ? 'Yours are' : 'Yours is';
  const differences: string[] = [];
  if (wanted.colorFamily !== owned.colorFamily) differences.push(`${yours} ${colorWord(owned.colorFamily)}, the look has ${colorWord(wanted.colorFamily)}.`);
  if (wanted.depth && owned.colorFamily === wanted.colorFamily && depthOf(owned) !== wanted.depth && (owned.depth !== undefined || wanted.depth !== 'mid')) {
    differences.push(`${yours} ${depthOf(owned)}, the look's ${plural ? 'are' : 'is'} ${wanted.depth}.`);
  }
  if (wanted.neckline && owned.neckline && wanted.neckline !== owned.neckline) {
    differences.push(`${yours} a ${necklineWord(owned.neckline)}, the look has a ${necklineWord(wanted.neckline)}.`);
  }
  if (wanted.texture && owned.texture && wanted.texture !== owned.texture) {
    differences.push(`${yours} ${owned.texture}, the look's ${plural ? 'are' : 'is'} ${wanted.texture}.`);
  }
  if (wanted.slot === 'trousers') {
    const ownedTags = cleanTags(owned.tags);
    const wantsFull = wanted.tags.filter((t) => FULL.includes(t));
    const wantsSlim = wanted.tags.some((t) => SLIM.includes(t));
    const ownedFull = ownedTags.some((t) => FULL.includes(t)) || owned.fit === 'relaxed';
    const ownedSlim = ownedTags.some((t) => SLIM.includes(t));
    if (wantsFull.includes('pleated') && !ownedTags.includes('pleated')) differences.push(ownedSlim ? 'Yours are slim, the look has pleats.' : 'The look has pleats.');
    else if (wantsFull.length > 0 && ownedSlim) differences.push(`Yours are slim, the look's are ${wantsFull[0]}.`);
    else if (wantsSlim && ownedFull) differences.push("Yours are fuller, the look's are slim.");
  }
  return differences;
}

function metalWord(metal: Hardware): string {
  return (labelOf(HARDWARE, metal) ?? metal).toLowerCase();
}

function necklineWord(neckline: Neckline): string {
  return (labelOf(NECKLINES, neckline) ?? neckline).toLowerCase();
}

function bestOwned(wanted: LookPiece, owned: Piece[]): { piece: Piece; differences: string[] } | undefined {
  let best: { piece: Piece; differences: string[] } | undefined;
  for (const piece of owned) {
    const differences = comparePiece(wanted, piece);
    if (!differences) continue;
    if (!best || differences.length < best.differences.length) best = { piece, differences };
  }
  return best;
}

/** Matches the owner's version of a look to the pieces they own. */
export function matchLook(look: Pick<SavedLook, 'pieces'>, rules: Rule[], pieces: Piece[]): LookMatch {
  const owned = pieces.filter((p) => p.status === 'owned');
  const byId = new Map(owned.map((p) => [p.id, p]));
  const lines: PieceMatch[] = [];
  for (const line of yourVersion(look, rules)) {
    if (!line.yours) continue;
    const wanted = line.yours;
    const core = LOOK_CORE_SLOTS.includes(wanted.slot);
    const standIn = wanted.standInId ? byId.get(wanted.standInId) : undefined;
    if (standIn && standIn.slots.includes(wanted.slot)) {
      const differences = comparePiece(wanted, standIn) ?? [];
      lines.push({ line, wanted, level: differences.length === 0 ? 'have' : 'close', owned: standIn, differences, core, accepted: true, toFind: false });
      continue;
    }
    const best = bestOwned(wanted, owned);
    const level: MatchLevel = !best ? 'missing' : best.differences.length === 0 ? 'have' : 'close';
    lines.push({ line, wanted, level, owned: best?.piece, differences: best?.differences ?? [], core, accepted: false, toFind: level !== 'have' });
  }

  const missing = lines.filter((l) => l.core && l.toFind);
  const extras = lines.filter((l) => !l.core && l.toFind);
  const hasCore = lines.some((l) => l.core);
  if (!hasCore) return { lines, missing, extras, status: 'no-pieces', summary: 'No pieces listed yet' };
  if (missing.length === 0) return { lines, missing, extras, status: 'make-now', summary: 'You can make this now' };
  if (missing.length === 1) return { lines, missing, extras, status: 'one-away', summary: `One piece away: ${missing[0]!.wanted.description.toLowerCase()}` };
  return { lines, missing, extras, status: 'several-away', summary: `${missing.length} pieces away` };
}

// ---------------------------------------------------------------------------
// Missing pieces, described for the buy list. The buy list itself belongs to
// the Buy next screen. This file only says what to ask it for.

/** A piece to find, as a spec and not a product: "Cream pleated trousers". */
export interface MissingSpec {
  slot: Slot;
  spec: string;
  colorFamily?: ColorFamily;
  depth?: Depth;
  texture?: Texture;
  neckline?: Neckline;
  dressLevel?: DressLevel;
  tags: string[];
  /** What the owner's rules change about it, such as "In a closer fit". */
  note?: string;
  /** Two specs with the same key are one thing to buy. */
  key: string;
}

/** Two missing pieces with the same key are one thing to buy. */
export function wantKey(piece: Pick<LookPiece, 'slot' | 'colorFamily' | 'neckline' | 'description' | 'tags'>): string {
  const kind = garmentKind(piece.slot, piece.description, piece.tags) ?? '';
  const isTop = piece.slot === 'main-top' || piece.slot === 'under-layer' || piece.slot === 'outer-layer';
  const group = colorGroupOf(piece.colorFamily);
  // With no color to go on, only the same words mean the same thing.
  const color = group ?? `?${piece.description.trim().toLowerCase()}`;
  return [piece.slot, color, kind, isTop ? (piece.neckline ?? '') : ''].join('|');
}

export function specFromMatch(match: PieceMatch): MissingSpec {
  const { wanted, line } = match;
  return {
    slot: wanted.slot,
    spec: wanted.description,
    colorFamily: wanted.colorFamily,
    depth: wanted.depth,
    texture: wanted.texture,
    neckline: wanted.neckline,
    dressLevel: wanted.dressLevel,
    tags: wanted.tags,
    note: line.changes.length > 0 ? line.changes.join('. ') : undefined,
    key: wantKey(wanted),
  };
}

// ---------------------------------------------------------------------------
// Saved looks feed the outfit picker.

const FORMULA_SLOTS: FormulaSlot[] = ['main-top', 'under-layer', 'trousers', 'shoes', 'outer-layer'];

/**
 * A confirmed look as an outfit recipe, built from the owner's version of it.
 * The Today and Week screens then credit an outfit that matches it.
 */
export function formulaFromLook(look: SavedLook, rules: Rule[]): Formula | undefined {
  if (!look.confirmedAt) return undefined;
  const slots: Partial<Record<FormulaSlot, PieceMatcher>> = {};
  for (const line of yourVersion(look, rules)) {
    const piece = line.yours;
    if (!piece || !piece.colorFamily || piece.colorFamily === 'other') continue;
    const slot = FORMULA_SLOTS.find((s) => s === piece.slot);
    if (!slot || slots[slot]) continue;
    const matcher: PieceMatcher = { colorFamilies: familiesInGroup(piece.colorFamily) };
    if (piece.neckline && slot !== 'trousers' && slot !== 'shoes') matcher.necklines = [piece.neckline];
    if (slot === 'trousers' && piece.tags.includes('pleated')) matcher.tags = ['pleated'];
    slots[slot] = matcher;
  }
  // A recipe needs a top and something else, or it would match half the wardrobe.
  if (!slots['main-top'] || Object.keys(slots).length < 2) return undefined;
  return {
    id: `saved-look:${look.id}`,
    name: look.name,
    source: 'your-looks',
    credit: look.creator,
    postSeen: Boolean(look.link),
    link: look.link,
    slots,
  };
}

/** The profile's recipes plus one for each confirmed look that is not already among them. */
export function formulasWithLooks(base: Formula[], looks: SavedLook[], rules: Rule[]): Formula[] {
  const out = [...base];
  for (const look of looks) {
    if (look.link && base.some((f) => sameLink(f.link, look.link))) continue;
    const formula = formulaFromLook(look, rules);
    if (formula) out.push(formula);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What the saved looks have in common.

const SLOT_NOUNS: Partial<Record<Slot, string>> = {
  'main-top': 'top',
  'under-layer': 'under-layer',
  trousers: 'trousers',
  shoes: 'shoes',
  'outer-layer': 'outer layer',
};

const KIND_NOUNS: Partial<Record<GarmentKind, string>> = {
  tee: 'tee',
  shirt: 'shirt',
  polo: 'polo',
  knit: 'knit',
  hoodie: 'hoodie',
  coat: 'coat',
  overshirt: 'overshirt',
  blazer: 'blazer',
  jacket: 'jacket',
  jeans: 'jeans',
  shorts: 'shorts',
  trousers: 'trousers',
  loafer: 'loafers',
  sneaker: 'sneakers',
  boot: 'boots',
  'lace-up': 'lace-ups',
  sandal: 'sandals',
};

export interface CommonThread {
  /** "Cream trousers" */
  label: string;
  count: number;
  of: number;
}

/**
 * Things that keep turning up in the looks the owner saves, such as cream
 * trousers in three of four. Shown from three confirmed looks on, and only
 * for something in at least half of them.
 */
export function commonThreads(looks: SavedLook[], rules: Rule[]): CommonThread[] {
  const confirmed = looks.filter((l) => l.confirmedAt);
  if (confirmed.length < 3) return [];
  const counts = new Map<string, { label: string; count: number }>();
  for (const look of confirmed) {
    const seen = new Set<string>();
    for (const line of yourVersion(look, rules)) {
      const piece = line.yours;
      const noun = piece && (KIND_NOUNS[garmentKind(piece.slot, piece.description, piece.tags) ?? ('' as GarmentKind)] ?? SLOT_NOUNS[piece.slot]);
      const group = piece && colorGroupOf(piece.colorFamily);
      if (!piece || !noun || !group) continue;
      const key = `${group}|${noun}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const current = counts.get(key) ?? { label: capitalize(`${colorWord(piece.colorFamily)} ${noun}`), count: 0 };
      counts.set(key, { label: current.label, count: current.count + 1 });
    }
  }
  return [...counts.values()]
    .filter((c) => c.count >= 2 && c.count * 2 >= confirmed.length)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 3)
    .map((c) => ({ ...c, of: confirmed.length }));
}

// ---------------------------------------------------------------------------
// Taking in the cloud model's reading. Nothing it says is trusted as it comes.

const SLOT_VALUES: Slot[] = ['main-top', 'under-layer', 'trousers', 'shoes', 'outer-layer', 'belt', 'glasses', 'watch', 'accessory'];
const COLOR_VALUES: ColorFamily[] = [
  'white',
  'cream',
  'light-blue',
  'lavender',
  'aqua',
  'blue',
  'navy',
  'burgundy',
  'plum',
  'olive',
  'green',
  'tan',
  'brown',
  'dark-brown',
  'light-grey',
  'grey',
  'charcoal',
  'black',
  'mustard',
  'other',
];
const DEPTH_VALUES: Depth[] = ['light', 'mid', 'dark'];
const TEXTURE_VALUES: Texture[] = ['smooth', 'rough'];
const NECKLINE_VALUES: Neckline[] = ['crew', 'v-neck', 'polo-collar', 'shirt-collar', 'quarter-zip', 'full-zip', 'stand-collar', 'shawl-collar'];
const FIT_VALUES: Fit[] = ['close', 'regular', 'relaxed', 'boxy'];
const HEM_VALUES: Hem[] = ['at-belt', 'mid-fly', 'below-fly', 'mid-thigh', 'longer'];
const HARDWARE_VALUES: Hardware[] = ['none', 'silver', 'dark', 'small-brass-buttons', 'gold-or-brass'];
const CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;

/** The lists the server's prompt offers the model, kept in one place with the checks. */
export const READING_VALUES = {
  slots: SLOT_VALUES,
  colors: COLOR_VALUES,
  depths: DEPTH_VALUES,
  textures: TEXTURE_VALUES,
  necklines: NECKLINE_VALUES,
  fits: FIT_VALUES,
  hems: HEM_VALUES,
  hardware: HARDWARE_VALUES,
  confidence: CONFIDENCE_VALUES,
};

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : undefined;
}

function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const tidy = value.replace(/\s+/g, ' ').trim();
  if (!tidy || /^(unknown|none|n\/a|not visible)$/i.test(tidy)) return undefined;
  return tidy.slice(0, max);
}

export interface NormalizedReading {
  pieces: LookPiece[];
  notes?: string;
  /** The account name the model could read off the screenshot, as "@name". */
  account?: string;
}

/**
 * Turns the model's answer into pieces the app can hold. Values outside the
 * app's own lists are dropped, so a wrong or odd answer costs a tag and
 * never breaks the look.
 */
export function normalizeReading(raw: unknown, makeId: () => string): NormalizedReading {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(record.pieces) ? record.pieces : [];
  const pieces: LookPiece[] = [];
  for (const item of list.slice(0, 12)) {
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const slot = oneOf(SLOT_VALUES, entry.slot);
    const description = shortText(entry.description, 80);
    if (!slot || !description) continue;
    const isTop = slot === 'main-top' || slot === 'under-layer' || slot === 'outer-layer';
    pieces.push({
      id: makeId(),
      slot,
      description: capitalize(description),
      colorFamily: oneOf(COLOR_VALUES, entry.colorFamily),
      depth: oneOf(DEPTH_VALUES, entry.depth),
      texture: oneOf(TEXTURE_VALUES, entry.texture),
      neckline: isTop ? oneOf(NECKLINE_VALUES, entry.neckline) : undefined,
      fit: isTop ? oneOf(FIT_VALUES, entry.fit) : undefined,
      hem: isTop ? oneOf(HEM_VALUES, entry.hem) : undefined,
      material: shortText(entry.material, 40)?.toLowerCase(),
      hardware: oneOf(HARDWARE_VALUES, entry.hardware),
      dressLevel: entry.dressLevel === 1 || entry.dressLevel === 2 || entry.dressLevel === 3 ? entry.dressLevel : undefined,
      tags: cleanTags(Array.isArray(entry.tags) ? entry.tags : []),
      from: 'ai',
      confidence: oneOf(CONFIDENCE_VALUES, entry.confidence),
    });
  }
  const account = shortText(record.account, 31)?.replace(/^@/, '');
  return {
    pieces: sortPieces(pieces),
    notes: shortText(record.notes, 400),
    account: account && /^[A-Za-z0-9._]{1,30}$/.test(account) ? `@${account.toLowerCase()}` : undefined,
  };
}

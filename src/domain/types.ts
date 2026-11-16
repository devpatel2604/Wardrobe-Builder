/**
 * The data model for the foundation: one Profile document, Piece records and
 * their Photos. Terms follow the Phase 1 design brief, section 5.
 */

/** How strong the backing for a statement is. Shown as a small label. */
export type Evidence =
  | 'your-rule' // the owner's own rule, from the profile file
  | 'your-choice' // a choice the owner made when asked
  | 'research' // has a study behind it
  | 'convention' // stylists agree, no study
  | 'working-rule'; // the app's own starting rule, tuned by feedback

/** The four kinds of rule from the coloring report. */
export type RuleKind =
  | 'hard' // filters, only the owner edits them
  | 'default' // applied unless the owner says otherwise
  | 'soft' // raises or lowers a score
  | 'open-test'; // waits on a photo test

/**
 * A check the app can run on a piece. A rule that carries one switches that
 * check on, so the checks follow the profile and are not fixed in code.
 */
export type RuleCheck =
  | 'no-leather-clothing' // also covers leather watch straps
  | 'silver-over-gold'
  | 'nothing-boxy-or-long'
  | 'coat-to-mid-thigh'; // an exception: a coat may reach mid-thigh

export interface Rule {
  id: string;
  kind: RuleKind;
  text: string;
  why?: string;
  evidence: Evidence;
  check?: RuleCheck;
}

export type Confidence = 'high' | 'medium-high' | 'medium' | 'low' | 'unknown';

export interface PaletteEntry {
  id: string;
  color: string;
  /** A CSS color for the swatch. Illustration only. */
  swatch: string;
  nearFace: string;
  awayFromFace: string;
  confidence: Confidence;
  why: string;
}

export interface SizeEntry {
  id: string;
  label: string;
  value: string;
}

export interface StoreEntry {
  id: string;
  name: string;
  note?: string;
}

export interface Profile {
  /** Always 'me'. The app has one user. */
  id: 'me';
  /** The date of the profile file this was loaded from (YYYY-MM-DD), if any. */
  profileFileDate?: string;
  updatedAt: string;
  body: {
    height: string;
    weight: string;
    build: string;
  };
  coloring: {
    skin: string;
    hair: string;
    glasses: string;
    faceShape: string;
  };
  sizes: SizeEntry[];
  week: {
    /** 0 is Sunday, 6 is Saturday. */
    officeDays: number[];
    officeHours: string;
    dressCode: string;
    otherOccasions: string;
  };
  home: {
    town: string;
    pickup: string;
    /**
     * A map point for the town, rounded to two decimals (about half a mile).
     * Used only to ask for the weather forecast.
     */
    point?: MapPoint;
  };
  stores: StoreEntry[];
  budget: string;
  scentNote: string;
  rules: Rule[];
  palette: PaletteEntry[];
  /** Outfit recipes with their source. Loaded from the setup file, never part of the code. */
  formulas?: Formula[];
}

/** A place in an outfit that one piece fills. */
export type Slot =
  | 'main-top'
  | 'under-layer'
  | 'trousers'
  | 'shoes'
  | 'outer-layer'
  | 'belt'
  | 'glasses'
  | 'watch'
  | 'fragrance'
  | 'accessory';

export type ColorFamily =
  | 'white'
  | 'cream'
  | 'light-blue'
  | 'lavender'
  | 'aqua'
  | 'blue'
  | 'navy'
  | 'burgundy'
  | 'plum'
  | 'olive'
  | 'green'
  | 'tan'
  | 'brown'
  | 'dark-brown'
  | 'light-grey'
  | 'charcoal'
  | 'black'
  | 'mustard'
  | 'other';

export type Depth = 'light' | 'mid' | 'dark';
export type Texture = 'smooth' | 'rough';
export type Neckline =
  | 'crew'
  | 'v-neck'
  | 'polo-collar'
  | 'shirt-collar'
  | 'quarter-zip'
  | 'full-zip'
  | 'stand-collar'
  | 'shawl-collar';
export type Fit = 'close' | 'regular' | 'relaxed' | 'boxy';
/** Where the hem of a top or coat ends. */
export type Hem = 'at-belt' | 'mid-fly' | 'below-fly' | 'mid-thigh' | 'longer';
export type DressLevel = 1 | 2 | 3;
export type Hardware = 'none' | 'silver' | 'dark' | 'small-brass-buttons' | 'gold-or-brass';
export type Warmth = 'light' | 'medium' | 'warm';
export type PieceStatus = 'owned' | 'considering';

export interface Piece {
  id: string;
  name: string;
  brand?: string;
  status: PieceStatus;
  /** At least one. A tee can be an under-layer and a main top. */
  slots: Slot[];
  colorFamily?: ColorFamily;
  /** The maker's own name for the color, such as "Coffee". */
  colorName?: string;
  depth?: Depth;
  texture?: Texture;
  neckline?: Neckline;
  fit?: Fit;
  hem?: Hem;
  dressLevel?: DressLevel;
  /** From the care label or the product page. Never guessed from a photo. */
  cloth?: string;
  hardware?: Hardware;
  warmth?: Warmth;
  /** True when the piece is fine in rain or snow. */
  wetOk?: boolean;
  size?: string;
  link?: string;
  pricePaid?: number;
  /** YYYY-MM-DD */
  acquiredOn?: string;
  wearCount: number;
  notes?: string;
  /** Free tags, lower case. */
  tags: string[];
  /**
   * False until the owner has looked over the tags. Pieces loaded from a setup
   * file start as false, because the file gives only a name and a color.
   */
  detailsConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Privacy class of a stored photo. Photos "of-me" (face, color test, mirror
 * shots) never leave the phone and are left out of exports unless asked for.
 */
export type PhotoKind = 'clothing' | 'inspiration' | 'of-me';

export interface Photo {
  id: string;
  pieceId: string;
  kind: PhotoKind;
  /** Position within the piece, lowest first. The first one is the cover. */
  order: number;
  mimeType: string;
  width: number;
  height: number;
  /** Stored as bytes, not a Blob: Blobs in IndexedDB have a patchy history on iOS. */
  data: ArrayBuffer;
  thumb: ArrayBuffer;
  createdAt: string;
}

/** What the form edits. Ids and timestamps are added by the repository. */
export type PieceDraft = Omit<Piece, 'id' | 'createdAt' | 'updatedAt' | 'wearCount'> & {
  wearCount?: number;
};

/** A blank profile, for starting without a setup file. */
export function emptyProfile(now: string = new Date().toISOString()): Profile {
  return {
    id: 'me',
    updatedAt: now,
    body: { height: '', weight: '', build: '' },
    coloring: { skin: '', hair: '', glasses: '', faceShape: '' },
    sizes: [],
    week: { officeDays: [], officeHours: '', dressCode: '', otherOccasions: '' },
    home: { town: '', pickup: '' },
    stores: [],
    budget: '',
    scentNote: '',
    rules: [],
    palette: [],
  };
}

export interface MapPoint {
  lat: number;
  lon: number;
}

/** Where an outfit idea comes from (design brief, section 7.3). */
export type LookSource =
  | 'your-looks' // posts the owner saved and creators they follow
  | 'suits-you' // built from the coloring and fit findings
  | 'in-season' // a trend the owner approved
  | 'similar-creators' // creators found by the research
  | 'test'; // an open color question

/** What a piece must be to fill a slot of a formula. Every part given must hold. */
export interface PieceMatcher {
  colorFamilies?: ColorFamily[];
  depths?: Depth[];
  necklines?: Neckline[];
  texture?: Texture;
  /** Every tag listed must be on the piece. */
  tags?: string[];
}

export type FormulaSlot = 'main-top' | 'under-layer' | 'trousers' | 'shoes' | 'outer-layer';

/**
 * A repeatable outfit recipe, such as "dark zip knit over a white layer,
 * pleated trousers, black loafers". An outfit matches when every slot listed
 * matches. A slot set to null must be empty. A slot left out is not checked.
 */
export interface Formula {
  id: string;
  name: string;
  source: LookSource;
  /** Who the look comes from, such as a creator's name. */
  credit?: string;
  /** True only when the post has been seen and can be linked. Otherwise the look is "in the style of". */
  postSeen?: boolean;
  link?: string;
  /** For a test: the question it answers. */
  note?: string;
  slots: Partial<Record<FormulaSlot, PieceMatcher | null>>;
}

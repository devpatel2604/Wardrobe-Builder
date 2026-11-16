import type { Evidence, Formula, LookSource, Piece } from '../types';

export type Occasion = 'office' | 'casual' | 'going-out' | 'date';

/** The weather for the hours of one occasion on one day. */
export interface DayWeather {
  /** Coldest and warmest temperature in those hours, in °F. */
  lowF: number;
  highF: number;
  /** Rain or snow is likely in those hours. */
  wet: boolean;
  snow: boolean;
  source: 'forecast' | 'manual';
  /** A short line for the screen, such as "35°F at 7 am, 48°F at 4 pm, dry". */
  summary: string;
}

/** The pieces of one outfit. Glasses and watch are fixed and are not listed here. */
export interface Outfit {
  mainTop: Piece;
  underLayer?: Piece;
  trousers: Piece;
  shoes: Piece;
  /** An overshirt or jacket worn as part of the outfit. */
  thirdLayer?: Piece;
  /** Added on top when it is cold. Not part of what makes two outfits differ. */
  coat?: Piece;
  belt?: Piece;
}

export type FilterId = 'levels-apart' | 'occasion' | 'bare-tee' | 'colors' | 'clash' | 'wet' | 'temperature';

export interface FilterFail {
  filter: FilterId;
  /** A full sentence, ready to show. */
  text: string;
  evidence: Evidence;
}

export type ScorePartId =
  | 'formula'
  | 'near-face'
  | 'texture'
  | 'proportion'
  | 'presence'
  | 'occasion-fit'
  | 'collar'
  | 'evening'
  | 'rotation'
  | 'history'
  | 'week-repeat';

export interface ScorePart {
  id: ScorePartId;
  points: number;
  /** A full sentence. Parts without one never show as a reason. */
  text?: string;
  evidence: Evidence;
}

/** Where a pick comes from, shown as a label on every outfit. */
export type PickSource = LookSource | 'your-rules';

export interface Candidate {
  key: string;
  outfit: Outfit;
  /** The average dress level of the top look, trousers and shoes. */
  level: number;
  formula?: Formula;
  source: PickSource;
  /** True when the idea comes from beyond the owner's saved looks and proven rules. */
  stretch: boolean;
  /** Empty when the outfit passes every filter. */
  fails: FilterFail[];
  parts: ScorePart[];
  score: number;
}

export interface Reason {
  text: string;
  /** Left out when the line states a plain fact, such as "you own no belt". */
  evidence?: Evidence;
}

export interface OutfitPick {
  candidate: Candidate;
  reasons: Reason[];
  /** Weather rules this outfit does not meet, when nothing owned meets them. */
  compromises: Reason[];
}

export interface Gap {
  /** Why nothing passes, in a sentence. */
  text: string;
  /** What kind of piece would open the most outfits, when one kind would. */
  hint?: string;
}

export interface Recommendation {
  occasion: Occasion;
  main?: OutfitPick;
  alternates: OutfitPick[];
  /** Things to know that are not about one outfit: no coat, no belt, the weather. */
  headsUp: Reason[];
  /** Set when there is nothing to wear. */
  gap?: Gap;
  /** True when a stretch look is among the alternates. */
  hasStretch: boolean;
  /** How many outfits pass every filter. */
  passing: number;
}

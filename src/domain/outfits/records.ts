import type { Occasion } from './types';

/** What the owner planned for one day. Without a row, a day follows the office days in the profile. */
export interface DayPlan {
  /** YYYY-MM-DD, in the phone's own time zone. */
  date: string;
  /** Every occasion of the day, the office included. */
  occasions: Occasion[];
  /** The weather as the owner set it, for when there is no forecast. */
  manualWeather?: ManualWeather;
  updatedAt: string;
}

export type TempBand = 'cold' | 'cool' | 'mild' | 'warm';

export interface ManualWeather {
  band: TempBand;
  wet: boolean;
}

export type SkipReason = 'too-formal' | 'too-casual' | 'too-warm' | 'too-cold' | 'colors' | 'fit' | 'not-feeling-it';
export type Rating = 'loved' | 'fine' | 'no';

/** The piece ids of an outfit, as stored. */
export interface OutfitIds {
  mainTop: string;
  underLayer?: string;
  trousers: string;
  shoes: string;
  thirdLayer?: string;
  coat?: string;
  belt?: string;
}

/** One answer to a suggested outfit: worn, or passed over. */
export interface OutfitLogEntry {
  id: string;
  date: string;
  occasion: Occasion;
  action: 'wore' | 'not-today';
  /** Identifies the look: top, under-layer, trousers, shoes and third layer. */
  outfitKey: string;
  pieces: OutfitIds;
  /** Only on "not today". */
  reason?: SkipReason;
  /** Only on "wore". */
  rating?: Rating;
  /** True when the owner changed a piece of the suggestion before wearing it. */
  swapped?: boolean;
  createdAt: string;
}

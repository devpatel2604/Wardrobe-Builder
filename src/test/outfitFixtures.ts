import type { EngineInput } from '../domain/outfits/engine';
import type { OutfitLogEntry } from '../domain/outfits/records';
import type { DayWeather } from '../domain/outfits/types';
import type { Formula, PaletteEntry, Piece } from '../domain/types';
import type { HourForecast } from '../domain/weather';
import { sampleRules } from './fixtures';

/** A made-up wardrobe for the outfit rules. None of it is the owner's. */
const NOW = '2026-01-05T09:00:00.000Z';

export function piece(partial: Partial<Piece> & Pick<Piece, 'id' | 'name' | 'slots'>): Piece {
  return { status: 'owned', wearCount: 0, tags: [], detailsConfirmed: true, createdAt: NOW, updatedAt: NOW, ...partial };
}

export const tee = piece({ id: 'tee', name: 'White tee', slots: ['under-layer', 'main-top'], colorFamily: 'white', dressLevel: 1 });
export const zip = piece({
  id: 'zip',
  name: 'Charcoal zip cardigan',
  slots: ['main-top'],
  colorFamily: 'charcoal',
  neckline: 'full-zip',
  dressLevel: 2,
  hem: 'at-belt',
});
export const crew = piece({
  id: 'crew',
  name: 'Green cable crewneck',
  slots: ['main-top'],
  colorFamily: 'green',
  depth: 'dark',
  neckline: 'crew',
  texture: 'rough',
  dressLevel: 2,
});
export const pleats = piece({ id: 'pleats', name: 'Navy pleated trousers', slots: ['trousers'], colorFamily: 'navy', dressLevel: 2, tags: ['pleated'] });
export const chinos = piece({ id: 'chinos', name: 'Tan chinos', slots: ['trousers'], colorFamily: 'tan', dressLevel: 2 });
export const joggers = piece({ id: 'joggers', name: 'Grey joggers', slots: ['trousers'], colorFamily: 'light-grey', dressLevel: 1 });
export const derbies = piece({ id: 'derbies', name: 'Black derbies', slots: ['shoes'], colorFamily: 'black', dressLevel: 3 });
export const watch = piece({ id: 'watch', name: 'Steel watch', slots: ['watch'], hardware: 'silver' });

/** Two knits, one tee, three trousers and one pair of dressy shoes: four outfits, none casual. */
export function smallWardrobe(): Piece[] {
  return [tee, zip, crew, pleats, chinos, joggers, derbies, watch];
}

/** Pieces that widen the small wardrobe. */
export const trainers = piece({ id: 'trainers', name: 'White trainers', slots: ['shoes'], colorFamily: 'white', dressLevel: 1 });
export const boots = piece({ id: 'boots', name: 'Brown boots', slots: ['shoes'], colorFamily: 'brown', dressLevel: 2, wetOk: true });
export const coat = piece({
  id: 'coat',
  name: 'Grey wool coat',
  slots: ['outer-layer'],
  colorFamily: 'charcoal',
  warmth: 'warm',
  hem: 'mid-thigh',
  wetOk: true,
});
export const overshirt = piece({ id: 'overshirt', name: 'Olive overshirt', slots: ['outer-layer'], colorFamily: 'olive', dressLevel: 1 });
export const shirt = piece({
  id: 'shirt',
  name: 'White shirt',
  slots: ['under-layer', 'main-top'],
  colorFamily: 'white',
  neckline: 'shirt-collar',
  dressLevel: 2,
});
export const polo = piece({ id: 'polo', name: 'Blue knit polo', slots: ['main-top'], colorFamily: 'blue', neckline: 'polo-collar', dressLevel: 3 });
export const creamTrousers = piece({ id: 'cream', name: 'Cream trousers', slots: ['trousers'], colorFamily: 'cream', dressLevel: 3 });
export const blackBelt = piece({ id: 'belt', name: 'Black belt', slots: ['belt'], colorFamily: 'black', hardware: 'silver' });

export const samplePalette: PaletteEntry[] = [
  { id: 'p-white', color: 'White, cream', swatch: '#fff', nearFace: 'Yes', awayFromFace: 'Yes', confidence: 'high', why: '' },
  { id: 'p-charcoal', color: 'Charcoal', swatch: '#333', nearFace: 'Over a light layer', awayFromFace: 'Yes', confidence: 'medium', why: '' },
  { id: 'p-green', color: 'Green', swatch: '#252', nearFace: 'Yes', awayFromFace: 'Yes', confidence: 'medium', why: '' },
  { id: 'p-tan', color: 'Tan, camel', swatch: '#ca8', nearFace: 'Test', awayFromFace: 'Yes', confidence: 'unknown', why: '' },
];

export const savedLook: Formula = {
  id: 'f-zip',
  name: 'Zip knit over a white layer with navy trousers',
  source: 'your-looks',
  credit: 'A Creator',
  postSeen: true,
  link: 'https://example.com/post',
  slots: {
    'main-top': { necklines: ['full-zip'] },
    'under-layer': { colorFamilies: ['white'] },
    trousers: { colorFamilies: ['navy'], tags: ['pleated'] },
  },
};

export const stretchLook: Formula = {
  id: 'f-polo',
  name: 'Knit polo with cream trousers',
  source: 'suits-you',
  slots: { 'main-top': { necklines: ['polo-collar'] }, 'under-layer': null, trousers: { colorFamilies: ['cream'] } },
};

export const dry: DayWeather = { lowF: 55, highF: 62, wet: false, snow: false, source: 'forecast', summary: '55 to 62°F, dry' };
export const cold: DayWeather = { lowF: 35, highF: 46, wet: false, snow: false, source: 'forecast', summary: '35 to 46°F, dry' };
export const wet: DayWeather = { ...dry, wet: true, summary: '55 to 62°F, rain likely' };

export function engineInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    pieces: smallWardrobe(),
    rules: sampleRules,
    palette: samplePalette,
    formulas: [savedLook, stretchLook],
    occasion: 'office',
    weather: dry,
    date: '2026-01-06',
    log: [],
    ...overrides,
  };
}

export function woreEntry(partial: Partial<OutfitLogEntry> & Pick<OutfitLogEntry, 'date' | 'pieces'>): OutfitLogEntry {
  const { mainTop, underLayer, trousers, shoes, thirdLayer } = partial.pieces;
  return {
    id: `log-${partial.date}`,
    occasion: 'office',
    action: 'wore',
    outfitKey: [mainTop, underLayer ?? '', trousers, shoes, thirdLayer ?? ''].join('|'),
    createdAt: NOW,
    ...partial,
  };
}

/** An hourly forecast for whole days, in the test machine's own time zone. */
export function hourly(days: { date: string; tempF?: number; wet?: boolean }[]): HourForecast[] {
  return days.flatMap(({ date, tempF = 40, wet: rain = false }) =>
    Array.from({ length: 24 }, (_, hour) => {
      const [y, m, d] = date.split('-').map(Number) as [number, number, number];
      return {
        startTime: new Date(y, m - 1, d, hour).toISOString(),
        temperatureF: tempF + (hour >= 12 ? 8 : 0),
        precipChance: rain ? 80 : 5,
        shortForecast: rain ? 'Rain' : 'Sunny',
      };
    }),
  );
}

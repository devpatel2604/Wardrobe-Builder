import type { BackupFile } from '../data/backup';
import type { ProcessedImage } from '../data/images';
import type { Piece, Profile, Rule } from '../domain/types';

/** Made-up sample data. The real profile is never part of the code. */
const NOW = '2026-01-05T09:00:00.000Z';

export const sampleRules: Rule[] = [
  { id: 'r-leather', kind: 'hard', text: 'No leather clothing and no leather watch straps.', why: 'Shoes and belts are fine.', evidence: 'your-rule', check: 'no-leather-clothing' },
  { id: 'r-silver', kind: 'hard', text: 'Silver over gold.', evidence: 'your-rule', check: 'silver-over-gold' },
  { id: 'r-shape', kind: 'hard', text: 'Nothing boxy or long.', evidence: 'your-rule', check: 'nothing-boxy-or-long' },
  { id: 'r-coat', kind: 'hard', text: 'A winter coat may reach mid-thigh.', evidence: 'your-choice', check: 'coat-to-mid-thigh' },
  { id: 'r-hem', kind: 'default', text: 'Top hems end between the belt and mid-fly.', evidence: 'convention' },
  { id: 'r-knits', kind: 'soft', text: 'Textured knits.', evidence: 'convention' },
  { id: 'r-black', kind: 'open-test', text: 'Black near the face.', evidence: 'working-rule' },
];

export function sampleProfile(): Profile {
  return {
    id: 'me',
    profileFileDate: '2026-01-04',
    updatedAt: NOW,
    body: { height: `5'10"`, weight: '160 lb', build: 'Average' },
    coloring: { skin: 'Light olive.', hair: 'Dark brown.', glasses: 'Black round frames.', faceShape: 'Not assessed.' },
    sizes: [
      { id: 's-tops', label: 'Tops', value: 'M' },
      { id: 's-pants', label: 'Pants', value: '32 × 32' },
    ],
    week: { officeDays: [2, 4], officeHours: '9 am to 5 pm', dressCode: 'Smart casual', otherOccasions: 'Dinners' },
    home: { town: 'Springfield', pickup: 'Likes in-store pickup.' },
    stores: [
      { id: 'st-1', name: 'Sample Store', note: 'Has a rewards card' },
      { id: 'st-2', name: 'Another Shop' },
    ],
    budget: 'No cap set.',
    scentNote: 'Likes citrus scents.',
    rules: sampleRules,
    palette: [
      { id: 'p-navy', color: 'Navy', swatch: '#1c2a4a', nearFace: 'Yes', awayFromFace: 'Yes', confidence: 'high', why: 'Dark and cool.' },
      { id: 'p-black', color: 'Black', swatch: '#17181b', nearFace: 'Test', awayFromFace: 'Yes', confidence: 'unknown', why: 'Not tested yet.' },
    ],
  };
}

function piece(partial: Partial<Piece> & Pick<Piece, 'id' | 'name' | 'slots'>): Piece {
  return { status: 'owned', wearCount: 0, tags: [], detailsConfirmed: false, createdAt: NOW, updatedAt: NOW, ...partial };
}

export function samplePieces(): Piece[] {
  return [
    piece({ id: 'pc-tee', name: 'Plain white tee', brand: 'Sample Co', slots: ['under-layer', 'main-top'], colorFamily: 'white', depth: 'light', dressLevel: 1 }),
    piece({ id: 'pc-knit', name: 'Navy zip cardigan', slots: ['main-top'], colorFamily: 'navy', depth: 'dark', neckline: 'full-zip', cloth: 'Cotton', dressLevel: 2 }),
    piece({ id: 'pc-chinos', name: 'Tan chinos', slots: ['trousers'], colorFamily: 'tan', tags: ['slim'], dressLevel: 2 }),
    piece({ id: 'pc-loafers', name: 'Black loafers', slots: ['shoes'], colorFamily: 'black', cloth: 'Leather', dressLevel: 3 }),
    piece({ id: 'pc-watch', name: 'Steel watch', slots: ['watch'], hardware: 'silver', cloth: 'Steel bracelet' }),
  ];
}

export function sampleSetupFile(): BackupFile {
  return {
    app: 'wardrobe-builder',
    formatVersion: 1,
    kind: 'setup',
    exportedAt: NOW,
    includesPrivatePhotos: false,
    profile: sampleProfile(),
    pieces: samplePieces(),
    photos: [],
  };
}

export function fakeImage(bytes: number[] = [1, 2, 3, 4]): ProcessedImage {
  return {
    mimeType: 'image/jpeg',
    width: 800,
    height: 1000,
    data: new Uint8Array(bytes).buffer,
    thumb: new Uint8Array(bytes.slice(0, 2)).buffer,
  };
}

import type { WishItem, WishOption } from '../domain/buyNext/types';
import { blackBelt, boots, coat, creamTrousers, polo, shirt, trainers } from './outfitFixtures';
import type { Piece } from '../domain/types';

/** A made-up buy-next list that goes with the small wardrobe. None of it is the owner's. */
const NOW = '2026-01-05T09:00:00.000Z';

export function wish(partial: Partial<WishItem> & Pick<WishItem, 'id' | 'name' | 'spec'>): WishItem {
  return { origin: 'your-looks', options: [], state: 'open', createdAt: NOW, updatedAt: NOW, ...partial };
}

export function option(partial: Partial<WishOption> & Pick<WishOption, 'id' | 'name'>): WishOption {
  return { role: 'exact', store: 'Sample Store', source: 'research', addedOn: '2026-01-02', ...partial };
}

/** The tags of a fixture piece, as a spec. */
function specOf(piece: Piece): WishItem['spec'] {
  const { slots, colorFamily, colorName, depth, texture, neckline, fit, hem, dressLevel, cloth, hardware, warmth, wetOk, tags } = piece;
  return { slots, colorFamily, colorName, depth, texture, neckline, fit, hem, dressLevel, cloth, hardware, warmth, wetOk, tags };
}

export const wantBelt = wish({ id: 'w-belt', name: 'Black belt', spec: specOf(blackBelt) });
export const wantCoat = wish({ id: 'w-coat', name: 'Grey wool coat', spec: specOf(coat), origin: 'beyond-looks', beyondSource: 'in-season' });
export const wantTrainers = wish({ id: 'w-trainers', name: 'White trainers', spec: { ...specOf(trainers), tags: ['sneaker'] } });
export const wantBoots = wish({ id: 'w-boots', name: 'Brown boots', spec: specOf(boots) });
export const wantShirt = wish({ id: 'w-shirt', name: 'White shirt', spec: specOf(shirt) });
export const wantPolo = wish({ id: 'w-polo', name: 'Blue knit polo', spec: specOf(polo), origin: 'beyond-looks', beyondSource: 'suits-you' });
export const wantCream = wish({ id: 'w-cream', name: 'Cream trousers', spec: specOf(creamTrousers) });
export const wantLeatherJacket = wish({
  id: 'w-leather',
  name: 'Black leather jacket',
  spec: { slots: ['outer-layer'], colorFamily: 'black', cloth: 'Leather', tags: [] },
});

export function sampleWishlist(): WishItem[] {
  return [
    {
      ...wantTrainers,
      sizeLabel: 'Shoes',
      wearsPerWeek: 3,
      why: 'Nothing in the wardrobe is casual.',
      lookFor: 'Plain white, low, no big logo.',
      options: [
        option({
          id: 'o-trainer-exact',
          name: 'Court Classic sneaker',
          url: 'https://shop.example/court-classic',
          price: 120,
          check: { on: '2026-01-02', by: 'research', price: 120 },
        }),
        option({ id: 'o-trainer-alike', role: 'lookalike', name: 'Everyday court sneaker', store: 'Another Shop', price: 60, givesUp: 'Coated canvas, not leather.' }),
      ],
    },
    { ...wantBelt, options: [option({ id: 'o-belt', name: 'Slim belt, 30 mm', price: 45, tryOnFirst: true })] },
    wantCoat,
    wantBoots,
    wantLeatherJacket,
    { ...wantShirt, holdUntil: '2026-03-01', holdReason: 'Shirts wait for spring.' },
  ];
}

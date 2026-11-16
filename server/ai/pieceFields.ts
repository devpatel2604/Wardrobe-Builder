import { COLOR_FAMILIES, DEPTHS, FITS, HARDWARE, NECKLINES, SLOTS, TEXTURES, WARMTHS, type Option } from '../../src/domain/options';
import { PROPOSAL_FIELDS } from '../../src/domain/tagging';

/**
 * The answer both piece kinds give (a photo, a store page), and the wording
 * that explains each field to the model. The lists come from the app's own
 * options file, so the model can only choose what the form can show.
 */

const values = <T>(options: Option<T>[]): T[] => options.map((o) => o.value);
const orNull = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const choice = <T>(options: Option<T>[]) => orNull({ type: 'string', enum: values(options) });
const text = orNull({ type: 'string' });

const properties = {
  subject: { type: 'string', enum: ['garment', 'product-page', 'worn-by-person', 'several-items', 'not-clothing'] },
  name: text,
  brand: text,
  slots: { type: 'array', items: { type: 'string', enum: values(SLOTS) } },
  colorFamily: choice(COLOR_FAMILIES),
  colorName: text,
  depth: choice(DEPTHS),
  texture: choice(TEXTURES),
  neckline: choice(NECKLINES),
  fit: choice(FITS),
  dressLevel: orNull({ type: 'integer', enum: [1, 2, 3] }),
  cloth: text,
  hardware: choice(HARDWARE),
  warmth: choice(WARMTHS),
  wetOk: orNull({ type: 'boolean' }),
  price: orNull({ type: 'number' }),
  tags: { type: 'array', items: { type: 'string' } },
  unsure: { type: 'array', items: { type: 'string', enum: [...PROPOSAL_FIELDS] } },
  note: text,
};

export const PIECE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

const listed = <T>(options: Option<T>[]) => options.map((o) => `${String(o.value)} (${o.hint ?? o.label})`).join('; ');

/** How to fill the fields that a photo and a page share. */
export const SHARED_FIELD_GUIDE = `- slots: where the piece goes in an outfit. One or more of: ${listed(SLOTS)}. A plain tee, or a shirt that works on its own and under a knit, gets both main-top and under-layer.
- colorFamily: the closest of: ${COLOR_FAMILIES.map((c) => `${c.value} (${c.label})`).join('; ')}. Use "other" only when none is close.
- depth: light, mid or dark.
- texture: ${listed(TEXTURES)}.
- neckline: only for tops and layers, null for everything else. One of: ${listed(NECKLINES)}.
- dressLevel: 1 is casual (tees, sweats, technical pants, sneakers). 2 is smart casual (knitwear, polos, chinos, overshirts, loafers). 3 is dressy (dress shirts, tailored trousers, blazers, dress shoes).
- hardware: the color of the zips, buttons and buckles you can see or that are described. One of: ${listed(HARDWARE)}. He avoids gold, so do not let gold or brass pass as silver. Null when you cannot tell.
- warmth: light, medium or warm, from how heavy the piece is.
- tags: up to five short lower-case tags for things he would search by that the other fields do not cover: a pattern (stripe, check), a knit or weave (cable knit, ribbed, corduroy), a detail (pleated, cuffed hem, chest pocket). No color words and no opinions.
- unsure: the names of the fields you filled but would not bet on.
- note: one short plain sentence for him when something could not be judged, or null.`;

export const NOT_A_PIECE = `If the subject is anything else, set every other field to null, slots, tags and unsure to empty lists, and say why in note.`;

export const READER = `The app belongs to one man who buys menswear. He checks every tag before it is saved, so give your best reading and say where you are not sure. A wrong tag that looks certain is worse than an empty one: use null when you cannot tell.`;

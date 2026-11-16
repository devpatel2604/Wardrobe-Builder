import { describe, expect, it } from 'vitest';
import type { InboxItem } from '../domain/inbox';
import { cleanProposal, type TaggingRecord } from '../domain/tagging';
import type { Piece } from '../domain/types';
import { applyProposal, blankForm, draftFromForm, fieldOf, formFromItem, formFromPiece } from './pieceFormState';

const proposal = (fields: Record<string, unknown>) => cleanProposal({ subject: 'garment', slots: ['main-top'], tags: [], unsure: [], ...fields });
const item = (fields: Partial<InboxItem>): InboxItem => ({ id: 'i1', kind: 'page', door: 'shortcut', receivedAt: '2026-01-05T09:00:00.000Z', ...fields });
const piece = (fields: Partial<Piece> = {}): Piece => ({
  id: 'p1',
  name: 'Cable crewneck',
  status: 'considering',
  slots: ['main-top'],
  wearCount: 0,
  tags: [],
  detailsConfirmed: false,
  createdAt: '2026-01-05T09:00:00.000Z',
  updatedAt: '2026-01-05T09:00:00.000Z',
  ...fields,
});

describe('starting the form from something waiting', () => {
  it('starts a photo as a piece you own, with nothing filled', () => {
    const { form, marks } = formFromItem(item({ kind: 'photo' }));
    expect(form).toEqual(blankForm());
    expect(marks).toEqual({});
  });

  it('starts a store page as something you are thinking about, with its link and a name from the title', () => {
    const { form, marks } = formFromItem(item({ url: 'https://shop.example/p/1', title: 'Pleated Wool Trousers - Sample Co' }));
    expect(form).toMatchObject({ status: 'considering', link: 'https://shop.example/p/1', name: 'Pleated Wool Trousers', detailsConfirmed: false });
    expect(marks).toEqual({ name: 'page-title' });
  });

  it('keeps a hyphenated name whole and marks nothing when there is no title', () => {
    expect(formFromItem(item({ title: 'Half-zip merino knit | Shop' })).form.name).toBe('Half-zip merino knit');
    expect(formFromItem(item({ kind: 'link', url: 'https://shop.example/p/1' }))).toMatchObject({ form: { name: '' }, marks: {} });
  });
});

describe('putting a proposal into the form', () => {
  it('fills empty fields, marks each one, and unticks "checked"', () => {
    const { form, marks } = applyProposal(blankForm(), {}, proposal({ name: 'Navy polo', colorFamily: 'navy', neckline: 'polo-collar', tags: ['pique', 'summer'], unsure: ['colorFamily'] }));
    expect(form).toMatchObject({ name: 'Navy polo', slots: ['main-top'], colorFamily: 'navy', neckline: 'polo-collar', tagText: 'pique, summer', detailsConfirmed: false });
    expect(marks).toEqual({ name: 'ai', slots: 'ai', colorFamily: 'ai-unsure', neckline: 'ai', tags: 'ai' });
  });

  it('leaves alone what the owner entered, and replaces what came from the page title or an earlier proposal', () => {
    const typed = { ...blankForm(), name: 'Sweater | Shop', brand: 'My brand', colorFamily: 'cream' as const, depth: 'light' as const };
    const { form, marks } = applyProposal(typed, { name: 'page-title', depth: 'ai' }, proposal({ name: 'Cable crewneck', brand: 'Sample Co', colorFamily: 'white', depth: 'mid' }));
    expect(form).toMatchObject({ name: 'Cable crewneck', brand: 'My brand', colorFamily: 'cream', depth: 'mid' });
    expect(marks).toMatchObject({ name: 'ai', depth: 'ai' });
    expect(marks.brand).toBeUndefined();
    expect(marks.colorFamily).toBeUndefined();
  });

  it('puts a page price in the store price, never in the price paid', () => {
    const { form, marks } = applyProposal(blankForm(), {}, cleanProposal({ subject: 'product-page', slots: ['shoes'], price: 120, tags: [], unsure: [] }));
    expect(form.listPrice).toBe('120');
    expect(form.price).toBe('');
    expect(marks.price).toBe('ai');
  });

  it('changes nothing when the model was not shown a single piece', () => {
    const start = { form: blankForm(), marks: {} };
    expect(applyProposal(start.form, start.marks, cleanProposal({ subject: 'worn-by-person', name: 'A man in a coat', slots: ['outer-layer'] }))).toEqual(start);
    expect(applyProposal(start.form, start.marks, cleanProposal({ subject: 'garment', name: 'Something', slots: [] }))).toEqual(start);
  });

  it('knows which form field belongs to which proposal field', () => {
    expect(fieldOf('tagText')).toBe('tags');
    expect(fieldOf('listPrice')).toBe('price');
    expect(fieldOf('colorFamily')).toBe('colorFamily');
    expect(fieldOf('size')).toBeUndefined();
    expect(fieldOf('price')).toBeUndefined();
  });
});

describe('turning the form into a piece', () => {
  const today = '2026-01-06';

  it('dates a newly entered store price today', () => {
    const draft = draftFromForm({ ...blankForm(), name: 'Loafer', slots: ['shoes'], listPrice: '189.50' }, { today });
    expect(draft).toMatchObject({ listPrice: 189.5, listPriceOn: today });
  });

  it('keeps the old date while the price is the same, and moves it when the price changes', () => {
    const saved = piece({ listPrice: 89.9, listPriceOn: '2025-12-01' });
    expect(draftFromForm(formFromPiece(saved), { piece: saved, today })).toMatchObject({ listPrice: 89.9, listPriceOn: '2025-12-01' });
    expect(draftFromForm({ ...formFromPiece(saved), listPrice: '79' }, { piece: saved, today })).toMatchObject({ listPrice: 79, listPriceOn: today });
  });

  it('drops the date with the price', () => {
    const saved = piece({ listPrice: 89.9, listPriceOn: '2025-12-01' });
    const draft = draftFromForm({ ...formFromPiece(saved), listPrice: '' }, { piece: saved, today });
    expect(draft.listPrice).toBeUndefined();
    expect(draft.listPriceOn).toBeUndefined();
  });

  it('keeps the AI record through a later edit', () => {
    const tagging: TaggingRecord = { source: 'photo', model: 'claude-opus-5-5', at: '2026-01-05T09:00:00.000Z', proposal: proposal({ name: 'Navy polo' }) };
    const saved = piece({ tagging });
    expect(draftFromForm({ ...formFromPiece(saved), name: 'Navy pique polo' }, { piece: saved, today }).tagging).toEqual(tagging);
    expect(draftFromForm(blankForm(), { today }).tagging).toBeUndefined();
  });
});

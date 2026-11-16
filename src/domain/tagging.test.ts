import { describe, expect, it } from 'vitest';
import { canBecomeLook, canBecomePiece, isInstagramLink, siteOf, type InboxItem } from './inbox';
import { cleanProposal, filledFields, isUsable, subjectProblem } from './tagging';

describe('cleanProposal', () => {
  it('keeps values that are on the app\'s own lists', () => {
    const proposal = cleanProposal({
      subject: 'garment',
      name: '  Navy   cable-knit quarter-zip ',
      brand: null,
      slots: ['main-top', 'main-top'],
      colorFamily: 'navy',
      depth: 'dark',
      texture: 'rough',
      neckline: 'quarter-zip',
      fit: 'regular',
      dressLevel: 2,
      hardware: 'silver',
      warmth: 'warm',
      tags: ['Cable Knit', 'cable knit', ' ribbed hem '],
      unsure: ['fit', 'hardware', 'cloth'],
      note: 'The zip looks silver.',
    });
    expect(proposal).toMatchObject({
      subject: 'garment',
      name: 'Navy cable-knit quarter-zip',
      slots: ['main-top'],
      colorFamily: 'navy',
      neckline: 'quarter-zip',
      dressLevel: 2,
      tags: ['cable knit', 'ribbed hem'],
      note: 'The zip looks silver.',
    });
    expect(proposal.brand).toBeUndefined();
    // "cloth" was listed as unsure but never filled, so it is dropped.
    expect(proposal.unsure).toEqual(['fit', 'hardware']);
    expect(isUsable(proposal)).toBe(true);
  });

  it('drops anything a model made up', () => {
    const proposal = cleanProposal({
      subject: 'garment',
      slots: ['trousers', 'cape'],
      colorFamily: 'teal',
      depth: 'very dark',
      neckline: 'crew',
      fit: 'boxy',
      dressLevel: 4,
      hardware: 'rose gold',
      price: -5,
      wetOk: 'yes',
      tags: 'pleated',
      unsure: 'everything',
    });
    expect(proposal.slots).toEqual(['trousers']);
    expect(proposal.colorFamily).toBeUndefined();
    expect(proposal.depth).toBeUndefined();
    expect(proposal.dressLevel).toBeUndefined();
    expect(proposal.hardware).toBeUndefined();
    expect(proposal.price).toBeUndefined();
    expect(proposal.wetOk).toBeUndefined();
    expect(proposal.tags).toEqual([]);
    expect(proposal.unsure).toEqual([]);
    // Shape tags only belong on a top.
    expect(proposal.neckline).toBeUndefined();
    expect(proposal.fit).toBeUndefined();
    expect(filledFields(proposal)).toEqual(['slots']);
  });

  it('reads a store page, with its price and cloth', () => {
    const proposal = cleanProposal({ subject: 'product-page', name: 'Pleated chino', brand: 'Sample Co', slots: ['trousers'], colorName: 'Coffee', cloth: '98% cotton, 2% elastane', price: 79.999, wetOk: null, tags: [], unsure: [] });
    expect(proposal).toMatchObject({ brand: 'Sample Co', colorName: 'Coffee', cloth: '98% cotton, 2% elastane', price: 80 });
    expect(isUsable(proposal)).toBe(true);
  });

  it('gives no tags for a photo of a person, and says why', () => {
    const proposal = cleanProposal({ subject: 'worn-by-person', slots: [], tags: [], unsure: [], note: null });
    expect(isUsable(proposal)).toBe(false);
    expect(subjectProblem(proposal.subject)).toContain('someone wearing');
  });

  it('survives an answer that is not an object at all', () => {
    expect(cleanProposal(null)).toMatchObject({ subject: 'not-clothing', slots: [], tags: [], unsure: [] });
    expect(isUsable(cleanProposal('garment'))).toBe(false);
  });
});

describe('inbox items', () => {
  const item = (partial: Partial<InboxItem>): InboxItem => ({ id: 'i1', kind: 'link', door: 'shortcut', receivedAt: '2026-01-05T09:00:00.000Z', ...partial });

  it('knows an Instagram link from a store link', () => {
    expect(isInstagramLink('https://www.instagram.com/reel/abc/')).toBe(true);
    expect(isInstagramLink('https://instagram.com/p/abc/')).toBe(true);
    expect(isInstagramLink('https://notinstagram.com/p/abc/')).toBe(false);
    expect(isInstagramLink('not a link')).toBe(false);
    expect(siteOf('https://www.shop.example/p/1?x=2')).toBe('shop.example');
  });

  it('sends each kind the right way', () => {
    expect(canBecomePiece(item({ kind: 'photo' }))).toBe(true);
    expect(canBecomePiece(item({ kind: 'page' }))).toBe(true);
    expect(canBecomePiece(item({ kind: 'link', url: 'https://shop.example/p/1' }))).toBe(true);
    expect(canBecomePiece(item({ kind: 'link', url: 'https://www.instagram.com/reel/abc/' }))).toBe(false);
    expect(canBecomePiece(item({ kind: 'screenshot' }))).toBe(false);
    expect(canBecomeLook(item({ kind: 'screenshot' }))).toBe(true);
    expect(canBecomeLook(item({ kind: 'link', url: 'https://shop.example/p/1' }))).toBe(true);
    expect(canBecomeLook(item({ kind: 'photo' }))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { option, wantBoots, wantTrainers, wish } from '../../test/buyFixtures';
import { fitChecksFor, suggestVerdict } from './fitCheck';
import { cleanLeads, leadToOption, pageKey } from './leads';
import { checkLine, costPerWear, monthDay, safeUrl, searchLinks, specFromLook, standingOf, wishKey } from './wishes';

const today = '2026-01-06';

describe('telling list lines apart', () => {
  it('treats the same slot, color group, collar and kind as the same thing', () => {
    const fromLook = { name: 'White button-down shirt', spec: specFromLook({ slot: 'main-top', name: 'x', colorFamily: 'white', neckline: 'shirt-collar', tags: [], lookId: 'l1' }) };
    expect(wishKey(fromLook)).toBe(wishKey({ name: 'White shirt', spec: { slots: ['main-top'], colorFamily: 'white', neckline: 'shirt-collar', tags: [] } }));
    expect(wishKey(fromLook)).not.toBe(wishKey({ name: 'White tee', spec: { slots: ['main-top'], colorFamily: 'white', neckline: 'crew', tags: [] } }));
  });

  it('keeps boots and sneakers of one color apart', () => {
    const sneaker = { name: 'Brown suede sneaker', spec: { slots: ['shoes' as const], colorFamily: 'brown' as const, tags: [] } };
    expect(wishKey(sneaker)).not.toBe(wishKey(wantBoots));
    expect(wishKey(sneaker)).toBe(wishKey({ name: 'Low top', spec: { ...sneaker.spec, tags: ['sneaker'] } }));
  });
});

describe('the dated status of a product', () => {
  it('says when nobody has looked', () => {
    expect(checkLine(option({ id: 'o', name: 'X' }), today)).toEqual({ text: 'Not checked at the store yet.', weak: true });
  });

  it('marks an AI lead as unchecked, with the day of the search', () => {
    const line = checkLine(option({ id: 'o', name: 'X', source: 'ai-lead', addedOn: '2026-01-05' }), today);
    expect(line.weak).toBe(true);
    expect(line.text).toMatch(/^AI lead from Jan 5\. Nobody has opened the page/);
  });

  it('gives the date of the price and says the size was not checked', () => {
    const line = checkLine(option({ id: 'o', name: 'X', check: { on: '2026-01-02', by: 'research', price: 120 } }), today);
    expect(line).toEqual({ text: 'Price seen Jan 2 by the research, not by you, size not checked.', weak: false });
  });

  it('reads back what the owner saw', () => {
    const line = checkLine(option({ id: 'o', name: 'X', check: { on: '2026-01-06', by: 'you', price: 98, stock: 'in-stock', size: 'M', pickup: 'today' } }), today);
    expect(line.text).toBe('Price seen Jan 6, in stock in M, pickup today at your store.');
    expect(checkLine(option({ id: 'o', name: 'X', check: { on: '2026-01-06', by: 'you', stock: 'sold-out-in-size' } }), today).text).toBe('Seen Jan 6, sold out in your size.');
  });

  it('shows an old check as old', () => {
    const line = checkLine(option({ id: 'o', name: 'X', check: { on: '2025-12-20', by: 'you', price: 98, stock: 'in-stock' } }), today);
    expect(line.weak).toBe(true);
    expect(line.text).toBe('Price seen Dec 20, 2025, in stock. That was 17 days ago.');
  });

  it('writes dates the short way', () => {
    expect(monthDay('2026-11-15')).toBe('Nov 15');
    expect(monthDay('2027-03-01', '2026-11-15')).toBe('Mar 1, 2027');
  });
});

describe('where a line stands', () => {
  const exact = option({ id: 'e', name: 'Exact' });
  const alike = option({ id: 'a', name: 'Alike', role: 'lookalike' });

  it('has nothing to buy until a product is under it', () => {
    expect(standingOf(wantTrainers).status).toBe('no-products');
  });

  it('picks the exact item, or the owner\'s own pick', () => {
    expect(standingOf({ ...wantTrainers, options: [alike, exact] })).toMatchObject({ status: 'buy', pick: exact });
    expect(standingOf({ ...wantTrainers, options: [exact, { ...alike, chosen: true }] }).pick?.id).toBe('a');
  });

  it('waits when it is sold out in the owner\'s size', () => {
    const soldOut = { ...exact, check: { on: today, by: 'you' as const, stock: 'sold-out-in-size' as const, size: '32' } };
    expect(standingOf({ ...wantTrainers, options: [soldOut] })).toMatchObject({ status: 'wait', text: 'Wait: sold out in your size.' });
    // Another product that is not sold out can still be bought.
    expect(standingOf({ ...wantTrainers, options: [soldOut, alike] })).toMatchObject({ status: 'buy', pick: alike });
    // But not when the sold-out one is the owner's pick.
    expect(standingOf({ ...wantTrainers, options: [{ ...soldOut, chosen: true }, alike] })).toMatchObject({ status: 'wait', text: 'Wait: your pick is sold out in 32.' });
  });

  it('says a fitting-room decision is one', () => {
    expect(standingOf({ ...wantTrainers, options: [{ ...exact, tryOnFirst: true }] }).status).toBe('try-on-first');
  });

  it('says when the exact item is no longer made and falls back on the lookalike', () => {
    const gone = { ...exact, check: { on: today, by: 'you' as const, stock: 'no-longer-made' as const } };
    expect(standingOf({ ...wantTrainers, options: [gone, alike] })).toMatchObject({ status: 'buy', pick: alike, exactGone: true, text: 'The exact item is no longer made. These come nearest.' });
    expect(standingOf({ ...wantTrainers, options: [gone] })).toMatchObject({ status: 'no-longer-made', exactGone: true });
  });
});

describe('small sums and links', () => {
  it('guesses the cost per wear over a first season', () => {
    expect(costPerWear(130, 2)).toBeCloseTo(5);
    expect(costPerWear(130, undefined)).toBeUndefined();
    expect(costPerWear(undefined, 2)).toBeUndefined();
  });

  it('builds a search link for each of the owner\'s stores, and never one that is not https', () => {
    const links = searchLinks(wish({ id: 'w', name: 'Cream pleated trousers', spec: { slots: ['trousers'], tags: [] } }), [
      { id: '1', name: "Macy's" },
      { id: '2', name: 'Corner Shop' },
    ]);
    expect(links[0]).toEqual({ store: "Macy's", url: "https://www.macys.com/shop/search?keyword=men's%20cream%20pleated%20trousers" });
    expect(links[1]!.url).toBe("https://www.google.com/search?q=Corner%20Shop%20men's%20cream%20pleated%20trousers");
    expect(links.every((l) => safeUrl(l.url) !== undefined)).toBe(true);
  });

  it('opens only plain https links', () => {
    expect(safeUrl('https://shop.example/p/1')).toBe('https://shop.example/p/1');
    expect(safeUrl('http://shop.example/p/1')).toBeUndefined();
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('https://user:pw@shop.example/')).toBeUndefined();
    expect(safeUrl('not a link')).toBeUndefined();
  });
});

describe('the fit check', () => {
  it('asks about what the piece has', () => {
    expect(fitChecksFor(['main-top']).map((c) => c.id)).toEqual(['shoulders', 'top-length', 'body', 'hardware', 'cloth']);
    expect(fitChecksFor(['trousers']).map((c) => c.id)).toEqual(['trouser-rise', 'trouser-length', 'hardware', 'cloth']);
    expect(fitChecksFor(['shoes']).map((c) => c.id)).toEqual(['hardware', 'cloth']);
    expect(fitChecksFor(['outer-layer'], true).find((c) => c.id === 'top-length')!.pass).toBe('The hem ends at mid-thigh or above.');
  });

  it('only offers a tailor where a tailor can help', () => {
    const tailorable = [...fitChecksFor(['main-top']), ...fitChecksFor(['trousers'])].filter((c) => c.tailorable).map((c) => c.id);
    expect(tailorable).toEqual(['top-length', 'body', 'trouser-length']);
  });

  it('points to keep, tailor or return', () => {
    expect(suggestVerdict({ shoulders: 'pass', body: 'pass' })).toBe('keep');
    expect(suggestVerdict({ shoulders: 'pass', body: 'fixable' })).toBe('tailor');
    expect(suggestVerdict({ shoulders: 'fail', body: 'fixable' })).toBe('return');
  });
});

describe('AI leads', () => {
  const seen = [
    { url: 'https://shop.example/p/cream-trousers', title: 'Cream wool trousers | Shop', pageAge: 'October 3, 2026' },
    { url: 'https://other.example/p/trousers?color=cream', title: 'Pleated trousers' },
    { url: 'https://third.example/p/dear' },
  ];
  const product = (url: string, price: number | null, extra: Record<string, unknown> = {}) => ({ name: 'Trousers', store: 'Shop', url, price, givesUp: null, note: null, ...extra });

  it('keeps a lead only when its link is one the search returned', () => {
    const cleaned = cleanLeads(
      {
        pairs: [
          { exact: product('https://shop.example/p/cream-trousers/', 180), lookalike: product('https://other.example/p/trousers?color=cream', 60, { givesUp: 'Cotton, not wool.' }) },
          { exact: product('https://shop.example/p/made-up', 99), lookalike: null },
        ],
        note: 'Few stores had a winter cloth.',
      },
      seen,
    );
    expect(cleaned.leads.map((l) => [l.role, l.url, l.pair])).toEqual([
      ['exact', 'https://shop.example/p/cream-trousers', 0],
      ['lookalike', 'https://other.example/p/trousers?color=cream', 0],
    ]);
    expect(cleaned.dropped).toBe(1);
    expect(cleaned.note).toBe('Few stores had a winter cloth.');
    expect(cleaned.leads[0]).toMatchObject({ resultTitle: 'Cream wool trousers | Shop', pageAge: 'October 3, 2026', price: 180 });
  });

  it('leaves out a lookalike that is not cheaper', () => {
    const cleaned = cleanLeads({ pairs: [{ exact: product(seen[0]!.url, 100), lookalike: product(seen[1]!.url, 100) }] }, seen);
    expect(cleaned.leads.map((l) => l.role)).toEqual(['exact']);
    expect(cleaned.dropped).toBe(1);
  });

  it('never passes on a link that is not plain https, or the same page twice', () => {
    expect(pageKey('http://shop.example/p')).toBeUndefined();
    expect(pageKey('javascript:alert(1)')).toBeUndefined();
    expect(pageKey('https://Shop.Example/p/#reviews')).toBe('shop.example/p');
    const cleaned = cleanLeads({ pairs: [{ exact: product(seen[0]!.url, 100), lookalike: product(seen[0]!.url, 50) }] }, [...seen, { url: 'http://plain.example/p' }]);
    expect(cleaned.leads).toHaveLength(1);
  });

  it('survives an answer of any shape', () => {
    for (const raw of [null, 'text', [], { pairs: 'x' }, { pairs: [null, 4, { exact: 'x' }] }]) {
      expect(cleanLeads(raw, seen).leads).toEqual([]);
    }
    expect(cleanLeads({ pairs: [{ exact: product(seen[0]!.url, -5, { name: 7 }) }] }, seen).leads).toEqual([]);
    expect(cleanLeads({ pairs: [{ exact: product(seen[0]!.url, 'cheap' as unknown as number) }] }, seen).leads[0]!.price).toBeUndefined();
  });

  it('stores a lead as an unchecked product that says where it came from', () => {
    const lead = cleanLeads({ pairs: [{ exact: product(seen[0]!.url, 180, { note: 'Flannel.' }) }] }, seen).leads[0]!;
    expect(leadToOption(lead, 'new-id', today)).toEqual({
      id: 'new-id',
      role: 'exact',
      name: 'Trousers',
      store: 'Shop',
      url: 'https://shop.example/p/cream-trousers',
      price: 180,
      givesUp: undefined,
      note: 'Flannel. Search result: "Cream wool trousers | Shop", October 3, 2026.',
      source: 'ai-lead',
      addedOn: today,
    });
  });
});

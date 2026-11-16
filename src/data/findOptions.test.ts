// @vitest-environment node
// Runs outside the browser stand-in, because the local Cloudflare server cannot start inside it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiErrorCode } from './ai';
import { db } from './db';
import { connectServer } from './server';
import { findOptions, getWish } from './wishlistRepo';
import { leadsRequest } from '../domain/buyNext/leads';
import { sampleProfile } from '../test/fixtures';
import { sampleWishlist } from '../test/buyFixtures';
import { startAppServer, type AppServer } from '../test/appServer';

let server: AppServer;
beforeAll(async () => {
  server = await startAppServer();
}, 30_000);
afterAll(() => server.close());
beforeEach(async () => {
  await server.reset();
  vi.stubGlobal('fetch', server.fetch);
  await db.wishlist.bulkPut(sampleWishlist());
});
afterEach(() => vi.unstubAllGlobals());

const today = '2026-01-06';
const trainers = () => sampleWishlist()[0]!;
const request = () => leadsRequest(trainers(), sampleProfile());

const result = (url: string, title: string) => ({ type: 'web_search_result', url, title, encrypted_content: 'x', page_age: null });
const product = (name: string, store: string, url: string, price: number | null, givesUp: string | null = null) => ({ name, store, url, price, givesUp, note: null });

/** The provider's answer after one search: two new pages, one page already on the line, and one made-up link. */
function searched() {
  const answer = {
    pairs: [
      {
        exact: product('Leather court sneaker', 'Third Store', 'https://third.example/p/court', 140),
        lookalike: product('Canvas court sneaker', 'Fourth Store', 'https://fourth.example/p/canvas', 55, 'Canvas, not leather.'),
      },
      { exact: product('Court Classic sneaker', 'Sample Store', 'https://shop.example/court-classic', 120), lookalike: null },
      { exact: product('Made-up sneaker', 'Nowhere', 'https://nowhere.example/p/1', 80), lookalike: null },
    ],
    note: null,
  };
  return {
    messageContent: [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: "men's white trainers" } },
      {
        type: 'web_search_tool_result',
        tool_use_id: 'srvtoolu_1',
        content: [
          result('https://third.example/p/court', 'Leather court sneaker | Third Store'),
          result('https://fourth.example/p/canvas', 'Canvas court sneaker'),
          result('https://shop.example/court-classic', 'Court Classic sneaker'),
        ],
      },
      { type: 'text', text: `<answer>${JSON.stringify(answer)}</answer>` },
    ],
  };
}

describe('find options, from the app to the server', () => {
  it('sends the piece, the size, the stores and the rules, and nothing else about the owner', () => {
    const body = request();
    expect(body).toEqual({
      name: 'White trainers',
      lookFor: 'Plain white, low, no big logo.',
      size: undefined,
      stores: ['Sample Store', 'Another Shop'],
      rules: ['No leather clothing and no leather watch straps.', 'Silver over gold.', 'Nothing boxy or long.', 'A winter coat may reach mid-thigh.', 'Top hems end between the belt and mid-fly.'],
      have: ['Court Classic sneaker (Sample Store)', 'Everyday court sneaker (Another Shop)'],
    });
    const withSize = leadsRequest({ ...trainers(), sizeLabel: 'Pants' }, sampleProfile());
    expect(withSize.size).toBe('Pants 32 × 32');
    const sent = JSON.stringify(withSize);
    for (const personal of ['Springfield', '160 lb', "5'10", 'Light olive']) expect(sent).not.toContain(personal);
  });

  it('is switched off while the server has no AI key, and leaves the line as it was', async () => {
    await connectServer(server.key);
    const error = await findOptions('w-trainers', request(), today).catch((e: unknown) => e);
    expect(aiErrorCode(error)).toBe('no-ai-key');
    expect((await getWish('w-trainers'))?.options).toHaveLength(2);
    expect(server.outside).toHaveLength(0);
  });

  it('stores what the search found as unchecked AI leads, without doubles or made-up links', async () => {
    await connectServer(server.key);
    const sentToProvider: Record<string, unknown>[] = [];
    server.ai = (body) => {
      sentToProvider.push(body);
      return searched();
    };

    const found = await findOptions('w-trainers', request(), today);

    // Two new pages. The page already on the line is not added twice, and the made-up link never arrives.
    expect(found.added).toBe(2);
    expect(found.result.dropped).toBe(1);
    expect(found.today.used).toBe(1);
    const options = (await getWish('w-trainers'))!.options;
    expect(options).toHaveLength(4);
    expect(options.slice(2)).toEqual([
      expect.objectContaining({ role: 'exact', name: 'Leather court sneaker', store: 'Third Store', url: 'https://third.example/p/court', price: 140, source: 'ai-lead', addedOn: today }),
      expect.objectContaining({ role: 'lookalike', name: 'Canvas court sneaker', price: 55, givesUp: 'Canvas, not leather.', source: 'ai-lead' }),
    ]);
    expect(options.slice(2).every((o) => o.check === undefined)).toBe(true);

    // The server made one outside call, to the AI provider, and none to any store.
    expect(server.outside.map((call) => new URL(call.url).host)).toEqual(['api.anthropic.com']);
    expect(JSON.stringify(sentToProvider[0]!.tools)).not.toContain('web_fetch');

    // A second tap with the same answer adds nothing.
    expect((await findOptions('w-trainers', request(), today)).added).toBe(0);
  });
});

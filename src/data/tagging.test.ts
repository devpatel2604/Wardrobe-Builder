// @vitest-environment node
// Runs outside the browser stand-in, because the local Cloudflare server cannot start inside it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiErrorCode } from './ai';
import { addInboxItem, getInboxItem } from './inboxRepo';
import { connectServer } from './server';
import { canSuggest, suggestTags, whatIsSent } from './tagging';
import { fakeImage } from '../test/fixtures';
import { startAppServer, type AppServer } from '../test/appServer';

// There is no canvas outside a browser. The stand-in names the size it was asked for.
vi.mock('./images', async (original) => ({
  ...(await original<typeof import('./images')>()),
  imageForAi: vi.fn(async (_image: unknown, maxEdge: number) => ({ mediaType: 'image/jpeg', data: btoa(`picture-at-${maxEdge}`) })),
}));

let server: AppServer;
beforeAll(async () => {
  server = await startAppServer();
}, 30_000);
afterAll(() => server.close());
beforeEach(async () => {
  await server.reset();
  vi.stubGlobal('fetch', server.fetch);
  await connectServer(server.key);
});
afterEach(() => vi.unstubAllGlobals());

const image = (cutout: boolean) => ({ ...fakeImage(), cutout });
/** What the server sent to the provider: the text and pictures of the one user turn. */
function sentToProvider(): { text: string; pictures: string[] } {
  const call = server.outside.find((c) => c.url.startsWith('https://api.anthropic.com/'))!;
  const body = JSON.parse(String(call.init?.body)) as { messages: { content: { type: string; text?: string; source?: { data: string } }[] }[] };
  const content = body.messages[0]!.content;
  return { text: content.map((c) => c.text ?? '').join('\n'), pictures: content.filter((c) => c.type === 'image').map((c) => atob(c.source!.data)) };
}

const KNIT = {
  subject: 'garment',
  name: 'Cable crewneck',
  brand: null,
  slots: ['main-top'],
  colorFamily: 'burgundy',
  colorName: null,
  depth: 'dark',
  texture: 'rough',
  neckline: 'crew',
  fit: 'regular',
  dressLevel: 2,
  cloth: '100% cotton',
  hardware: 'none',
  warmth: 'warm',
  wetOk: null,
  price: null,
  tags: ['cable knit'],
  unsure: ['fit'],
  note: null,
};

describe('asking for tags', () => {
  it('sends a photo at the small size and its label at the larger one, and keeps the answer with the item', async () => {
    server.ai = () => KNIT;
    const item = await addInboxItem({ kind: 'photo', door: 'paste', image: image(true), extraImage: image(false) });
    const { proposal, model } = await suggestTags(item);

    expect(sentToProvider().pictures).toEqual(['picture-at-1024', 'picture-at-1568']);
    expect(proposal).toMatchObject({ subject: 'garment', name: 'Cable crewneck', slots: ['main-top'], cloth: '100% cotton', unsure: ['fit'] });
    expect(model).toBe('claude-opus-5-5');
    const kept = await getInboxItem(item.id);
    expect(kept).toMatchObject({ proposal: { name: 'Cable crewneck' }, proposalModel: 'claude-opus-5-5' });
    expect(kept?.proposedAt).toBeTruthy();
  });

  it('sends a store page as its text and link, with no picture unless a screenshot was added', async () => {
    server.ai = () => ({ ...KNIT, subject: 'product-page', price: 89.9 });
    const item = await addInboxItem({ kind: 'page', door: 'shortcut', url: 'https://shop.example/p/1', title: 'Cable crewneck | Shop', text: 'Cable crewneck. 100% cotton. $89.90' });
    const { proposal } = await suggestTags(item);
    const sent = sentToProvider();
    expect(sent.pictures).toEqual([]);
    expect(sent.text).toContain('Cable crewneck. 100% cotton. $89.90');
    expect(sent.text).toContain('https://shop.example/p/1');
    expect(proposal.price).toBe(89.9);
    // The server never loads the store's site: its only outside call is to the AI provider.
    expect(server.outside.map((c) => new URL(c.url).hostname)).toEqual(['api.anthropic.com']);
  });

  it('drops anything the model made up that is not on the app\'s lists', async () => {
    server.ai = () => ({ ...KNIT, colorFamily: 'oxblood', neckline: 'boat', tags: ['Cable Knit', 'cable knit'], unsure: ['neckline', 'fit'] });
    const item = await addInboxItem({ kind: 'photo', door: 'paste', image: image(true) });
    const { proposal } = await suggestTags(item);
    expect(proposal.colorFamily).toBeUndefined();
    expect(proposal.neckline).toBeUndefined();
    expect(proposal.tags).toEqual(['cable knit']);
    expect(proposal.unsure).toEqual(['fit']);
  });

  it('fails with "no AI key" while the server has none, and keeps nothing', async () => {
    const item = await addInboxItem({ kind: 'photo', door: 'paste', image: image(true) });
    const error = await suggestTags(item).catch((e: unknown) => e);
    expect(aiErrorCode(error)).toBe('no-ai-key');
    expect(server.outside).toHaveLength(0);
    expect((await getInboxItem(item.id))?.proposal).toBeUndefined();
  });

  it('will not ask about a link with nothing to read', async () => {
    server.ai = () => KNIT;
    const item = await addInboxItem({ kind: 'link', door: 'paste', url: 'https://shop.example/p/1' });
    expect(canSuggest(item)).toBe(false);
    await expect(suggestTags(item)).rejects.toThrow('Add a screenshot');
    expect(server.outside).toHaveLength(0);
  });
});

describe('saying what will be sent', () => {
  it('names a cut-out, a photo with its background, and a label', () => {
    expect(whatIsSent({ id: 'a', kind: 'photo', door: 'paste', receivedAt: '', image: image(true) })).toMatch(/^This cut-out goes to your server/);
    expect(whatIsSent({ id: 'a', kind: 'photo', door: 'picker', receivedAt: '', image: image(false) })).toMatch(/whatever is behind the piece/);
    expect(whatIsSent({ id: 'a', kind: 'photo', door: 'paste', receivedAt: '', image: image(true), extraImage: image(false) })).toMatch(/and the label photo go to your server/);
  });

  it('names the text and the screenshot of a page', () => {
    expect(whatIsSent({ id: 'a', kind: 'page', door: 'shortcut', receivedAt: '', text: 'x', extraImage: image(false) })).toMatch(/The link and the page's text and your screenshot go/);
    expect(whatIsSent({ id: 'a', kind: 'link', door: 'paste', receivedAt: '', extraImage: image(false) })).toMatch(/The link and your screenshot go/);
  });
});

// @vitest-environment node
// Runs outside the browser stand-in, because the local Cloudflare server cannot start inside it.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportBackup, importBackup, parseBackup } from './backup';
import { db } from './db';
import { addInboxItem, listInbox } from './inboxRepo';
import { forgetReadingState, readLook, readingState } from './lookReader';
import { buyListReady, connectBuyList, dropLookFromBuyList, openWishIds, sendMissingToBuyList, sendPieceToBuyList, syncLookWishes, type BuyList, type LookWish } from './lookWishes';
import {
  MAX_SCREENSHOTS,
  addLookPhotos,
  applyReading,
  attachInboxScreenshot,
  confirmLook,
  createLook,
  deleteLook,
  getLook,
  listLookPhotos,
  listLooks,
  lookCovers,
  removeLookPiece,
  saveLookFromShare,
  saveLookPiece,
  setPieceChoice,
  setStandIn,
  updateLookDetails,
} from './looksRepo';
import { connectServer } from './server';
import { lookCredit, type LookPiece } from '../domain/looks';
import { startAppServer, type AppServer } from '../test/appServer';
import { fakeImage, sampleSetupFile } from '../test/fixtures';

let server: AppServer;
beforeAll(async () => {
  server = await startAppServer();
}, 30_000);
afterAll(() => server.close());
beforeEach(async () => {
  await server.reset();
  vi.stubGlobal('fetch', server.fetch);
  forgetReadingState();
  connectBuyList(undefined);
});
afterEach(() => vi.unstubAllGlobals());

const REEL = 'https://www.instagram.com/some.creator/reel/Cabc123/?igsh=xyz';

const knit = { slot: 'main-top' as const, description: 'Navy zip cardigan', colorFamily: 'navy' as const, neckline: 'full-zip' as const, tags: [] };
const trousers = { slot: 'trousers' as const, description: 'cream pleated trousers', colorFamily: 'cream' as const, tags: ['Pleated', 'pleated'] };
const shoes = { slot: 'shoes' as const, description: 'Brown suede loafers', colorFamily: 'brown' as const, tags: [] };

/** The answer the model stand-in gives. */
const answer = {
  pieces: [
    { slot: 'main-top', description: 'burgundy cable-knit crewneck', colorFamily: 'burgundy', depth: 'dark', texture: 'rough', neckline: 'crew', fit: null, hem: null, material: 'Cable Knit', hardware: null, dressLevel: 2, tags: ['cable knit'], confidence: 'high' },
    { slot: 'trousers', description: 'cream pleated trousers', colorFamily: 'cream', depth: 'light', texture: 'smooth', neckline: 'crew', fit: null, hem: null, material: null, hardware: null, dressLevel: 3, tags: ['pleated'], confidence: 'medium' },
    { slot: 'hat', description: 'a slot the app does not have', colorFamily: null, depth: null, texture: null, neckline: null, fit: null, hem: null, material: null, hardware: null, dressLevel: null, tags: [], confidence: 'low' },
  ],
  account: 'Some.Creator',
  notes: 'The shoes are out of frame.',
};

describe('saving a look', () => {
  it('ties a look to its post only when the link is saved', async () => {
    const { look: tied } = await createLook({ link: `Look at this ${REEL}` });
    expect(tied.link).toBe('https://www.instagram.com/some.creator/reel/Cabc123/');
    expect(tied.creator).toBe('@some.creator');
    expect(lookCredit(tied)).toEqual({ text: '@some.creator, post saved', tied: true });

    const { look: loose } = await createLook({ creator: 'another.name' });
    expect(loose.link).toBeUndefined();
    expect(lookCredit(loose)).toMatchObject({ text: 'in the style of another.name', tied: false });

    const { look: bare } = await createLook({});
    expect(lookCredit(bare)).toBeUndefined();
    expect(bare.name).toBe('Saved look');
  });

  it('gives back the look already saved for a post, however the link was copied', async () => {
    const first = await createLook({ link: REEL });
    const again = await saveLookFromShare({ url: 'https://instagram.com/reel/Cabc123' });
    expect(again).toMatchObject({ existing: true, look: { id: first.look.id } });
    expect(await listLooks()).toHaveLength(1);
  });

  it('refuses text that holds no link', async () => {
    await expect(createLook({ link: 'not a link' })).rejects.toThrow('does not look like a link');
    expect(await listLooks()).toHaveLength(0);
  });

  it('unties a look when its link is removed, and keeps a typed name', async () => {
    const { look } = await createLook({ link: REEL, name: 'Sunday knit' });
    const loose = await updateLookDetails(look.id, { name: 'Sunday knit', link: '', creator: '@some.creator', notes: ' From a reel ' });
    expect(loose).toMatchObject({ name: 'Sunday knit', link: undefined, notes: 'From a reel' });
    expect(lookCredit(loose)?.tied).toBe(false);
  });
});

describe('the pieces of a look', () => {
  it('keeps pieces in outfit order, tidies them, and names the look after them', async () => {
    const { look } = await createLook({});
    await saveLookPiece(look.id, shoes);
    await saveLookPiece(look.id, { ...trousers, neckline: 'crew' });
    const saved = await saveLookPiece(look.id, knit);
    expect(saved.pieces.map((p) => p.slot)).toEqual(['main-top', 'trousers', 'shoes']);
    expect(saved.pieces[1]).toMatchObject({ description: 'cream pleated trousers', tags: ['pleated'], from: 'you' });
    // A neckline means nothing on trousers.
    expect(saved.pieces[1]!.neckline).toBeUndefined();
    expect(saved.name).toBe('Navy zip cardigan, cream pleated trousers, brown suede loafers');
  });

  it('waits for the owner to check the pieces, and has none to check when empty', async () => {
    const { look } = await createLook({});
    await expect(confirmLook(look.id)).rejects.toThrow('at least one piece');
    const withPiece = await saveLookPiece(look.id, knit);
    expect((await confirmLook(look.id)).confirmedAt).toBeTruthy();
    const empty = await removeLookPiece(look.id, withPiece.pieces[0]!.id);
    expect(empty.confirmedAt).toBeUndefined();
  });

  it('keeps what the owner wrote when a reading comes in, and asks for a new check', async () => {
    const { look } = await createLook({});
    await saveLookPiece(look.id, knit);
    await confirmLook(look.id);
    const proposed: LookPiece[] = [
      { id: 'a', slot: 'main-top', description: 'Burgundy crewneck', tags: [], from: 'ai' },
      { id: 'b', slot: 'trousers', description: 'Cream pleated trousers', tags: ['pleated'], from: 'ai' },
    ];
    const read = await applyReading(look.id, { pieces: proposed, account: '@some.creator' }, { at: '2026-01-05T10:00:00.000Z', model: 'a-model' });
    expect(read.pieces.map((p) => [p.slot, p.description, p.from])).toEqual([
      ['main-top', 'Navy zip cardigan', 'you'],
      ['trousers', 'Cream pleated trousers', 'ai'],
    ]);
    expect(read.confirmedAt).toBeUndefined();
    // The account on a screenshot is a suggestion for the credit. It never ties the look to a post.
    expect(read.creator).toBe('@some.creator');
    expect(lookCredit(read)).toMatchObject({ tied: false });

    // An edit makes a proposed piece the owner's own.
    const edited = await saveLookPiece(look.id, { ...read.pieces[1]!, description: 'Cream wool trousers' });
    expect(edited.pieces[1]).toMatchObject({ from: 'you', description: 'Cream wool trousers' });
  });

  it('forgets an accepted stand-in when the piece changes into something else', async () => {
    const { look } = await createLook({});
    const saved = await saveLookPiece(look.id, knit);
    const id = saved.pieces[0]!.id;
    await setStandIn(look.id, id, 'pc-knit');
    await setPieceChoice(look.id, id, 'keep');
    const same = await saveLookPiece(look.id, { ...knit, id, description: 'Navy zip knit' });
    expect(same.pieces[0]).toMatchObject({ standInId: 'pc-knit', choice: 'keep' });
    const other = await saveLookPiece(look.id, { ...knit, id, colorFamily: 'burgundy' });
    expect(other.pieces[0]!.standInId).toBeUndefined();
  });
});

describe('screenshots', () => {
  it('keeps up to four, lists the first as the cover, and goes with the look when it is deleted', async () => {
    const { look } = await createLook({ link: REEL });
    expect(await addLookPhotos(look.id, [fakeImage([1, 1]), fakeImage([2, 2]), fakeImage([3, 3])])).toBe(3);
    expect(await addLookPhotos(look.id, [fakeImage([4, 4]), fakeImage([5, 5])])).toBe(1);
    const photos = await listLookPhotos(look.id);
    expect(photos).toHaveLength(MAX_SCREENSHOTS);
    expect(photos.every((p) => p.kind === 'inspiration')).toBe(true);
    const cover = (await lookCovers()).get(look.id)!;
    expect(cover.count).toBe(4);
    expect(new Uint8Array(cover.cover.data)).toEqual(new Uint8Array([1, 1]));

    await deleteLook(look.id);
    expect(await db.photos.count()).toBe(0);
    expect(await getLook(look.id)).toBeUndefined();
  });

  it('takes a shared screenshot out of the inbox, into a look or a new one', async () => {
    const image = { ...fakeImage([7, 7, 7]), cutout: false };
    const first = await addInboxItem({ kind: 'screenshot', door: 'shortcut', image });
    const second = await addInboxItem({ kind: 'screenshot', door: 'shortcut', image });

    const started = await attachInboxScreenshot(first.id);
    expect(started.link).toBeUndefined();
    expect(lookCredit(started)).toBeUndefined();
    await attachInboxScreenshot(second.id, started.id);
    expect(await listLookPhotos(started.id)).toHaveLength(2);
    expect(await listInbox()).toHaveLength(0);
    await expect(attachInboxScreenshot(first.id)).rejects.toThrow('no longer in your inbox');
  });

  it('leaves the screenshot in the inbox when the look is full', async () => {
    const { look } = await createLook({});
    await addLookPhotos(look.id, [fakeImage(), fakeImage(), fakeImage(), fakeImage()]);
    const item = await addInboxItem({ kind: 'screenshot', door: 'shortcut', image: { ...fakeImage(), cutout: false } });
    await expect(attachInboxScreenshot(item.id, look.id)).rejects.toThrow('already has 4 screenshots');
    expect(await listInbox()).toHaveLength(1);
  });
});

describe('reading the screenshots', () => {
  async function lookWithShots(count = 1) {
    const { look } = await createLook({});
    await addLookPhotos(look.id, Array.from({ length: count }, (_, i) => fakeImage([i + 1, 9, 9])));
    return look;
  }

  it('is off, in plain words, until the phone is connected to the server', async () => {
    const look = await lookWithShots();
    expect(await readingState()).toBe('no-server');
    await expect(readLook(look.id)).rejects.toThrow(/not connected to your server.*by hand/);
    expect(server.requests).toHaveLength(0);
  });

  it('is off, in plain words, while the server has no AI key', async () => {
    await connectServer(server.key);
    const look = await lookWithShots();
    expect(await readingState()).toBe('no-key');
    await expect(readLook(look.id)).rejects.toThrow('switched off, because your server has no AI key yet');
    expect((await getLook(look.id))!.pieces).toEqual([]);
    // Nothing went to the AI provider.
    expect(server.outside.filter((call) => call.url.includes('anthropic'))).toHaveLength(0);
  });

  it('asks for a screenshot first', async () => {
    await connectServer(server.key);
    const { look } = await createLook({});
    await expect(readLook(look.id)).rejects.toThrow('Add a screenshot');
  });

  it('sends two screenshots at most, and turns the answer into pieces to check', async () => {
    await connectServer(server.key);
    const requests: Record<string, unknown>[] = [];
    server.ai = (request) => {
      requests.push(request);
      return answer;
    };
    const look = await lookWithShots(3);
    await saveLookPiece(look.id, knit);
    await confirmLook(look.id);
    expect(await readingState()).toBe('ready');

    const result = await readLook(look.id);

    const content = (requests[0]!.messages as { content: { type: string }[] }[])[0]!.content;
    expect(content.filter((block) => block.type === 'image')).toHaveLength(2);
    // The owner's own top stays. The slot the app does not have is dropped, and so is a neckline on trousers.
    expect(result.proposed).toBe(2);
    expect(result.look.pieces.map((p) => [p.slot, p.description, p.from])).toEqual([
      ['main-top', 'Navy zip cardigan', 'you'],
      ['trousers', 'Cream pleated trousers', 'ai'],
    ]);
    expect(result.look.pieces[1]).toMatchObject({ colorFamily: 'cream', confidence: 'medium', tags: ['pleated'] });
    expect(result.look.pieces[1]!.neckline).toBeUndefined();
    expect(result.look.confirmedAt).toBeUndefined();
    expect(result.look.reading).toMatchObject({ model: 'claude-opus-5-5', notes: 'The shoes are out of frame.' });
    expect(result.look.creator).toBe('@some.creator');
    expect(result.look.link).toBeUndefined();
  });

  it('says so when no outfit could be read, and changes nothing', async () => {
    await connectServer(server.key);
    server.ai = () => ({ pieces: [], account: null, notes: 'This is a picture of a menu.' });
    const look = await lookWithShots();
    await expect(readLook(look.id)).rejects.toThrow('No outfit could be read from the screenshots. This is a picture of a menu.');
    expect((await getLook(look.id))!.reading).toBeUndefined();
  });

  it('explains the daily limit', async () => {
    await connectServer(server.key);
    server.ai = () => answer;
    server.inner.env.AI_DAILY_LIMIT = '1';
    const look = await lookWithShots();
    await readLook(look.id);
    await expect(readLook(look.id)).rejects.toThrow(/limit for AI requests is used up/);
    delete server.inner.env.AI_DAILY_LIMIT;
  });
});

describe('sending missing pieces to the buy list', () => {
  /** A small buy list of the shape the Buy next screen plugs in. */
  function fakeBuyList() {
    const lines: { id: string; state: string; name: string; lookIds: string[]; wish: LookWish }[] = [];
    const list: BuyList = {
      async addWishes(items) {
        return items.map((wish) => {
          const open = lines.find((l) => l.state === 'open' && l.wish.slot === wish.slot && l.wish.colorFamily === wish.colorFamily);
          if (open) {
            open.lookIds = [...new Set([...open.lookIds, wish.lookId])];
            return open;
          }
          const line = { id: `w-${lines.length + 1}`, state: 'open', name: wish.name, lookIds: [wish.lookId], wish };
          lines.push(line);
          return line;
        });
      },
      async removeLookFromWishes(lookId, keep = []) {
        for (const line of lines) {
          if (keep.includes(line.id)) continue;
          line.lookIds = line.lookIds.filter((id) => id !== lookId);
          if (line.lookIds.length === 0) line.state = 'gone';
        }
      },
      async listWishes() {
        return lines.filter((l) => l.state !== 'gone');
      },
    };
    return { list, lines };
  }

  async function confirmedLook() {
    await importBackup(sampleSetupFile());
    const { look } = await createLook({ link: REEL });
    await saveLookPiece(look.id, knit); // owned in the sample wardrobe
    await saveLookPiece(look.id, trousers); // not owned
    await saveLookPiece(look.id, shoes); // not owned
    await saveLookPiece(look.id, { slot: 'belt', description: 'Brown leather belt', colorFamily: 'brown', tags: [] });
    return confirmLook(look.id);
  }

  it('sends nothing while the app has no buy list', async () => {
    const look = await confirmedLook();
    expect(buyListReady()).toBe(false);
    expect(await sendMissingToBuyList(look.id)).toBe(0);
    expect(await openWishIds()).toEqual(new Set());
    await syncLookWishes(look.id);
    await dropLookFromBuyList(look.id);
  });

  it('sends each missing main piece once, marked with the look, and remembers the line', async () => {
    const { list, lines } = fakeBuyList();
    connectBuyList(list);
    const look = await confirmedLook();

    expect(await sendMissingToBuyList(look.id)).toBe(2);
    expect(lines.map((l) => [l.wish.slot, l.wish.name, l.wish.lookId])).toEqual([
      ['trousers', 'cream pleated trousers', look.id],
      ['shoes', 'Brown suede loafers', look.id],
    ]);
    expect(lines[0]!.wish.tags).toEqual(['pleated']);
    const saved = (await getLook(look.id))!;
    expect(saved.pieces.filter((p) => p.wishId).map((p) => p.slot)).toEqual(['trousers', 'shoes']);

    // A finishing touch goes only when asked for.
    const belt = saved.pieces.find((p) => p.slot === 'belt')!;
    expect(await sendPieceToBuyList(look.id, belt.id)).toBe(1);
    expect(await openWishIds()).toEqual(new Set(['w-1', 'w-2', 'w-3']));
  });

  it('lets go of a line when the piece is no longer missing, and of all of them with the look', async () => {
    const { list, lines } = fakeBuyList();
    connectBuyList(list);
    const look = await confirmedLook();
    await sendMissingToBuyList(look.id);
    const wanted = (await getLook(look.id))!.pieces.find((p) => p.slot === 'trousers')!;

    // The owner leaves the trousers out of his version.
    await setPieceChoice(look.id, wanted.id, 'drop');
    await syncLookWishes(look.id);
    expect(lines.map((l) => l.state)).toEqual(['gone', 'open']);
    expect((await getLook(look.id))!.pieces.find((p) => p.slot === 'trousers')!.wishId).toBeUndefined();

    await dropLookFromBuyList(look.id);
    expect(await openWishIds()).toEqual(new Set());
  });
});

describe('backup', () => {
  it('carries saved looks and their screenshots, and a setup file leaves them alone', async () => {
    await importBackup(sampleSetupFile());
    const { look } = await createLook({ link: REEL });
    await saveLookPiece(look.id, knit);
    await confirmLook(look.id);
    await addLookPhotos(look.id, [fakeImage([5, 6, 7])]);

    const file = parseBackup(JSON.stringify(await exportBackup()));
    await importBackup(sampleSetupFile());
    expect(await listLooks()).toHaveLength(1);

    await deleteLook(look.id);
    await importBackup(file);
    const back = (await listLooks())[0]!;
    expect(back).toMatchObject({ id: look.id, link: 'https://www.instagram.com/some.creator/reel/Cabc123/' });
    expect(back.pieces).toHaveLength(1);
    expect(new Uint8Array((await listLookPhotos(look.id))[0]!.data)).toEqual(new Uint8Array([5, 6, 7]));
  });

  it('refuses a file whose looks it cannot read', () => {
    const bad = { ...sampleSetupFile(), kind: 'backup', looks: [{ id: 'x' }] };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow('saved look the app cannot read');
  });
});

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { importBackup } from '../../data/backup';
import { db } from '../../data/db';
import { cropImage } from '../../data/images';
import { addInboxItem, getInboxItem, listInbox } from '../../data/inboxRepo';
import { listPhotos, listPieces } from '../../data/piecesRepo';
import { connectServer } from '../../data/server';
import { fakeImage, sampleSetupFile } from '../../test/fixtures';
import { STAND_IN_KEY, standInServer } from '../../test/standInServer';

// A Tuesday morning. A store price read today is dated 2026-01-06.
vi.mock('../../domain/clock', () => ({ now: () => new Date('2026-01-06T09:00:00') }));

// The real ones need a canvas, which the test browser does not have. A PNG stands for a cut-out.
vi.mock('../../data/images', async (original) => ({
  ...(await original<typeof import('../../data/images')>()),
  processImage: vi.fn(async () => fakeImage()),
  processIncoming: vi.fn(async (file: Blob) => ({ ...fakeImage(), cutout: file.type === 'image/png' })),
  cropImage: vi.fn(async (_image: unknown, rect: { width: number; height: number }) => ({ ...fakeImage([9, 9, 9, 9]), width: rect.width, height: rect.height })),
  imageForAi: vi.fn(async () => ({ mediaType: 'image/jpeg', data: 'AAAA' })),
}));

afterEach(() => vi.unstubAllGlobals());

async function open(path: string) {
  await importBackup(sampleSetupFile());
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const card = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;
const photoFile = (type = 'image/jpeg') => new File(['x'], 'piece', { type });
const cutout = () => ({ ...fakeImage(), cutout: true });

/** A made-up answer from the model for a knit. */
const KNIT = {
  subject: 'garment',
  name: 'Burgundy cable crewneck',
  brand: null,
  slots: ['main-top'],
  colorFamily: 'burgundy',
  colorName: null,
  depth: 'dark',
  texture: 'rough',
  neckline: 'crew',
  fit: 'regular',
  dressLevel: 2,
  cloth: null,
  hardware: 'none',
  warmth: 'warm',
  wetOk: null,
  price: null,
  tags: ['cable knit'],
  unsure: ['fit', 'cloth'],
  note: 'The cloth cannot be read from a photo.',
};

describe('the start of adding a piece', () => {
  it('opens from the wardrobe and offers a photo, a store page, the share menu and by hand', async () => {
    const user = userEvent.setup();
    await open('/wardrobe');
    await user.click(await screen.findByRole('link', { name: 'Add a piece' }));
    expect(await screen.findByRole('button', { name: 'Paste a cut-out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take or choose a photo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link to the product page')).toBeInTheDocument();
    // Not connected to a server, so the share menu says what it needs.
    expect(within(card('From the share menu')).getByRole('link', { name: 'Connect it in Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fill in everything by hand' })).toHaveAttribute('href', '/wardrobe/new');
  });

  it('takes a pasted cut-out straight to the form, and keeps it waiting until it is saved', async () => {
    const user = userEvent.setup();
    await open('/wardrobe/add');
    await screen.findByRole('button', { name: 'Paste a cut-out' });
    vi.spyOn(navigator.clipboard, 'read').mockResolvedValue([
      { types: ['image/png'], getType: async () => new Blob(['x'], { type: 'image/png' }) },
    ] as unknown as ClipboardItems);
    await user.click(screen.getByRole('button', { name: 'Paste a cut-out' }));

    expect(await screen.findByRole('heading', { name: 'The photo' })).toBeInTheDocument();
    expect(within(card('The photo')).getByText('Cut-out')).toBeInTheDocument();
    expect(screen.queryByText(/still has its background/)).not.toBeInTheDocument();
    const waiting = await listInbox();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: 'photo', door: 'paste', image: { cutout: true } });
  });

  it('says so when there is no picture to paste', async () => {
    const user = userEvent.setup();
    await open('/wardrobe/add');
    await screen.findByRole('button', { name: 'Paste a cut-out' });
    vi.spyOn(navigator.clipboard, 'read').mockResolvedValue([{ types: ['text/plain'], getType: async () => new Blob(['hello']) }] as unknown as ClipboardItems);
    await user.click(screen.getByRole('button', { name: 'Paste a cut-out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no picture on the clipboard');
    expect(await listInbox()).toHaveLength(0);
  });

  it('warns that a photo as taken still has its background, and saves it as the first photo', async () => {
    const user = userEvent.setup();
    await open('/wardrobe/add');
    await user.upload(await screen.findByLabelText('Take or choose a photo of the piece'), photoFile());

    expect(await screen.findByText('Photo as taken')).toBeInTheDocument();
    expect(screen.getByText(/still has its background/)).toBeInTheDocument();
    // No server, so AI tagging is off and says what to do instead.
    expect(await screen.findByText(/AI tagging needs your server/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest tags with AI' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Name'), 'Grey marl tee');
    await user.click(screen.getByRole('button', { name: 'Under-layer' }));
    await user.click(screen.getByRole('button', { name: 'Add to wardrobe' }));

    expect(await screen.findByRole('heading', { name: 'Grey marl tee' })).toBeInTheDocument();
    const saved = (await listPieces()).find((p) => p.name === 'Grey marl tee')!;
    expect(saved).toMatchObject({ status: 'owned', detailsConfirmed: true });
    expect(saved.tagging).toBeUndefined();
    const photos = await listPhotos(saved.id);
    expect(photos).toHaveLength(1);
    expect(photos[0]).not.toHaveProperty('cutout');
    // It is a piece now, so it has left the waiting list.
    expect(await listInbox()).toHaveLength(0);
  });

  it('crops the photo to the part in the box', async () => {
    const user = userEvent.setup();
    const item = await addInboxItem({ kind: 'photo', door: 'picker', image: { ...fakeImage(), cutout: false } });
    await open(`/wardrobe/new?inbox=${item.id}`);
    await user.click(await screen.findByRole('button', { name: 'Crop' }));
    expect(screen.getByTestId('crop-box')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep this part' }));
    // The box starts a tenth in from each edge of the 800 by 1000 photo.
    await waitFor(() => expect(cropImage).toHaveBeenCalledWith(expect.anything(), { x: 80, y: 100, width: 640, height: 800 }));
    await waitFor(async () => expect((await getInboxItem(item.id))?.image).toMatchObject({ width: 640, height: 800, cutout: false }));
    expect(await screen.findByRole('button', { name: 'Crop' })).toBeInTheDocument();
  });

  it('hands a pasted Instagram link to the looks screens, because it is a look and not a piece', async () => {
    const user = userEvent.setup();
    await open('/wardrobe/add');
    await user.type(await screen.findByLabelText('Link to the product page'), 'https://www.instagram.com/p/abc123/');
    await user.click(screen.getByRole('button', { name: 'Use this link' }));
    await waitFor(async () => expect(await db.looks.count()).toBe(1));
    expect(await listInbox()).toHaveLength(0);
    expect(await listPieces()).toHaveLength(5);
  });

  it('offers a shared screenshot and an Instagram link as looks, not as pieces', async () => {
    const shot = await addInboxItem({ kind: 'screenshot', door: 'shortcut', image: { ...fakeImage(), cutout: false } });
    const link = await addInboxItem({ kind: 'link', door: 'shortcut', url: 'https://www.instagram.com/reel/xyz/' });
    await open('/wardrobe/add');
    const list = within(await screen.findByRole('heading', { name: 'Waiting to be added' }).then((h) => h.closest('section')!));
    expect(list.getByRole('link', { name: 'Save as a look: Screenshot of a look' })).toHaveAttribute('href', `/inspiration/attach?inbox=${shot.id}`);
    expect(list.getByRole('link', { name: 'Save as a look: instagram.com' })).toHaveAttribute('href', `/inspiration/new?inbox=${link.id}`);
    expect(list.queryByRole('link', { name: /Add as a piece/ })).not.toBeInTheDocument();
  });

  it('refuses something that is not a link', async () => {
    const user = userEvent.setup();
    await open('/wardrobe/add');
    await user.type(await screen.findByLabelText('Link to the product page'), 'navy chinos');
    await user.click(screen.getByRole('button', { name: 'Use this link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not look like a web link');
  });

  it('lists what is waiting, counts it on the wardrobe, and removes an item only after a second tap', async () => {
    const user = userEvent.setup();
    await addInboxItem({ kind: 'photo', door: 'shortcut', image: cutout() });
    await addInboxItem({ kind: 'page', door: 'shortcut', url: 'https://shop.example/p/1', title: 'Cable crewneck | Shop', text: '{"url":"https://shop.example/p/1"}' });
    await open('/wardrobe');
    await user.click(await screen.findByRole('link', { name: /2 things are waiting to be added/ }));

    await screen.findByRole('heading', { name: 'Waiting to be added' });
    const list = within(card('Waiting to be added'));
    expect(list.getByText('Clothing photo')).toBeInTheDocument();
    expect(list.getByText(/Cut-out · From the share menu/)).toBeInTheDocument();
    expect(list.getByText('Cable crewneck | Shop')).toBeInTheDocument();
    expect(list.getByText(/Store page with its text · shop.example/)).toBeInTheDocument();

    await user.click(list.getByRole('button', { name: 'Remove: Clothing photo' }));
    expect(await listInbox()).toHaveLength(2);
    await user.click(list.getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(async () => expect(await listInbox()).toHaveLength(1));
    expect(list.queryByText('Clothing photo')).not.toBeInTheDocument();
  });

  it('collects what the share menu sent when asked', async () => {
    const server = standInServer();
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    await open('/wardrobe/add');
    await screen.findByRole('button', { name: 'Check for shared items' });
    await user.click(screen.getByRole('button', { name: 'Check for shared items' }));
    expect(await screen.findByText('Nothing new on your server.')).toBeInTheDocument();

    server.shared.push({ id: 'abc123', kind: 'link', receivedAt: '2026-01-06T08:00:00.000Z', url: 'https://shop.example/p/2', title: 'Pleated trousers' });
    await user.click(screen.getByRole('button', { name: 'Check for shared items' }));
    expect(await screen.findByText('1 new item came in.')).toBeInTheDocument();
    expect(within(card('Waiting to be added')).getByText('Pleated trousers')).toBeInTheDocument();
    expect(server.shared).toHaveLength(0);
  });

  it('says so when an item is no longer waiting', async () => {
    await open('/wardrobe/new?inbox=gone');
    expect(await screen.findByText(/no longer waiting/)).toBeInTheDocument();
  });
});

describe('AI tagging', () => {
  it('stays off, in plain words, while the server has no AI key', async () => {
    standInServer();
    await connectServer(STAND_IN_KEY);
    const item = await addInboxItem({ kind: 'photo', door: 'paste', image: cutout() });
    await open(`/wardrobe/new?inbox=${item.id}`);
    expect(await screen.findByText(/AI tagging is off, because your server has no AI key yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest tags with AI' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('fills the form from a photo, marks what it filled, and keeps a record on the piece', async () => {
    const server = standInServer();
    server.aiReady = true;
    server.ai = () => KNIT;
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    const item = await addInboxItem({ kind: 'photo', door: 'paste', image: cutout() });
    await open(`/wardrobe/new?inbox=${item.id}`);

    // Says what will leave the phone before anything does.
    expect(await screen.findByText(/This cut-out goes to your server and on to the AI provider. Nothing else is sent./)).toBeInTheDocument();
    expect(server.aiRequests).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Suggest tags with AI' }));

    expect(await screen.findByText(/Tags suggested by claude-opus-5-5/)).toBeInTheDocument();
    expect(screen.getByText(/The cloth cannot be read from a photo/)).toBeInTheDocument();
    expect(server.aiRequests).toEqual([{ kind: 'piece-photo', body: { images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] } }]);

    expect(screen.getByLabelText('Name')).toHaveValue('Burgundy cable crewneck');
    expect(screen.getByRole('button', { name: 'Main top' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Burgundy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Crewneck' })).toHaveAttribute('aria-pressed', 'true');
    // The model said it was not sure of the fit. Cloth came back empty, so it carries no mark.
    expect(within(screen.getByRole('group', { name: /^Fit/ })).getByText('AI, not sure')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: /^Texture/ })).getByText('AI')).toBeInTheDocument();
    expect(screen.getByLabelText('Cloth')).toHaveValue('');
    expect(screen.getByLabelText('Cloth').closest('.field')).not.toHaveTextContent('AI');
    // A model's reading is not a checked detail.
    expect(screen.getByLabelText('I have checked these details against the garment')).not.toBeChecked();

    // Changing a field makes it yours, and its mark goes.
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(within(screen.getByRole('group', { name: /^Fit/ })).queryByText('AI, not sure')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to wardrobe' }));
    expect(await screen.findByRole('heading', { name: 'Burgundy cable crewneck' })).toBeInTheDocument();
    const saved = (await listPieces()).find((p) => p.name === 'Burgundy cable crewneck')!;
    expect(saved).toMatchObject({
      status: 'owned',
      slots: ['main-top'],
      colorFamily: 'burgundy',
      texture: 'rough',
      neckline: 'crew',
      fit: 'close',
      warmth: 'warm',
      tags: ['cable knit'],
      detailsConfirmed: false,
      tagging: { source: 'photo', model: 'claude-opus-5-5', proposal: { fit: 'regular', unsure: ['fit'] } },
    });
    expect(saved.cloth).toBeUndefined();
    expect(await listPhotos(saved.id)).toHaveLength(1);
    expect(await listInbox()).toHaveLength(0);
    expect(screen.getByText(/Tags were first suggested by AI \(claude-opus-5-5\) from a photo/)).toBeInTheDocument();
  });

  it('never replaces what you typed yourself', async () => {
    const server = standInServer();
    server.aiReady = true;
    server.ai = () => KNIT;
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    const item = await addInboxItem({ kind: 'photo', door: 'paste', image: cutout() });
    await open(`/wardrobe/new?inbox=${item.id}`);
    await user.type(await screen.findByLabelText('Name'), 'My oxblood knit');
    await user.click(screen.getByRole('button', { name: 'Navy' }));
    await user.click(await screen.findByRole('button', { name: 'Suggest tags with AI' }));
    await screen.findByText(/Tags suggested/);
    expect(screen.getByLabelText('Name')).toHaveValue('My oxblood knit');
    expect(screen.getByRole('button', { name: 'Navy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Burgundy' })).toHaveAttribute('aria-pressed', 'false');
    // Empty fields are still filled.
    expect(screen.getByRole('button', { name: 'Rough' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads a store page from pasted details, and saves its price with the date', async () => {
    const server = standInServer();
    server.aiReady = true;
    server.ai = () => ({
      ...KNIT,
      subject: 'product-page',
      name: 'Cable crewneck',
      brand: 'Sample Co',
      colorName: 'Oxblood',
      cloth: '100% cotton',
      price: 89.9,
      unsure: [],
      note: null,
    });
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    await open('/wardrobe/add');
    await user.type(await screen.findByLabelText('Link to the product page'), 'https://shop.example/p/1');
    await user.click(screen.getByRole('button', { name: 'Use this link' }));

    expect(await screen.findByRole('heading', { name: 'The store page' })).toBeInTheDocument();
    expect(screen.getByText(/The app does not open this page/)).toBeInTheDocument();
    // A store page is something not bought yet.
    expect(screen.getByRole('button', { name: 'Thinking about it' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Product page link')).toHaveValue('https://shop.example/p/1');
    // With nothing to read yet, the button waits.
    expect(await screen.findByRole('button', { name: 'Suggest tags with AI' })).toBeDisabled();

    await user.type(screen.getByLabelText('Details copied from the page'), 'Cable crewneck, Oxblood, 100% cotton, $89.90');
    await user.click(screen.getByRole('button', { name: 'Suggest tags with AI' }));
    await screen.findByText(/Tags suggested/);
    expect(server.aiRequests[0]).toMatchObject({
      kind: 'piece-page',
      body: { url: 'https://shop.example/p/1', text: 'Cable crewneck, Oxblood, 100% cotton, $89.90', images: [] },
    });
    expect(screen.getByLabelText('Cloth')).toHaveValue('100% cotton');
    expect(screen.getByLabelText('Price on the page, in dollars')).toHaveValue('89.9');

    await user.click(screen.getByRole('button', { name: 'Add to wardrobe' }));
    expect(await screen.findByRole('heading', { name: 'Cable crewneck' })).toBeInTheDocument();
    const saved = (await listPieces()).find((p) => p.name === 'Cable crewneck')!;
    expect(saved).toMatchObject({
      status: 'considering',
      brand: 'Sample Co',
      colorName: 'Oxblood',
      cloth: '100% cotton',
      link: 'https://shop.example/p/1',
      listPrice: 89.9,
      listPriceOn: '2026-01-06',
      detailsConfirmed: false,
      tagging: { source: 'page' },
    });
    // A page has no photo of the piece to keep.
    expect(await listPhotos(saved.id)).toHaveLength(0);
    expect(screen.getByText(/\$89\.90, seen Jan 6, 2026/)).toBeInTheDocument();
  });

  it('starts the name from the page title of a shared page, and lets the model improve on it', async () => {
    const server = standInServer();
    server.aiReady = true;
    server.ai = () => ({ ...KNIT, subject: 'product-page', name: 'Cable crewneck', unsure: [] });
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    const text = JSON.stringify({ url: 'https://shop.example/p/1', title: 'Cable Crewneck Sweater | Shop', text: '100% cotton' });
    const item = await addInboxItem({ kind: 'page', door: 'shortcut', url: 'https://shop.example/p/1', title: 'Cable Crewneck Sweater | Shop', text });
    await open(`/wardrobe/new?inbox=${item.id}`);

    expect(await screen.findByLabelText('Name')).toHaveValue('Cable Crewneck Sweater');
    expect(screen.getByText('From the page title')).toBeInTheDocument();
    expect(screen.getByText(/Your phone copied the page's text when you shared it/)).toBeInTheDocument();
    // The shared text is already there, so there is nothing to paste.
    expect(screen.queryByLabelText('Details copied from the page')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Suggest tags with AI' }));
    await screen.findByText(/Tags suggested/);
    expect(server.aiRequests[0]?.body).toMatchObject({ text, title: 'Cable Crewneck Sweater | Shop' });
    expect(screen.getByLabelText('Name')).toHaveValue('Cable crewneck');
    expect(screen.queryByText('From the page title')).not.toBeInTheDocument();
  });

  it('suggests nothing for a photo of a person, and says why', async () => {
    const server = standInServer();
    server.aiReady = true;
    server.ai = () => ({ subject: 'worn-by-person', slots: [], tags: [], unsure: [], name: 'Man in a navy coat' });
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    const item = await addInboxItem({ kind: 'photo', door: 'picker', image: { ...fakeImage(), cutout: false } });
    await open(`/wardrobe/new?inbox=${item.id}`);
    await user.click(await screen.findByRole('button', { name: 'Suggest tags with AI' }));
    expect(await screen.findByText(/someone wearing the piece/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('I have checked these details against the garment')).toBeChecked();
  });

  it('brings back a proposal made before the app was closed', async () => {
    const server = standInServer();
    server.aiReady = true;
    server.ai = () => KNIT;
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    const item = await addInboxItem({ kind: 'photo', door: 'paste', image: cutout() });
    await open(`/wardrobe/new?inbox=${item.id}`);
    await user.click(await screen.findByRole('button', { name: 'Suggest tags with AI' }));
    await screen.findByText(/Tags suggested/);

    // The same item, opened afresh: nothing is asked of the model again.
    cleanup();
    render(
      <MemoryRouter initialEntries={[`/wardrobe/new?inbox=${item.id}`]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Name')).toHaveValue('Burgundy cable crewneck');
    expect(await screen.findByRole('button', { name: 'Ask AI again' })).toBeInTheDocument();
    expect(server.aiRequests).toHaveLength(1);
  });

  it('explains a used-up daily limit and leaves the form for filling in by hand', async () => {
    const server = standInServer();
    server.aiReady = true;
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    const item = await addInboxItem({ kind: 'photo', door: 'paste', image: cutout() });
    await open(`/wardrobe/new?inbox=${item.id}`);
    const button = await screen.findByRole('button', { name: 'Suggest tags with AI' });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Limit reached.', code: 'daily-limit' }), { status: 429 }));
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent("Today's limit for AI requests is used up");
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });
});

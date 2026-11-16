import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { getAiStatus, readWithAi } from '../data/ai';
import { importBackup } from '../data/backup';
import { addInboxItem, listInbox } from '../data/inboxRepo';
import { forgetReadingState } from '../data/lookReader';
import { connectBuyList, type BuyList } from '../data/lookWishes';
import { addLookPhotos, confirmLook, createLook, getLook, listLookPhotos, listLooks, saveLookPiece } from '../data/looksRepo';
import { updateProfile } from '../data/profileRepo';
import { setMeta } from '../data/server';
import { fakeImage, sampleRules, sampleSetupFile } from '../test/fixtures';

// The real one needs a canvas, which the test browser does not have.
vi.mock('../data/images', async (original) => ({
  ...(await original<typeof import('../data/images')>()),
  processImage: vi.fn(async () => fakeImage()),
}));

// The server is tested with the real route in src/data/looks.test.ts. Here only its answers are stood in for.
vi.mock('../data/ai', async (original) => ({
  ...(await original<typeof import('../data/ai')>()),
  getAiStatus: vi.fn(),
  readWithAi: vi.fn(),
}));

const REEL = 'https://www.instagram.com/some.creator/reel/Cabc123/?igsh=xyz';
const today = { used: 1, limit: 120 };

beforeEach(async () => {
  forgetReadingState();
  connectBuyList(undefined);
  vi.mocked(getAiStatus).mockReset();
  vi.mocked(readWithAi).mockReset();
  await importBackup(sampleSetupFile());
  await updateProfile({ rules: [...sampleRules, { id: 'r-tie', kind: 'default', text: 'A shirt under a knit is fine. No tie.', evidence: 'your-choice', check: 'no-tie' }] });
});

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const connectPhone = () => setMeta('server.appKey', 'k'.repeat(24));
const screenshot = () => new File([new Uint8Array([1, 2, 3])], 'look.png', { type: 'image/png' });

describe('saving a post', () => {
  it('keeps the link, plays the post in Instagram\'s own player, and works through to your version by hand', async () => {
    const user = userEvent.setup();
    renderApp('/inspiration');
    expect(await screen.findByText(/Nothing saved yet/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Link to the post'), REEL);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The look is tied to the post, because its link is saved.
    expect(await screen.findByRole('heading', { name: 'Look from @some.creator' })).toBeInTheDocument();
    expect(screen.getByText('@some.creator, post saved')).toBeInTheDocument();
    expect(screen.getByText('Add a screenshot')).toBeInTheDocument();
    const player = screen.getByTitle("The post, in Instagram's own player");
    expect(player).toHaveAttribute('src', 'https://www.instagram.com/reel/Cabc123/embed/');
    expect(player).toHaveAttribute('sandbox');
    expect(screen.getByRole('link', { name: 'Open in Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/some.creator/reel/Cabc123/');

    await user.upload(screen.getByLabelText('Choose screenshots'), screenshot());
    expect(await screen.findByAltText('Screenshot 1')).toBeInTheDocument();
    expect(screen.getByText('List the pieces')).toBeInTheDocument();

    // This phone has no server, so reading is off and says so. The look can still be filled in by hand.
    expect(await screen.findByText(/not connected to your server, so the app cannot read screenshots/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read the screenshots/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add a piece by hand' }));
    const form = within(screen.getByRole('group', { name: 'Add a piece' }));
    await user.click(form.getByRole('button', { name: 'Add piece' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick where the piece goes');
    await user.click(form.getByRole('button', { name: 'Main top' }));
    await user.type(form.getByLabelText('What it is'), 'Navy zip knit');
    await user.click(form.getByRole('button', { name: 'Navy' }));
    await user.click(form.getByRole('button', { name: 'Add piece' }));

    await user.click(await screen.findByRole('button', { name: 'Add a piece by hand' }));
    const second = within(screen.getByRole('group', { name: 'Add a piece' }));
    await user.click(second.getByRole('button', { name: 'Trousers' }));
    await user.type(second.getByLabelText('What it is'), 'Cream pleated trousers');
    await user.click(second.getByRole('button', { name: 'Cream' }));
    await user.type(second.getByLabelText('Tags'), 'pleated');
    await user.click(second.getByRole('button', { name: 'Add piece' }));

    await user.click(await screen.findByRole('button', { name: 'These are right' }));

    // Confirmed: the pieces fold away and the look is matched to the wardrobe.
    expect(await screen.findByRole('heading', { name: 'Your version' })).toBeInTheDocument();
    expect(screen.getByText('2 pieces, checked by you. Your version of the look is below.')).toBeInTheDocument();
    expect(screen.getAllByText('One piece away: cream pleated trousers').length).toBeGreaterThan(0);
    expect(screen.getByText('You own it')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Navy zip cardigan' })).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    // There is no buy list in the app yet, so nothing offers to send to it.
    expect(screen.queryByRole('button', { name: /buy list/ })).not.toBeInTheDocument();

    // Back on the list, the look shows how far the wardrobe is from it.
    await user.click(screen.getByRole('link', { name: '‹ Looks' }));
    expect(await screen.findByText('1 saved look. You can make 0 of them now.')).toBeInTheDocument();
    expect(screen.getByText('One piece away')).toBeInTheDocument();
  });

  it('opens the look already saved for a post instead of saving it twice', async () => {
    const user = userEvent.setup();
    const { look } = await createLook({ link: REEL, name: 'Sunday knit' });
    renderApp('/inspiration');
    await user.type(await screen.findByLabelText('Link to the post'), 'https://instagram.com/reel/Cabc123');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Sunday knit' })).toBeInTheDocument();
    expect((await listLooks()).map((l) => l.id)).toEqual([look.id]);
  });

  it('saves a look without a link as "in the style of", tied to no post', async () => {
    const user = userEvent.setup();
    renderApp('/inspiration/new');
    await user.type(await screen.findByLabelText('Creator'), '@some.creator');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('in the style of @some.creator')).toBeInTheDocument();
    expect(screen.getByText(/No link is saved, so this look is not tied to a creator's post/)).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('reading the screenshots', () => {
  async function lookWithScreenshot() {
    const { look } = await createLook({ link: REEL });
    await addLookPhotos(look.id, [fakeImage()]);
    return look;
  }

  it('says plainly that reading is switched off while the server has no AI key', async () => {
    await connectPhone();
    vi.mocked(getAiStatus).mockResolvedValue({ ready: false, kinds: [], today });
    const look = await lookWithScreenshot();
    renderApp(`/inspiration/${look.id}`);
    expect(await screen.findByText(/Reading screenshots is switched off, because your server has no AI key yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read the screenshots/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a piece by hand' })).toBeInTheDocument();
    // The post does not load by itself once the look has a screenshot.
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play the post here' })).toBeInTheDocument();
  });

  it('proposes the pieces, waits for the check, then applies your rules to the look', async () => {
    const user = userEvent.setup();
    await connectPhone();
    vi.mocked(getAiStatus).mockResolvedValue({ ready: true, kinds: [{ name: 'look', model: 'a-model', dailyLimit: 40 }], today });
    const proposed = (slot: string, description: string, colorFamily: string, more: Record<string, unknown> = {}) => ({
      slot,
      description,
      colorFamily,
      depth: null,
      texture: null,
      neckline: null,
      fit: null,
      hem: null,
      material: null,
      hardware: null,
      dressLevel: 2,
      tags: [],
      confidence: 'high',
      ...more,
    });
    vi.mocked(readWithAi).mockResolvedValue({
      model: 'a-model',
      today,
      result: {
        pieces: [
          proposed('main-top', 'navy zip cardigan', 'navy', { neckline: 'full-zip' }),
          proposed('trousers', 'tan chinos', 'tan'),
          proposed('shoes', 'black loafers', 'black'),
          proposed('accessory', 'burgundy silk tie', 'burgundy', { confidence: 'low' }),
          proposed('watch', 'gold watch', 'other', { hardware: 'gold-or-brass' }),
        ],
        account: 'some.creator',
        notes: null,
      },
    });
    const look = await lookWithScreenshot();
    renderApp(`/inspiration/${look.id}`);

    await user.click(await screen.findByRole('button', { name: 'Read the screenshots' }));
    expect(await screen.findByText(/These were read from your screenshots and may be wrong/)).toBeInTheDocument();
    expect(vi.mocked(readWithAi)).toHaveBeenCalledWith('look', { images: [{ mediaType: 'image/jpeg', data: 'AQIDBA==' }] });
    expect(screen.getByText('Burgundy silk tie')).toBeInTheDocument();
    // Nothing is matched or changed until the owner has checked the pieces.
    expect(screen.queryByRole('heading', { name: 'Your version' })).not.toBeInTheDocument();

    // A wrong reading is fixed in place.
    await user.click(screen.getByRole('button', { name: 'Edit Black loafers' }));
    const form = within(screen.getByRole('group', { name: 'Edit Black loafers' }));
    await user.clear(form.getByLabelText('What it is'));
    await user.type(form.getByLabelText('What it is'), 'Black penny loafers');
    await user.click(form.getByRole('button', { name: 'Save piece' }));
    expect(await screen.findByText('Black penny loafers')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'These are right' }));
    expect(await screen.findByRole('heading', { name: 'Your version' })).toBeInTheDocument();
    expect(screen.getAllByText('You can make this now').length).toBeGreaterThan(0);

    // The tie is left out by the owner's rule, and the gold watch becomes silver.
    expect(screen.getByText('Your rules leave this out.')).toBeInTheDocument();
    expect(screen.getByText(/A shirt under the knit is fine without one/)).toBeInTheDocument();
    expect(screen.getByText('Changed')).toBeInTheDocument();
    expect(screen.getAllByText('You own it')).toHaveLength(4);

    // The owner has the last word.
    await user.click(screen.getByRole('button', { name: 'Keep Burgundy silk tie as it is' }));
    expect(await screen.findByText('Kept by you')).toBeInTheDocument();
    expect((await getLook(look.id))!.pieces.find((p) => p.slot === 'accessory')!.choice).toBe('keep');
  });

  it('shows why a reading failed and leaves the look as it was', async () => {
    const user = userEvent.setup();
    await connectPhone();
    vi.mocked(getAiStatus).mockResolvedValue({ ready: true, kinds: [{ name: 'look', model: 'a-model', dailyLimit: 40 }], today });
    vi.mocked(readWithAi).mockResolvedValue({ model: 'a-model', today, result: { pieces: [], account: null, notes: 'This is a picture of a menu.' } });
    const look = await lookWithScreenshot();
    renderApp(`/inspiration/${look.id}`);
    await user.click(await screen.findByRole('button', { name: 'Read the screenshots' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No outfit could be read from the screenshots. This is a picture of a menu.');
    expect((await getLook(look.id))!.pieces).toEqual([]);
  });
});

describe('what the share menu sent', () => {
  it('turns a shared link into a look waiting for its screenshot', async () => {
    const item = await addInboxItem({ kind: 'link', door: 'shortcut', url: REEL });
    renderApp(`/inspiration/new?inbox=${item.id}`);
    expect(await screen.findByRole('heading', { name: 'Look from @some.creator' })).toBeInTheDocument();
    expect(screen.getByText('Add a screenshot')).toBeInTheDocument();
    expect(await listInbox()).toEqual([]);
    expect(await listLooks()).toHaveLength(1);
  });

  it('adds a shared screenshot to a look the owner picks', async () => {
    const user = userEvent.setup();
    const { look } = await createLook({ link: REEL, name: 'Sunday knit' });
    const item = await addInboxItem({ kind: 'screenshot', door: 'shortcut', image: { ...fakeImage(), cutout: false } });
    renderApp(`/inspiration/attach?inbox=${item.id}`);
    expect(await screen.findByAltText('The shared screenshot')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add to Sunday knit' }));
    expect(await screen.findByRole('heading', { name: 'Sunday knit' })).toBeInTheDocument();
    expect(await screen.findByAltText('Screenshot 1')).toBeInTheDocument();
    expect(await listLookPhotos(look.id)).toHaveLength(1);
    expect(await listInbox()).toEqual([]);
  });

  it('starts a new look from a shared screenshot, tied to no post', async () => {
    const user = userEvent.setup();
    const item = await addInboxItem({ kind: 'screenshot', door: 'shortcut', image: { ...fakeImage(), cutout: false } });
    renderApp(`/inspiration/attach?inbox=${item.id}`);
    await user.click(await screen.findByRole('button', { name: 'Start a new look' }));
    expect(await screen.findByRole('heading', { name: 'Saved look' })).toBeInTheDocument();
    expect(screen.getByText(/No link is saved/)).toBeInTheDocument();
    await waitFor(async () => expect(await listInbox()).toEqual([]));
  });

  it('says so when the shared item is gone', async () => {
    renderApp('/inspiration/attach?inbox=nothing');
    expect(await screen.findByText('That screenshot is no longer in your inbox.')).toBeInTheDocument();
  });
});

describe('the buy list', () => {
  it('sends the missing pieces once the app has a buy list', async () => {
    const user = userEvent.setup();
    const sent: string[] = [];
    const list: BuyList = {
      addWishes: async (items) => items.map((item) => ({ id: `w-${sent.push(item.name)}`, state: 'open' })),
      removeLookFromWishes: async () => undefined,
      listWishes: async () => sent.map((_, i) => ({ id: `w-${i + 1}`, state: 'open' })),
    };
    connectBuyList(list);
    const { look } = await createLook({ link: REEL });
    await saveLookPiece(look.id, { slot: 'main-top', description: 'Navy zip cardigan', colorFamily: 'navy', tags: [] });
    await saveLookPiece(look.id, { slot: 'trousers', description: 'Cream pleated trousers', colorFamily: 'cream', tags: ['pleated'] });
    await saveLookPiece(look.id, { slot: 'shoes', description: 'Brown suede loafers', colorFamily: 'brown', tags: [] });
    await confirmLook(look.id);
    renderApp(`/inspiration/${look.id}`);

    await user.click(await screen.findByRole('button', { name: 'Send 2 missing pieces to the buy list' }));
    expect(await screen.findByRole('status')).toHaveTextContent('2 pieces sent to your buy list, marked as completing this look.');
    expect(sent).toEqual(['Cream pleated trousers', 'Brown suede loafers']);
    expect(await screen.findAllByText('On your buy list')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /missing pieces to the buy list/ })).not.toBeInTheDocument();
  });
});

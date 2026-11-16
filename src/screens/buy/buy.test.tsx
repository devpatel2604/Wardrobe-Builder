import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { db } from '../../data/db';
import { listPieces } from '../../data/piecesRepo';
import { connectServer } from '../../data/server';
import { getWish, listWishes } from '../../data/wishlistRepo';
import type { LeadsResult } from '../../domain/buyNext/leads';
import type { WishItem } from '../../domain/buyNext/types';
import { sampleWishlist } from '../../test/buyFixtures';
import { sampleProfile } from '../../test/fixtures';
import { samplePalette, savedLook, smallWardrobe, stretchLook } from '../../test/outfitFixtures';
import { STAND_IN_KEY, standInServer } from '../../test/standInServer';

// Tuesday, January 6, 2026.
vi.mock('../../domain/clock', () => ({ now: () => new Date('2026-01-06T07:30:00') }));
afterEach(() => vi.unstubAllGlobals());

async function open(path: string, wishes: WishItem[] = sampleWishlist()) {
  await db.profile.put({ ...sampleProfile(), palette: samplePalette, formulas: [savedLook, stretchLook] });
  await db.pieces.bulkPut(smallWardrobe());
  await db.wishlist.bulkPut(wishes);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const card = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;

describe('the buy-next list', () => {
  it('shows the pieces in buying order, each with its reason, its products and their dates', async () => {
    await open('/buy');
    const list = await screen.findByRole('list', { name: 'Buy in this order' });
    const rows = within(list).getAllByRole('link');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['1. Black belt', '2. Grey wool coat', '3. White trainers', '4. Brown boots']);

    const belt = within(rows[0]!);
    expect(belt.getByText('Fills a gap')).toBeInTheDocument();
    expect(belt.getByText('Try on first')).toBeInTheDocument();
    expect(belt.getByText(/You own no belt\. It goes with all 4 outfits you can make now\./)).toBeInTheDocument();
    expect(belt.getByText('Running total so far: $45')).toBeInTheDocument();

    const coat = within(rows[1]!);
    expect(coat.getByText('Beyond your looks')).toBeInTheDocument();
    expect(coat.getByText('No product under it yet.')).toBeInTheDocument();
    expect(coat.getByText('Open it to search your stores.')).toBeInTheDocument();
    expect(coat.getByText('Running total so far: $45 (1 above has no price yet)')).toBeInTheDocument();

    const trainers = within(rows[2]!);
    expect(trainers.getByText('+14 outfits')).toBeInTheDocument();
    expect(trainers.getByText('Court Classic sneaker, Sample Store, $120', { exact: false })).toBeInTheDocument();
    expect(trainers.getByText('Price seen Jan 2 by the research, not by you, size not checked.')).toBeInTheDocument();
    expect(trainers.getByText('Everyday court sneaker, Another Shop, $60', { exact: false })).toBeInTheDocument();
    expect(trainers.getByText('Not checked at the store yet.')).toBeInTheDocument();
    expect(trainers.getByText('Running total so far: $165 (1 above has no price yet)')).toBeInTheDocument();
  });

  it('keeps waiting pieces and rule breakers out of the ranking, and says why', async () => {
    await open('/buy');
    await screen.findByRole('list', { name: 'Buy in this order' });
    expect(within(card('Waiting')).getByText('Shirts wait for spring.')).toBeInTheDocument();
    expect(within(card('Breaks one of your rules')).getByRole('link', { name: 'Black leather jacket' })).toBeInTheDocument();
    expect(within(card('Breaks one of your rules')).getByText(/No leather clothing/)).toBeInTheDocument();
  });

  it('says so when the list is empty, and when nothing on it is worth buying', async () => {
    const view = await open('/buy', []);
    expect(await screen.findByText(/The list holds pieces you need/)).toBeInTheDocument();
    view.unmount();

    await db.pieces.put({ ...smallWardrobe()[0]!, id: 'belt-owned', name: 'Brown belt', slots: ['belt'], colorFamily: 'brown' });
    await db.wishlist.put(sampleWishlist()[1]!);
    render(
      <MemoryRouter initialEntries={['/buy']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Nothing worth buying right now.')).toBeInTheDocument();
  });

  it('sits in the tab bar, with Profile and Settings one tap away under More', async () => {
    const user = userEvent.setup();
    await open('/today');
    const tabs = within(await screen.findByRole('navigation', { name: 'Main' }));
    expect(tabs.getAllByRole('link').map((a) => a.textContent)).toEqual(['Today', 'Week', 'Buy next', 'Wardrobe', 'Looks', 'More']);
    await user.click(tabs.getByRole('link', { name: 'Buy next' }));
    expect(await screen.findByRole('heading', { name: 'Buy next' })).toBeInTheDocument();
    await user.click(tabs.getByRole('link', { name: 'More' }));
    await user.click(await screen.findByRole('link', { name: /Settings/ }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(tabs.getByRole('link', { name: 'More' })).toHaveClass('active');
  });
});

describe('one piece on the list', () => {
  it('shows why it is there, what to look for, the outfits it unlocks and its products', async () => {
    await open('/buy/w-trainers');
    expect(await screen.findByRole('heading', { name: 'White trainers' })).toBeInTheDocument();
    expect(screen.getByText('Number 3 of 4 on your list.')).toBeInTheDocument();
    expect(within(card('Why it is on the list')).getByText('Nothing in the wardrobe is casual.')).toBeInTheDocument();
    expect(within(card('Why it is on the list')).getByText(/Your first outfits for a casual day\./)).toBeInTheDocument();
    expect(within(card('What to look for')).getByText('Plain white, low, no big logo.')).toBeInTheDocument();

    const unlocks = within(card('Outfits it unlocks'));
    expect(unlocks.getByText('Casual').nextElementSibling).toHaveTextContent('0 to 6');
    expect(within(unlocks.getByRole('list', { name: 'Example outfits' })).getAllByText(/White trainers/).length).toBeGreaterThan(0);

    const products = within(card('Products'));
    expect(products.getByRole('heading', { name: 'Court Classic sneaker' })).toBeInTheDocument();
    expect(products.getByText('Sample Store · $120')).toBeInTheDocument();
    // 120 dollars over 3 wears a week for 13 weeks.
    expect(products.getByText('About $3.08 a wear over a first season, at 3 wears a week. A guess.')).toBeInTheDocument();
    expect(products.getByText('Coated canvas, not leather.')).toBeInTheDocument();
    const store = products.getByRole('link', { name: 'Check at the store' });
    expect(store).toHaveAttribute('href', 'https://shop.example/court-classic');
    expect(store).toHaveAttribute('target', '_blank');
    expect(store).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('records what you saw at the store, with today\'s date', async () => {
    const user = userEvent.setup();
    await open('/buy/w-trainers');
    const products = within(card(await screen.findByRole('heading', { name: 'Products' }).then(() => 'Products')));
    await user.click(products.getAllByRole('button', { name: 'Record what you saw' })[0]!);
    const form = within(screen.getByRole('form', { name: 'What you saw for Court Classic sneaker' }));
    await user.clear(form.getByLabelText('Price on the page, in dollars'));
    await user.type(form.getByLabelText('Price on the page, in dollars'), '110');
    await user.click(form.getByRole('button', { name: 'In stock in my size' }));
    await user.type(form.getByLabelText('Size you looked at'), '9');
    await user.click(form.getByRole('button', { name: 'Pickup today' }));
    await user.click(form.getByRole('button', { name: 'Save what I saw' }));

    expect(await products.findByText('Price seen Jan 6, in stock in 9, pickup today at your store.')).toBeInTheDocument();
    expect(products.getByText('Sample Store · $110')).toBeInTheDocument();
    expect((await getWish('w-trainers'))!.options[0]!.check).toEqual({ on: '2026-01-06', by: 'you', price: 110, stock: 'in-stock', size: '9', pickup: 'today', note: undefined });
  });

  it('waits when your size is sold out', async () => {
    const user = userEvent.setup();
    await open('/buy/w-belt');
    await user.click(await screen.findByRole('button', { name: 'Record what you saw' }));
    await user.click(screen.getByRole('button', { name: 'Sold out in my size' }));
    await user.click(screen.getByRole('button', { name: 'Save what I saw' }));
    expect(await screen.findByText('Wait: sold out in your size.')).toBeInTheDocument();
  });

  it('adds a product you found yourself', async () => {
    const user = userEvent.setup();
    await open('/buy/w-coat');
    await user.click(await screen.findByRole('button', { name: 'Add a product' }));
    const form = within(screen.getByRole('form', { name: 'Add a product' }));
    await user.type(form.getByLabelText('Product name'), 'Wool car coat');
    await user.type(form.getByLabelText('Store'), 'Sample Store');
    await user.type(form.getByLabelText('Product page link'), 'shop.example/coat');
    await user.click(form.getByRole('button', { name: 'Add the product' }));
    expect(await form.findByRole('alert')).toHaveTextContent('starts with https://');
    await user.clear(form.getByLabelText('Product page link'));
    await user.type(form.getByLabelText('Product page link'), 'https://shop.example/coat');
    await user.type(form.getByLabelText('Price, in dollars'), '320');
    await user.click(form.getByRole('button', { name: 'Add the product' }));
    expect(await within(card('Products')).findByRole('heading', { name: 'Wool car coat' })).toBeInTheDocument();
    expect((await getWish('w-coat'))!.options[0]).toMatchObject({ source: 'you', addedOn: '2026-01-06', price: 320 });
  });

  it('offers a search at each of your stores', async () => {
    await open('/buy/w-coat');
    const links = within(await screen.findByRole('list', { name: 'Search your stores' })).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Sample Store', 'Another Shop']);
    expect(links[0]).toHaveAttribute('href', "https://www.google.com/search?q=Sample%20Store%20men's%20grey%20wool%20coat");
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('find options', () => {
  it('says plainly that this phone is not connected to a server', async () => {
    const user = userEvent.setup();
    await open('/buy/w-coat');
    await user.click(await screen.findByRole('button', { name: 'Find options' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This phone is not connected to your server. The store search links below work without it.');
  });

  it('says that AI leads are switched off while the server has no AI key', async () => {
    const server = standInServer();
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    await open('/buy/w-coat');
    await user.click(await screen.findByRole('button', { name: 'Find options' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI leads are switched off: your server has no AI key yet. The store search links below work without it.');
    expect(server.aiRequests).toHaveLength(0);
    expect((await getWish('w-coat'))!.options).toEqual([]);
  });

  it('adds what the search found as leads that are marked as not checked', async () => {
    const server = standInServer();
    server.aiReady = true;
    const found: LeadsResult = {
      leads: [
        { role: 'exact', name: 'Wool car coat', store: 'Sample Store', url: 'https://shop.example/p/car-coat', price: 320, pair: 0, resultTitle: 'Wool car coat | Sample Store' },
        { role: 'lookalike', name: 'Wool-blend coat', store: 'Another Shop', url: 'https://another.example/p/coat', price: 140, givesUp: 'Half polyester.', pair: 0 },
      ],
      note: 'One store had no price in the search result.',
      searches: 3,
      dropped: 1,
    };
    server.ai = () => found;
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    await open('/buy/w-coat');
    await user.click(await screen.findByRole('button', { name: 'Find options' }));

    expect(await screen.findByText(/Added 2 leads\. Each stays marked "AI lead, not checked" until you open its page/)).toBeInTheDocument();
    expect(screen.getByText(/One store had no price in the search result\./)).toBeInTheDocument();
    expect(screen.getByText(/1 left out: the link was not in the search results/)).toBeInTheDocument();
    const products = within(card('Products'));
    expect(products.getAllByText('AI lead, not checked')).toHaveLength(2);
    expect(products.getAllByText(/^AI lead from Jan 6\. Nobody has opened the page/)).toHaveLength(2);
    expect(products.getByText('Half polyester.')).toBeInTheDocument();
    // What left the phone: the piece, the stores and the rules.
    expect(server.aiRequests).toEqual([{ kind: 'leads', body: expect.objectContaining({ name: 'Grey wool coat', stores: ['Sample Store', 'Another Shop'] }) }]);
    expect(Object.keys(server.aiRequests[0]!.body).sort()).toEqual(['have', 'name', 'rules', 'stores']);
  });
});

describe('bought it, then the fit check', () => {
  it('moves the piece to the wardrobe, asks for the fit check, and re-ranks the list', async () => {
    const user = userEvent.setup();
    await open('/buy/w-trainers');
    await user.click(await screen.findByRole('button', { name: 'Bought it' }));
    const form = within(screen.getByRole('form', { name: 'Bought it' }));
    expect(form.getByRole('button', { name: 'Court Classic sneaker, Sample Store' })).toHaveAttribute('aria-pressed', 'true');
    expect(form.getByLabelText('Price paid, in dollars')).toHaveValue('120');
    await user.type(form.getByLabelText('Last day it can go back'), '2026-02-05');
    await user.click(form.getByRole('button', { name: 'Move it to my wardrobe' }));

    // Back on the list: the trainers are gone from the ranking and the fit check is waiting.
    const list = await screen.findByRole('list', { name: 'Buy in this order' });
    await waitFor(() => expect(within(list).queryByRole('link', { name: /White trainers/ })).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('White trainers: run the fit check when it arrives. It can go back until Feb 5.');
    expect((await listPieces()).find((p) => p.name === 'White trainers')).toMatchObject({ status: 'owned', pricePaid: 120, acquiredOn: '2026-01-06', detailsConfirmed: false });

    await user.click(screen.getByRole('link', { name: 'Run the fit check' }));
    expect(await screen.findByText(/It can go back until Feb 5 \(30 days left\)\./)).toBeInTheDocument();
    // Shoes have two checks: hardware and cloth.
    const hardware = within(screen.getByRole('group', { name: 'Hardware' }));
    const cloth = within(screen.getByRole('group', { name: 'Cloth' }));
    expect(hardware.queryByRole('button', { name: 'A tailor can fix it' })).not.toBeInTheDocument();
    await user.click(hardware.getByRole('button', { name: 'No' }));
    expect(screen.getByText('Your rule is silver over gold.')).toBeInTheDocument();
    await user.click(cloth.getByRole('button', { name: 'Yes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Your answers point to: return.');
    expect(within(screen.getByRole('group', { name: 'Your call' })).getByRole('button', { name: 'Return' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(screen.getByLabelText('Note'), 'Gold eyelets.');
    await user.click(screen.getByRole('button', { name: 'Save the fit check' }));

    // Sent back: out of the wardrobe and on the list again.
    const again = await screen.findByRole('list', { name: 'Buy in this order' });
    expect(await within(again).findByRole('link', { name: '3. White trainers' })).toBeInTheDocument();
    expect((await listPieces()).some((p) => p.name === 'White trainers')).toBe(false);
    expect((await getWish('w-trainers'))!.options[0]!.note).toBe('Bought and sent back after the fit check on 2026-01-06. Gold eyelets.');
  });

  it('keeps a piece that passes and opens it in the wardrobe', async () => {
    const user = userEvent.setup();
    await open('/buy/w-boots');
    await user.click(await screen.findByRole('button', { name: 'Bought it' }));
    await user.click(screen.getByRole('button', { name: 'Move it to my wardrobe' }));
    await screen.findByRole('list', { name: 'Buy in this order' });
    await user.click(screen.getByRole('link', { name: 'Run the fit check' }));
    await user.click(within(await screen.findByRole('group', { name: 'Hardware' })).getByRole('button', { name: 'Yes' }));
    await user.click(within(screen.getByRole('group', { name: 'Cloth' })).getByRole('button', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Save the fit check' }));
    expect(await screen.findByRole('heading', { name: 'Brown boots' })).toBeInTheDocument();
    expect((await getWish('w-boots'))!.fitCheck).toMatchObject({ verdict: 'keep', on: '2026-01-06' });
  });
});

describe('adding and editing a needed piece', () => {
  it('adds a piece with its tags and warns when it breaks a rule', async () => {
    const user = userEvent.setup();
    await open('/buy');
    await user.click(await screen.findByRole('link', { name: 'Add a piece' }));
    await user.type(await screen.findByLabelText('Name'), 'Black leather overshirt');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick where the piece goes in an outfit.');
    await user.click(screen.getByRole('button', { name: 'Third layer or coat' }));
    await user.type(screen.getByLabelText('Cloth you want'), 'Leather');
    expect(await screen.findByText('Breaks your rule:', { exact: false })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Cloth you want'));
    await user.type(screen.getByLabelText('Cloth you want'), 'Wool');
    await user.click(screen.getByRole('button', { name: 'Beyond your looks' }));
    await user.click(screen.getByRole('button', { name: 'Add to the list' }));

    expect(await screen.findByText('Beyond your saved looks')).toBeInTheDocument();
    const added = (await listWishes()).find((w) => w.name === 'Black leather overshirt')!;
    expect(added).toMatchObject({ origin: 'beyond-looks', state: 'open', spec: { slots: ['outer-layer'], cloth: 'Wool' } });
  });

  it('takes a piece off the list and puts it back', async () => {
    const user = userEvent.setup();
    await open('/buy/w-boots');
    await user.click(await screen.findByRole('button', { name: 'Take it off the list' }));
    const off = within(card(await screen.findByRole('heading', { name: 'Taken off the list' }).then(() => 'Taken off the list')));
    expect(off.getByRole('link', { name: 'Brown boots' })).toBeInTheDocument();
    await user.click(off.getByRole('button', { name: 'Put back' }));
    expect(await within(screen.getByRole('list', { name: 'Buy in this order' })).findByRole('link', { name: '4. Brown boots' })).toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { importBackup } from '../data/backup';
import { db } from '../data/db';
import { listPhotos, listPieces } from '../data/piecesRepo';
import { getProfile } from '../data/profileRepo';
import { fakeImage, sampleSetupFile } from '../test/fixtures';

// A Tuesday morning, which is an office day in the sample profile.
vi.mock('../domain/clock', () => ({ now: () => new Date('2026-01-06T09:00:00') }));

// The real one needs a canvas, which the test browser does not have.
vi.mock('../data/images', async (original) => ({
  ...(await original<typeof import('../data/images')>()),
  processImage: vi.fn(async () => fakeImage()),
}));

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function renderLoadedApp(path = '/wardrobe') {
  await importBackup(sampleSetupFile());
  return renderApp(path);
}

function setupFile(content: unknown = sampleSetupFile(), name = 'setup.json') {
  return new File([JSON.stringify(content)], name, { type: 'application/json' });
}

describe('first run', () => {
  it('shows the welcome screen and holds no data', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Set up your wardrobe' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(await db.profile.count()).toBe(0);
    expect(await db.pieces.count()).toBe(0);
  });

  it('loads a setup file and opens on today, with the wardrobe one tap away', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.upload(await screen.findByLabelText('Choose a setup file or backup'), setupFile());
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Wardrobe' }));
    expect(await screen.findByRole('heading', { name: 'Wardrobe' })).toBeInTheDocument();
    expect(screen.getByText('Navy zip cardigan')).toBeInTheDocument();
    expect(screen.getByText(/5 pieces you own/)).toBeInTheDocument();
  });

  it('explains a file it cannot read and stays on the welcome screen', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.upload(await screen.findByLabelText('Choose a setup file or backup'), setupFile({ hello: 'world' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a wardrobe file');
    expect(screen.getByRole('heading', { name: 'Set up your wardrobe' })).toBeInTheDocument();
  });

  it('can start with an empty profile', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('button', { name: 'Start with an empty profile' }));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText(/Your wardrobe is empty/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Wardrobe' }));
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();
  });
});

describe('wardrobe', () => {
  it('lists pieces and filters them by kind', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    expect(await screen.findByText('Tan chinos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Trousers (1)' }));
    expect(screen.getByText('Tan chinos')).toBeInTheDocument();
    expect(screen.queryByText('Navy zip cardigan')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tops (2)' }));
    expect(screen.getByText('Plain white tee')).toBeInTheDocument();
    expect(screen.getByText('Navy zip cardigan')).toBeInTheDocument();
  });

  it('marks pieces whose details still need checking', async () => {
    await renderLoadedApp();
    expect(await screen.findByText(/5 still need their details checked/)).toBeInTheDocument();
    expect(screen.getAllByText('Check details')).toHaveLength(5);
  });

  it('adds a piece with tags and a photo', async () => {
    const user = userEvent.setup();
    await renderLoadedApp();
    await user.click(await screen.findByRole('link', { name: 'Add a piece' }));
    await user.click(await screen.findByRole('link', { name: 'Fill in everything by hand' }));

    await user.type(await screen.findByLabelText('Name'), 'Cream cable zip');
    await user.type(screen.getByLabelText('Brand'), 'Sample Co');
    await user.click(screen.getByRole('button', { name: 'Main top' }));
    await user.click(screen.getByRole('button', { name: 'Cream' }));
    await user.click(screen.getByRole('button', { name: 'Rough' }));
    await user.click(screen.getByRole('button', { name: 'Full zip' }));
    await user.click(screen.getByRole('button', { name: '2 · Smart casual' }));
    await user.type(screen.getByLabelText('Cloth'), 'Wool');
    await user.type(screen.getByLabelText('Tags'), 'Cable, winter');
    await user.type(screen.getByLabelText('Price paid, in dollars'), '89.5');
    await user.upload(screen.getByLabelText('Choose photos'), new File(['x'], 'knit.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByAltText('New photo 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add to wardrobe' }));

    expect(await screen.findByRole('heading', { name: 'Cream cable zip' })).toBeInTheDocument();
    const saved = (await listPieces()).find((p) => p.name === 'Cream cable zip');
    expect(saved).toMatchObject({
      brand: 'Sample Co',
      status: 'owned',
      slots: ['main-top'],
      colorFamily: 'cream',
      texture: 'rough',
      neckline: 'full-zip',
      dressLevel: 2,
      cloth: 'Wool',
      tags: ['cable', 'winter'],
      pricePaid: 89.5,
      detailsConfirmed: true,
    });
    expect(await listPhotos(saved!.id)).toHaveLength(1);
    expect(screen.getByAltText('Cream cable zip, photo 1')).toBeInTheDocument();
  });

  it('asks for a name and a slot before saving', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/wardrobe/new');
    await user.click(await screen.findByRole('button', { name: 'Add to wardrobe' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give the piece a name');
    await user.type(screen.getByLabelText('Name'), 'Something');
    await user.click(screen.getByRole('button', { name: 'Add to wardrobe' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pick where the piece goes');
    expect(await listPieces()).toHaveLength(5);
  });

  it('warns while you type when a piece breaks a hard rule', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/wardrobe/new');
    await user.click(await screen.findByRole('button', { name: 'Third layer or coat' }));
    await user.type(screen.getByLabelText('Cloth'), 'Suede');
    const findings = screen.getByRole('list', { name: 'Rule checks' });
    expect(within(findings).getByText(/No leather clothing/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Gold or brass' }));
    expect(within(findings).getByText(/Silver over gold/)).toBeInTheDocument();
  });

  it('shows shape choices only for tops and layers', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/wardrobe/new');
    await user.click(await screen.findByRole('button', { name: 'Trousers' }));
    expect(screen.queryByText('Neckline')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Main top' }));
    expect(screen.getByText('Neckline')).toBeInTheDocument();
  });

  it('edits a piece and marks its details as checked', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/wardrobe/pc-chinos');
    expect(await screen.findByText(/have not been checked/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Edit' }));

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Tan stretch chinos');
    await user.click(screen.getByRole('button', { name: 'Mid' }));
    await user.click(screen.getByLabelText('I have checked these details against the garment'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('heading', { name: 'Tan stretch chinos' })).toBeInTheDocument();
    expect(screen.queryByText(/have not been checked/)).not.toBeInTheDocument();
    expect(await db.pieces.get('pc-chinos')).toMatchObject({ name: 'Tan stretch chinos', depth: 'mid', tags: ['slim'], detailsConfirmed: true });
  });

  it('removes a photo when editing', async () => {
    const user = userEvent.setup();
    await importBackup(sampleSetupFile());
    await db.photos.add({ id: 'ph-1', pieceId: 'pc-knit', kind: 'clothing', order: 0, createdAt: 'x', ...fakeImage() });
    renderApp('/wardrobe/pc-knit/edit');
    await user.click(await screen.findByRole('button', { name: 'Remove photo 1' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { name: 'Navy zip cardigan' });
    expect(await listPhotos('pc-knit')).toEqual([]);
  });

  it('deletes a piece only after a second tap', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/wardrobe/pc-watch');
    await user.click(await screen.findByRole('button', { name: 'Delete this piece' }));
    expect(await db.pieces.get('pc-watch')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    expect(await screen.findByRole('heading', { name: 'Wardrobe' })).toBeInTheDocument();
    expect(await db.pieces.get('pc-watch')).toBeUndefined();
  });

  it('keeps pieces you are thinking about apart from pieces you own', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/wardrobe/new');
    await user.type(await screen.findByLabelText('Name'), 'Brown suede sneaker');
    await user.click(screen.getByRole('button', { name: 'Thinking about it' }));
    await user.click(screen.getByRole('button', { name: 'Shoes' }));
    await user.click(screen.getByRole('button', { name: 'Add to wardrobe' }));
    await screen.findByRole('heading', { name: 'Brown suede sneaker' });
    await user.click(screen.getByRole('link', { name: '‹ Wardrobe' }));

    expect(await screen.findByText(/5 pieces you own/)).toBeInTheDocument();
    expect(screen.queryByText('Brown suede sneaker')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thinking about (1)' }));
    expect(screen.getByText('Brown suede sneaker')).toBeInTheDocument();
  });
});

describe('profile', () => {
  it('shows sizes, the week, stores, rules by kind and the palette', async () => {
    await renderLoadedApp('/profile');
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByText(/dated January 4, 2026/)).toBeInTheDocument();
    expect(screen.getByText('32 × 32')).toBeInTheDocument();
    expect(screen.getByText('Tue, Thu')).toBeInTheDocument();
    expect(screen.getByText('Sample Store')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hard rules' })).toBeInTheDocument();
    expect(screen.getByText(/No leather clothing and no leather watch straps/)).toBeInTheDocument();
    expect(screen.getAllByText('Your rule').length).toBeGreaterThan(0);
    expect(screen.getByText('Untested')).toBeInTheDocument();
  });

  it('edits a size', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/profile');
    await user.click(await screen.findByRole('button', { name: 'Edit sizes' }));
    const field = screen.getByLabelText('Size for Tops');
    await user.clear(field);
    await user.type(field, 'S');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await getProfile())?.sizes[0]?.value).toBe('S'));
    expect(screen.queryByLabelText('Size for Tops')).not.toBeInTheDocument();
  });

  it('changes office days', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/profile');
    await user.click(await screen.findByRole('button', { name: 'Edit your week' }));
    await user.click(screen.getByRole('button', { name: 'Mon' }));
    await user.click(screen.getByRole('button', { name: 'Thu' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Mon, Tue')).toBeInTheDocument();
  });

  it('adds a hard rule as your own rule, and cancel leaves rules alone', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/profile');
    await user.click(await screen.findByRole('button', { name: 'Edit rules' }));
    await user.click(screen.getByRole('button', { name: 'Add to hard rules' }));
    await user.type(screen.getByLabelText('Hard rules, rule 5'), 'No logos.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    // Wait for the form to close first: while it is open, the text box holds the same words.
    await waitFor(() => expect(screen.queryByLabelText('Hard rules, rule 5')).not.toBeInTheDocument());
    expect(await screen.findByText('No logos.')).toBeInTheDocument();
    const rules = (await getProfile())!.rules;
    expect(rules.at(-1)).toMatchObject({ kind: 'hard', text: 'No logos.', evidence: 'your-rule' });

    await user.click(screen.getByRole('button', { name: 'Edit rules' }));
    await user.clear(screen.getByLabelText('Hard rules, rule 1'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((await getProfile())!.rules).toEqual(rules);
  });
});

describe('settings', () => {
  it('shows what is stored and loads a setup file only after a confirm', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/settings');
    expect(await screen.findByText('5 pieces, 0 photos')).toBeInTheDocument();
    await db.pieces.delete('pc-tee');

    await user.upload(screen.getByLabelText('Choose a backup or setup file'), setupFile());
    expect(await screen.findByText(/replaces your profile and adds any of these pieces/)).toBeInTheDocument();
    expect(await db.pieces.count()).toBe(4);
    await user.click(screen.getByRole('button', { name: 'Load it' }));
    expect(await screen.findByText(/1 piece added, 4 already here/)).toBeInTheDocument();
  });

  it('erases everything after a second tap and returns to the welcome screen', async () => {
    const user = userEvent.setup();
    await renderLoadedApp('/settings');
    await user.click(await screen.findByRole('button', { name: 'Erase everything' }));
    expect(await db.pieces.count()).toBe(5);
    await user.click(screen.getByRole('button', { name: 'Yes, erase everything' }));
    expect(await screen.findByRole('heading', { name: 'Set up your wardrobe' })).toBeInTheDocument();
    expect(await db.pieces.count()).toBe(0);
    expect(await db.profile.count()).toBe(0);
  });
});

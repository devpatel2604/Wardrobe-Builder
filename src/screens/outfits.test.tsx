import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { db } from '../data/db';
import { recentLog } from '../data/outfitLogRepo';
import { plansBetween } from '../data/planRepo';
import { sampleProfile } from '../test/fixtures';
import { boots, hourly, samplePalette, savedLook, smallWardrobe, stretchLook } from '../test/outfitFixtures';
import type { Piece, Profile } from '../domain/types';

// Tuesday, January 6, 2026. The sample profile has the office on Tuesday and Thursday, 9 am to 5 pm.
const clock = vi.hoisted(() => ({ time: '2026-01-06T07:30:00' }));
vi.mock('../domain/clock', () => ({ now: () => new Date(clock.time) }));

afterEach(() => {
  clock.time = '2026-01-06T07:30:00';
  vi.unstubAllGlobals();
});

async function open(path: string, options: { pieces?: Piece[]; profile?: Partial<Profile> } = {}) {
  await db.profile.put({ ...sampleProfile(), palette: samplePalette, formulas: [savedLook, stretchLook], ...options.profile });
  await db.pieces.bulkPut(options.pieces ?? smallWardrobe());
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/** Answers both weather service calls with an hourly forecast. */
function stubForecast(days: Parameters<typeof hourly>[0]) {
  const periods = hourly(days).map((h) => ({
    startTime: h.startTime,
    temperature: h.temperatureF,
    temperatureUnit: 'F',
    probabilityOfPrecipitation: { value: h.precipChance },
    shortForecast: h.shortForecast,
  }));
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).includes('/points/')
      ? { properties: { forecastHourly: 'https://api.weather.gov/gridpoints/ABC/1,2/forecast/hourly' } }
      : { properties: { periods } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const outfitCard = () => screen.findByRole('region', { name: 'Outfit' });

describe('today', () => {
  it('opens on the office outfit for an office day, with the reasons and their labels', async () => {
    await open('/');
    const card = await outfitCard();
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('Tuesday, January 6')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Office (planned)' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card).getByText('From your looks')).toBeInTheDocument();
    for (const name of ['Charcoal zip cardigan', 'White tee', 'Navy pleated trousers', 'Black derbies']) {
      expect(within(card).getByText(name)).toBeInTheDocument();
    }
    expect(within(card).getByText('Always with it: Steel watch')).toBeInTheDocument();
    const why = within(card).getByRole('list', { name: 'Why this outfit' });
    expect(
      within(why).getByText(/Your saved look: "Zip knit over a white layer with navy trousers" \(A Creator, post seen and linked\)\./),
    ).toBeInTheDocument();
    expect(within(why).getByText('Your choice')).toBeInTheDocument();
    expect(within(why).getAllByText('Convention')).toHaveLength(2);
    expect(within(screen.getByRole('list', { name: 'Heads up' })).getByText(/You own no belt yet/)).toBeInTheDocument();
  });

  it('shows two alternates and says when there is no stretch to offer', async () => {
    const user = userEvent.setup();
    await open('/today');
    await outfitCard();
    expect(screen.getByRole('heading', { name: 'Alternates' })).toBeInTheDocument();
    expect(screen.getAllByText('Built from your rules')).toHaveLength(2);
    expect(screen.getByText(/No stretch pick/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Show this one' })[0]!);
    expect(within(await outfitCard()).getByText('Green cable crewneck')).toBeInTheDocument();
  });

  it('labels a stretch look among the alternates', async () => {
    const polo: Piece = {
      ...smallWardrobe()[1]!,
      id: 'polo',
      name: 'Blue knit polo',
      colorFamily: 'blue',
      neckline: 'polo-collar',
      dressLevel: 3,
      hem: undefined,
    };
    const cream: Piece = { ...smallWardrobe()[3]!, id: 'cream', name: 'Cream trousers', colorFamily: 'cream', dressLevel: 3, tags: [] };
    await open('/today?occasion=date', { pieces: [...smallWardrobe(), polo, cream] });
    await outfitCard();
    expect(screen.getByText('Stretch · suits you')).toBeInTheDocument();
    expect(screen.queryByText(/No stretch pick/)).not.toBeInTheDocument();
    expect(within(await outfitCard()).queryByText('Stretch · suits you')).not.toBeInTheDocument();
  });

  it('logs "wore it", counts the wear, takes a rating, and can be undone', async () => {
    const user = userEvent.setup();
    await open('/today');
    await user.click(within(await outfitCard()).getByRole('button', { name: 'Wore it' }));
    expect(await screen.findByRole('heading', { name: 'You wore this today' })).toBeInTheDocument();
    expect(await recentLog()).toMatchObject([
      { date: '2026-01-06', occasion: 'office', action: 'wore', pieces: { mainTop: 'zip', underLayer: 'tee', trousers: 'pleats', shoes: 'derbies' } },
    ]);
    expect((await db.pieces.get('zip'))?.wearCount).toBe(1);
    expect(screen.queryByRole('heading', { name: 'Alternates' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Loved it' }));
    await waitFor(async () => expect((await recentLog())[0]?.rating).toBe('loved'));

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: 'Wore it' })).toBeInTheDocument();
    expect(await recentLog()).toEqual([]);
    expect((await db.pieces.get('zip'))?.wearCount).toBe(0);
  });

  it('moves to another outfit on "not today" and keeps the reason', async () => {
    const user = userEvent.setup();
    await open('/today');
    await user.click(within(await outfitCard()).getByRole('button', { name: 'Not today' }));
    expect(await screen.findByText(/Passed over/)).toBeInTheDocument();
    await waitFor(async () => expect(within(await outfitCard()).queryByText('Navy pleated trousers')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Too formal' }));
    await waitFor(async () =>
      expect((await recentLog())[0]).toMatchObject({ action: 'not-today', reason: 'too-formal', outfitKey: 'zip|tee|pleats|derbies|' }),
    );
  });

  it('swaps one piece for another that still passes the rules', async () => {
    const user = userEvent.setup();
    await open('/today');
    const card = await outfitCard();
    await user.click(within(card).getByRole('button', { name: 'Swap a piece' }));
    await user.click(within(screen.getByRole('group', { name: 'Which piece to swap' })).getByRole('button', { name: 'Trousers' }));
    const choices = screen.getByRole('group', { name: 'Swap for' });
    // The joggers are two dress levels below the shoes, so they are not offered.
    expect(
      within(choices)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Tan chinos']);
    await user.click(within(choices).getByRole('button', { name: 'Tan chinos' }));
    expect(await screen.findByRole('heading', { name: 'Your swap' })).toBeInTheDocument();
    expect(within(await outfitCard()).getByText('Tan chinos')).toBeInTheDocument();
    expect(within(await outfitCard()).getByText('Charcoal zip cardigan')).toBeInTheDocument();

    await user.click(within(await outfitCard()).getByRole('button', { name: 'Wore it' }));
    await waitFor(async () => expect((await recentLog())[0]).toMatchObject({ swapped: true, pieces: { trousers: 'chinos' } }));
  });

  it('names the gap for an occasion nothing works for, and what would fill it', async () => {
    const user = userEvent.setup();
    await open('/today');
    await outfitCard();
    await user.click(screen.getByRole('button', { name: 'Casual' }));
    expect(await screen.findByRole('heading', { name: 'Nothing to wear for a casual day' })).toBeInTheDocument();
    expect(screen.getByText(/every combination comes out too dressy/)).toBeInTheDocument();
    expect(screen.getByText('Adding a casual shoe would make 9 outfits possible.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Outfit' })).not.toBeInTheDocument();
  });

  it('builds an outfit around one piece, from the piece page too', async () => {
    const user = userEvent.setup();
    await open('/wardrobe/chinos');
    await user.click(await screen.findByRole('link', { name: 'Build an outfit around this' }));
    expect(await screen.findByText(/Built around: Tan chinos/)).toBeInTheDocument();
    expect(within(await outfitCard()).getByText('Tan chinos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to all outfits' }));
    await waitFor(async () => expect(within(await outfitCard()).getByText('Navy pleated trousers')).toBeInTheDocument());
  });

  it('has no forecast without a map point, and takes the weather by hand', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await open('/today');
    await outfitCard();
    expect(screen.getByText(/the app has no map point for your town/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Under 50°F' }));
    expect(await screen.findByText('Under 50°F, dry (set by you)')).toBeInTheDocument();
    expect(await screen.findByText(/40°F and you own no coat/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Wet' }));
    await waitFor(async () => expect(within(await outfitCard()).getByText(/Black derbies: not marked as fine in rain or snow/)).toBeInTheDocument());
    expect((await plansBetween('2026-01-06', '2026-01-06')).get('2026-01-06')).toMatchObject({
      occasions: ['office'],
      manualWeather: { band: 'cold', wet: true },
    });
  });

  it('reads the forecast for the office hours and applies it', async () => {
    const fetchMock = stubForecast([{ date: '2026-01-06', tempF: 34, wet: true }]);
    await open('/today', { pieces: [...smallWardrobe(), boots], profile: { home: { town: 'Springfield', pickup: '', point: { lat: 40, lon: -74 } } } });
    expect(await screen.findByText('34°F at 9 am, 42°F at 5 pm, rain likely (80%)')).toBeInTheDocument();
    expect(screen.getByText(/National Weather Service, read at/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.map((c) => String(c[0]))[0]).toBe('https://api.weather.gov/points/40,-74');
    const card = await outfitCard();
    await waitFor(() => expect(within(card).getByText('Brown boots')).toBeInTheDocument());
    expect(within(card).queryByText(/Not right for the weather/)).not.toBeInTheDocument();
  });

  it('keeps working when the weather service cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await open('/today', { profile: { home: { town: 'Springfield', pickup: '', point: { lat: 40, lon: -74 } } } });
    expect(await screen.findByText(/The forecast could not be loaded/)).toBeInTheDocument();
    expect(within(await outfitCard()).getByText('Charcoal zip cardigan')).toBeInTheDocument();
  });

  it('opens on tomorrow in the evening before an office day', async () => {
    clock.time = '2026-01-07T19:00:00'; // Wednesday evening. Thursday is an office day.
    await open('/today');
    expect(await screen.findByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument();
    expect(screen.getByText('Thursday, January 8')).toBeInTheDocument();
    const card = await outfitCard();
    // Tomorrow's outfit cannot be worn yet.
    expect(within(card).queryByRole('button', { name: 'Wore it' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Not this one' })).toBeInTheDocument();
  });
});

describe('week', () => {
  it('lays out the office days without repeating a top, and shows the coverage grid', async () => {
    await open('/week');
    expect(await screen.findByRole('heading', { name: 'Week' })).toBeInTheDocument();
    const days = screen.getAllByRole('listitem').filter((li) => li.classList.contains('day'));
    expect(days).toHaveLength(7);
    expect(within(days[0]!).getByText('Today')).toBeInTheDocument();
    expect(within(days[0]!).getByText(/Charcoal zip cardigan · White tee · Navy pleated trousers · Black derbies/)).toBeInTheDocument();
    expect(within(days[1]!).getByText('Nothing planned.')).toBeInTheDocument();
    expect(within(days[2]!).getByText(/Green cable crewneck/)).toBeInTheDocument();

    const grid = screen.getByRole('table');
    const cells = within(grid)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      );
    expect(cells).toEqual([
      ['4', '0'],
      ['0', '0'],
      ['4', '0'],
      ['4', '0'],
    ]);
    expect(within(grid).getByRole('rowheader', { name: 'Going out' })).toBeInTheDocument();
    expect(screen.getByText(/Counted without a temperature/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'What would fill the gaps' })).getByText(/A casual shoe would make 9 outfits possible/)).toBeInTheDocument();
  });

  it('adds an occasion to a day, plans it, and warns early when nothing works', async () => {
    const user = userEvent.setup();
    await open('/week');
    await screen.findByRole('heading', { name: 'Week' });
    await user.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    const editor = screen.getByRole('group', { name: 'Occasions on Wed 7' });
    await user.click(within(editor).getByRole('button', { name: 'Date' }));
    await user.click(within(editor).getByRole('button', { name: 'Casual' }));
    await waitFor(async () => expect((await plansBetween('2026-01-07', '2026-01-07')).get('2026-01-07')?.occasions).toEqual(['casual', 'date']));

    await user.click(screen.getByRole('button', { name: 'Done' }));
    const wednesday = screen.getAllByRole('listitem').filter((li) => li.classList.contains('day'))[1]!;
    expect(await within(wednesday).findByText('Date')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Heads up for the week' })).getByText(/^Wed 7, casual: Nothing you own works for a casual day/),
    ).toBeInTheDocument();

    await user.click(within(wednesday).getByRole('link', { name: 'See the reasons and alternates' }));
    expect(await screen.findByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Date (planned)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('takes the office off a day and puts it back', async () => {
    const user = userEvent.setup();
    await open('/week');
    await screen.findByRole('heading', { name: 'Week' });
    await user.click(screen.getAllByRole('button', { name: 'Change' })[0]!);
    await user.click(within(screen.getByRole('group', { name: 'Occasions on Tue 6' })).getByRole('button', { name: 'Office' }));
    const tuesday = screen.getAllByRole('listitem').filter((li) => li.classList.contains('day'))[0]!;
    await waitFor(() => expect(within(tuesday).queryByText(/Charcoal zip cardigan/)).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Back to the usual for this day' }));
    expect(await within(tuesday).findByText(/Charcoal zip cardigan/)).toBeInTheDocument();
  });

  it('uses the forecast of each day and flags a wet office day', async () => {
    stubForecast([
      { date: '2026-01-06', tempF: 34 },
      { date: '2026-01-08', tempF: 30, wet: true },
    ]);
    await open('/week', { profile: { home: { town: 'Springfield', pickup: '', point: { lat: 40, lon: -74 } } } });
    expect(await screen.findByText(/34°F at 9 am, 42°F at 5 pm, dry/)).toBeInTheDocument();
    expect(await screen.findByText(/^Thu 8, office: Nothing you own fully suits a wet day for the office/)).toBeInTheDocument();
    expect(screen.getByText('Not right for the weather')).toBeInTheDocument();
    expect(screen.getByText(/Counted for about 32°F/)).toBeInTheDocument();
  });
});

describe('settings', () => {
  it('saves and removes the map point for the weather', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await open('/settings');
    await user.type(await screen.findByLabelText('Latitude'), '40.1234');
    await user.type(screen.getByLabelText('Longitude'), '-74.5678');
    await user.click(screen.getByRole('button', { name: 'Save map point' }));
    await waitFor(async () => expect((await db.profile.get('me'))?.home.point).toEqual({ lat: 40.12, lon: -74.57 }));
    expect(await screen.findByText(/Yours is 40.12, -74.57/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove it' }));
    await waitFor(async () => expect((await db.profile.get('me'))?.home.point).toBeUndefined());
  });
});

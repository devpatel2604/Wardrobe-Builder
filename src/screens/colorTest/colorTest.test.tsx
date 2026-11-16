import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { importBackup } from '../../data/backup';
import { addPick, getColorTest, saveShot, setTestColors } from '../../data/colorTestRepo';
import { db } from '../../data/db';
import { getProfile } from '../../data/profileRepo';
import { STANDARD_TEST_COLORS, testColorLabel, type TestColor } from '../../domain/colorTest';
import { fakeImage, sampleSetupFile } from '../../test/fixtures';

// The real one needs a canvas, which the test browser does not have. The test
// browser has no camera either, so these tests go through the fallback: the
// phone's own camera, reached with a file input.
vi.mock('../../data/images', async (original) => ({
  ...(await original<typeof import('../../data/images')>()),
  processImage: vi.fn(async () => fakeImage()),
}));

async function renderApp(path: string) {
  await importBackup(sampleSetupFile());
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function seedShots(colors: TestColor[]) {
  await setTestColors(colors);
  for (const color of colors) await saveShot(color, fakeImage());
}

const jpeg = () => new File(['x'], 'me.jpg', { type: 'image/jpeg' });

describe('starting the color test', () => {
  it('is offered on the wardrobe screen until it is started or waved off', async () => {
    const user = userEvent.setup();
    await renderApp('/wardrobe');
    const prompt = await screen.findByRole('region', { name: 'Color photo test' });
    await user.click(within(prompt).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Color photo test' })).not.toBeInTheDocument());
  });

  it('explains the test and starts with the twelve standard colors chosen', async () => {
    const user = userEvent.setup();
    await renderApp('/profile');
    await user.click(await screen.findByRole('link', { name: 'Take the color photo test' }));
    expect(await screen.findByRole('heading', { name: 'Color photo test' })).toBeInTheDocument();
    expect(screen.getByText(/never part of a backup/)).toBeInTheDocument();
    expect(screen.getByText('12 colors chosen.')).toBeInTheDocument();
    for (const color of STANDARD_TEST_COLORS) {
      expect(screen.getByRole('button', { name: testColorLabel(color) })).toHaveAttribute('aria-pressed', 'true');
    }
    expect(screen.getByRole('button', { name: 'Mid grey' })).toHaveAttribute('aria-pressed', 'false');
    // Pieces from the wardrobe are suggested as things to hold up.
    expect(screen.getByText('Plain white tee')).toBeInTheDocument();
  });

  it('will not start with fewer than two colors', async () => {
    const user = userEvent.setup();
    await renderApp('/color-test');
    for (const color of STANDARD_TEST_COLORS.slice(1)) await user.click(await screen.findByRole('button', { name: testColorLabel(color) }));
    await user.click(screen.getByRole('button', { name: 'Start the test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least two colors');
    expect(await getColorTest()).toBeUndefined();
  });
});

describe('the whole test, from photos to palette', () => {
  it('takes three photos, compares them and saves the ranking to the palette', async () => {
    const user = userEvent.setup();
    await renderApp('/color-test');

    // Keep white, navy and black. Turn the other nine off.
    for (const color of STANDARD_TEST_COLORS.filter((c) => !['white', 'navy', 'black'].includes(c))) {
      await user.click(await screen.findByRole('button', { name: testColorLabel(color) }));
    }
    expect(screen.getByText('3 colors chosen.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start the test' }));

    // Photos, one color after another.
    for (const [name, place] of [['white', '1 of 3'], ['navy', '2 of 3'], ['black', '3 of 3']] as const) {
      expect(await screen.findByText(place)).toBeInTheDocument();
      await user.upload(screen.getByLabelText(`Take the ${name} photo with the phone's camera`), jpeg());
      expect(await screen.findByAltText(`The photo you just took with ${name}`)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Use this photo' }));
    }

    // Back on the overview with all three taken.
    expect(await screen.findByText('Every color has a photo. Tap one to retake it.')).toBeInTheDocument();
    expect((await getColorTest())!.shots).toHaveLength(3);
    await user.click(screen.getByRole('link', { name: 'Start comparing' }));

    // Three colors make three pairs. Navy wins twice, white beats black.
    expect(await screen.findByText('Pick 1 of about 3')).toBeInTheDocument();
    for (let i = 0; i < 3; i++) {
      // Wait for the screen to move on to this pair before reading it.
      await screen.findByText(`Pick ${i + 1} of about 3`);
      const choices = screen.getAllByRole('button', { name: /^Pick / });
      const names = choices.map((c) => c.getAttribute('aria-label')!);
      const want = names.includes('Pick Navy') ? 'Pick Navy' : 'Pick White';
      const before = (await getColorTest())!.picks.length;
      await user.click(screen.getByRole('button', { name: want }));
      await waitFor(async () => expect((await getColorTest())!.picks).toHaveLength(before + 1));
    }
    expect(await screen.findByText('Every pair has been compared.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'See your ranking' }));

    // The ranking, with a verdict for each color that can be changed.
    expect(await screen.findByRole('heading', { name: 'Your colors, ranked' })).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('ranking-row'));
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Navy', 'White', 'Black']);
    const black = within(screen.getByRole('group', { name: 'Black near your face' }));
    expect(black.getByRole('button', { name: 'Not near face' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(black.getByRole('button', { name: 'Fine' }));

    // The open test about black is ticked for removal.
    expect(screen.getByRole('checkbox', { name: 'Black near the face.' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save to my palette' }));
    expect(await screen.findByText(/These results are in your palette/)).toBeInTheDocument();

    const profile = (await getProfile())!;
    expect(profile.palette.map((e) => [e.color, e.test?.verdict])).toEqual([
      ['Navy', 'best'],
      ['White', 'fine'],
      ['Black', 'fine'],
    ]);
    expect(profile.rules.some((r) => r.id === 'r-black')).toBe(false);

    // The profile shows the result as the owner's own test.
    await user.click(screen.getByRole('link', { name: 'See your palette' }));
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getAllByText('Your test')).toHaveLength(3);
    expect(screen.getByText(/ranked by your own picks/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the color photo test' })).toBeInTheDocument();
  });
});

describe('photos', () => {
  it('lets a color be skipped and come back to later', async () => {
    const user = userEvent.setup();
    await importBackup(sampleSetupFile());
    await setTestColors(['white', 'navy', 'black']);
    render(
      <MemoryRouter initialEntries={['/color-test/capture/white']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('2 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '‹ Done' }));
    expect(await screen.findByRole('link', { name: 'Take the first photo' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'White: take the photo' })).toBeInTheDocument();
  });

  it('retakes a photo before keeping it', async () => {
    const user = userEvent.setup();
    await importBackup(sampleSetupFile());
    await setTestColors(['white', 'navy']);
    render(
      <MemoryRouter initialEntries={['/color-test/capture/white']}>
        <App />
      </MemoryRouter>,
    );
    await user.upload(await screen.findByLabelText('Choose a white photo'), jpeg());
    await user.click(await screen.findByRole('button', { name: 'Retake' }));
    expect(screen.getByRole('button', { name: "Open the phone's camera" })).toBeInTheDocument();
    expect(await db.photos.count()).toBe(0);
  });

  it('sends an unknown color back to the overview', async () => {
    await importBackup(sampleSetupFile());
    await setTestColors(['white', 'navy']);
    render(
      <MemoryRouter initialEntries={['/color-test/capture/mustard']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Color photo test' })).toBeInTheDocument();
  });

  it('warns when the photos were taken too far apart', async () => {
    await importBackup(sampleSetupFile());
    await seedShots(['white', 'navy']);
    const test = (await getColorTest())!;
    test.shots[0]!.takenAt = '2026-01-05T09:00:00.000Z';
    test.shots[1]!.takenAt = '2026-01-05T12:00:00.000Z';
    await db.colorTests.put(test);
    render(
      <MemoryRouter initialEntries={['/color-test']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/taken over 3 hours/)).toBeInTheDocument();
  });

  it('deletes the photos on request and keeps the ranking', async () => {
    const user = userEvent.setup();
    await importBackup(sampleSetupFile());
    await seedShots(['white', 'navy']);
    await addPick('white', 'navy', 'navy');
    render(
      <MemoryRouter initialEntries={['/color-test']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Delete the photos, keep the results' }));
    expect(await db.photos.count()).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Yes, delete the photos' }));
    await waitFor(async () => expect(await db.photos.count()).toBe(0));
    expect(await screen.findByText(/no longer on this phone/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See your ranking' })).toBeInTheDocument();
  });
});

describe('comparing', () => {
  it('records "about the same" and can undo a pick', async () => {
    const user = userEvent.setup();
    await importBackup(sampleSetupFile());
    await seedShots(['white', 'navy', 'black', 'tan']);
    render(
      <MemoryRouter initialEntries={['/color-test/compare']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'About the same' }));
    await waitFor(async () => expect((await getColorTest())!.picks).toEqual([expect.objectContaining({ winner: 'same' })]));
    expect(await screen.findByText('Pick 2 of about 6')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo the last pick' }));
    await waitFor(async () => expect((await getColorTest())!.picks).toEqual([]));
  });

  it('shows two different colors with their photos', async () => {
    await importBackup(sampleSetupFile());
    await seedShots(['white', 'navy']);
    render(
      <MemoryRouter initialEntries={['/color-test/compare']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Pick White' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pick Navy' })).toBeInTheDocument();
    expect(screen.getByAltText('You with white')).toBeInTheDocument();
    expect(screen.getByAltText('You with navy')).toBeInTheDocument();
  });
});

describe('results', () => {
  it('can be undone, which puts the old palette back', async () => {
    const user = userEvent.setup();
    await importBackup(sampleSetupFile());
    await seedShots(['white', 'navy']);
    await addPick('white', 'navy', 'navy');
    render(
      <MemoryRouter initialEntries={['/color-test/results']}>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Save to my palette' }));
    await waitFor(async () => expect((await getProfile())!.palette[0]!.evidence).toBe('your-test'));
    await user.click(await screen.findByRole('button', { name: 'Undo, put the old palette back' }));
    await waitFor(async () => expect((await getProfile())!.palette.map((e) => e.id)).toEqual(['p-navy', 'p-black']));
    expect(await screen.findByRole('button', { name: 'Save to my palette' })).toBeEnabled();
  });

  it('says so when there are no picks yet', async () => {
    await importBackup(sampleSetupFile());
    await seedShots(['white', 'navy']);
    render(
      <MemoryRouter initialEntries={['/color-test/results']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/There is no ranking yet/)).toBeInTheDocument();
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { importBackup } from '../data/backup';
import { listInbox } from '../data/inboxRepo';
import { connectServer } from '../data/server';
import { sampleSetupFile } from '../test/fixtures';
import { STAND_IN_KEY, standInServer } from '../test/standInServer';
import { PAGE_SCRIPT } from './ShortcutGuideScreen';

// The real one needs a canvas, which the test browser does not have.
vi.mock('../data/images', async (original) => ({
  ...(await original<typeof import('../data/images')>()),
  blankTestImage: vi.fn(async () => ({ mediaType: 'image/jpeg', data: 'AAAA' })),
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

describe('AI tagging in Settings', () => {
  it('waits for the server before offering anything', async () => {
    await open('/settings');
    expect(await screen.findByRole('heading', { name: 'AI tagging and the share menu' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AI tagging' })).not.toBeInTheDocument();
  });

  it('says it is off and how to turn it on, with nothing to test yet', async () => {
    standInServer();
    await connectServer(STAND_IN_KEY);
    await open('/settings');
    const ai = within(await screen.findByRole('heading', { name: 'AI tagging' }).then((h) => h.closest('section')!));
    expect(await ai.findByText(/Off. Your server has no AI key yet/)).toBeInTheDocument();
    expect(ai.queryByRole('button', { name: 'Test it' })).not.toBeInTheDocument();
    expect(ai.getByText('How to turn it on')).toBeInTheDocument();
    expect(ai.getByText(/Add a secret named ANTHROPIC_API_KEY/)).toBeInTheDocument();
    expect(ai.getByText(/Photos of you are never sent/)).toBeInTheDocument();
  });

  it('shows the count and the models when it is on, and tests with a blank square', async () => {
    const server = standInServer();
    server.aiReady = true;
    server.aiUsed = 3;
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    await open('/settings');
    const ai = within(await screen.findByRole('heading', { name: 'AI tagging' }).then((h) => h.closest('section')!));
    expect(await ai.findByText('On. 3 of 120 requests used today.')).toBeInTheDocument();
    expect(ai.getByText('Tags from a clothing photo')).toBeInTheDocument();
    expect(ai.getAllByText('claude-opus-5-5, up to 60 a day')).toHaveLength(2);

    await user.click(ai.getByRole('button', { name: 'Test it' }));
    expect(await ai.findByText(/It works. claude-opus-5-5 answered/)).toBeInTheDocument();
    expect(server.aiRequests).toEqual([{ kind: 'piece-photo', body: { images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] } }]);
    expect(ai.getByText('On. 4 of 120 requests used today.')).toBeInTheDocument();
  });

  it('explains a failed test in plain words', async () => {
    const server = standInServer();
    server.aiReady = true;
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    await open('/settings');
    const ai = within(await screen.findByRole('heading', { name: 'AI tagging' }).then((h) => h.closest('section')!));
    const button = await ai.findByRole('button', { name: 'Test it' });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'The AI provider did not accept the key.', code: 'ai-key-rejected' }), { status: 502 }));
    await user.click(button);
    expect(await ai.findByRole('alert')).toHaveTextContent('The AI provider did not accept the key.');
  });
});

describe('the share menu in Settings', () => {
  it('collects shared items and points to the list', async () => {
    const server = standInServer();
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    await open('/settings');
    await screen.findByRole('heading', { name: 'Share menu' });
    server.shared.push({ id: 'abc123', kind: 'link', receivedAt: '2026-01-06T08:00:00.000Z', url: 'https://shop.example/p/2' });
    await user.click(within(card('Share menu')).getByRole('button', { name: 'Check for shared items' }));
    expect(await screen.findByText(/1 new item is waiting to be added/)).toBeInTheDocument();
    expect(await listInbox()).toHaveLength(1);
    await user.click(screen.getByRole('link', { name: 'Open the list' }));
    expect(await screen.findByRole('heading', { name: 'Waiting to be added' })).toBeInTheDocument();
  });

  it('collects on its own when the app opens', async () => {
    const server = standInServer();
    await connectServer(STAND_IN_KEY);
    server.shared.push({ id: 'abc123', kind: 'link', receivedAt: '2026-01-06T08:00:00.000Z', url: 'https://shop.example/p/2' });
    await open('/wardrobe');
    expect(await screen.findByRole('link', { name: /1 thing is waiting to be added/ })).toBeInTheDocument();
    expect(server.shared).toHaveLength(0);
  });
});

describe('the Shortcut guide', () => {
  it('gives the address and copies the Authorization value without showing the key', async () => {
    standInServer();
    await connectServer(STAND_IN_KEY);
    const user = userEvent.setup();
    await open('/settings');
    await user.click(await screen.findByRole('link', { name: 'Set up the Shortcut' }));

    expect(await screen.findByRole('heading', { name: 'Set up the Shortcut' })).toBeInTheDocument();
    expect(screen.getByText(`${location.origin}/api/inbox`)).toBeInTheDocument();
    expect(screen.getByText(/have not been tried on a real iPhone yet/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(STAND_IN_KEY);

    await user.click(screen.getByRole('button', { name: 'Copy the Authorization value' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(`Bearer ${STAND_IN_KEY}`);
  });

  it('asks for a connection first when there is no app key to copy', async () => {
    await open('/settings/shortcut');
    expect(await screen.findByText(/This phone is not connected to your server yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy the Authorization value' })).not.toBeInTheDocument();
  });

  it('has a script that returns the page as the JSON the app and the server expect', () => {
    // Run the script against a stand-in page, the way Shortcuts runs it in Safari.
    const page = {
      location: { href: 'https://shop.example/p/1' },
      document: {
        title: 'Cable crewneck | Shop',
        body: { innerText: 'Cable crewneck\n100% cotton\n$89.90 ' + 'x'.repeat(30_000) },
        querySelector: (selector: string) => (selector.includes('description') ? { content: 'A heavy cotton knit.' } : null),
        querySelectorAll: () => [{ textContent: '{"@type":"Product","name":"Cable crewneck"}' }],
      },
    };
    let result = '';
    new Function('document', 'location', 'completion', PAGE_SCRIPT)(page.document, page.location, (value: string) => {
      result = value;
    });
    const sent = JSON.parse(result) as Record<string, string>;
    expect(sent).toMatchObject({ url: 'https://shop.example/p/1', title: 'Cable crewneck | Shop', description: 'A heavy cotton knit.' });
    expect(sent.data).toContain('"@type":"Product"');
    expect(sent.text).toHaveLength(18_000);
    // Inside what the server's inbox accepts for one page.
    expect(result.length).toBeLessThan(40_000);
    expect(result.startsWith('{')).toBe(true);
  });
});

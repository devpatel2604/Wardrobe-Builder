import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { importBackup } from '../data/backup';
import { db } from '../data/db';
import { connectServer, getAppKey } from '../data/server';
import { getBackupState } from '../data/serverBackup';
import { sampleSetupFile } from '../test/fixtures';

/**
 * A small stand-in for the server, enough for the screens. The app's backup
 * and restore logic is tested against the real server code in
 * src/data/serverBackup.test.ts.
 */
const KEY = 'screen-test-key-0123456789';

function standInServer(options: { kind?: 'ready' | 'no-key' | 'files-only' } = {}) {
  const state = { calls: [] as string[], snapshots: 0, down: false };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    state.calls.push(`${method} ${path}`);
    if (state.down) throw new TypeError('Failed to fetch');
    if (options.kind === 'files-only') return new Response('<!doctype html><title>Wardrobe</title>', { headers: { 'Content-Type': 'text/html' } });
    if (path === '/api/health') return json({ app: 'wardrobe-builder', server: 1, ready: options.kind !== 'no-key' });
    if (new Headers(init?.headers).get('Authorization') !== `Bearer ${KEY}`) return json({ error: 'That app key is not right.' }, 401);
    if (path === '/api/status') return json({ ok: true, backups: { count: state.snapshots, latestAt: null }, reminders: 0, pushKey: 'x' });
    if (path === '/api/backup') return json({ snapshots: [], photoIds: [] });
    if (path === '/api/backup/snapshots' && method === 'POST') {
      state.snapshots++;
      return json({ id: 's1', createdAt: '2026-01-05T09:30:00.000Z', kept: 1 });
    }
    if (path === '/api/data' && method === 'DELETE') return json({ ok: true });
    return json({ error: 'There is nothing at that address.' }, 404);
  };
  vi.stubGlobal('fetch', fetcher);
  return state;
}

afterEach(() => vi.unstubAllGlobals());

async function openSettings() {
  await importBackup(sampleSetupFile());
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Settings' });
}

const card = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;

describe('connecting to the server', () => {
  it('refuses a wrong app key and connects with the right one', async () => {
    standInServer();
    const user = userEvent.setup();
    await openSettings();
    expect(screen.getByText(/nothing is uploaded/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Automatic backup' })).not.toBeInTheDocument();

    await user.type(await screen.findByLabelText('App key'), 'wrong-key-0123456789');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That app key is not right.');
    expect(await getAppKey()).toBeUndefined();

    await user.clear(screen.getByLabelText('App key'));
    await user.type(screen.getByLabelText('App key'), `  ${KEY} `);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('heading', { name: 'Automatic backup' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Evening reminder' })).toBeInTheDocument();
    expect(await getAppKey()).toBe(KEY);
  });

  it('says so when the address has no server, and asks for no key', async () => {
    standInServer({ kind: 'files-only' });
    await openSettings();
    expect(await screen.findByText(/There is no server here/)).toBeInTheDocument();
    expect(screen.queryByLabelText('App key')).not.toBeInTheDocument();
  });

  it('explains how to finish setup when the server has no key yet, and can make one', async () => {
    standInServer({ kind: 'no-key' });
    const user = userEvent.setup();
    await openSettings();
    expect(await screen.findByText(/add a secret named APP_KEY/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make a key for me' }));
    expect((screen.getByLabelText('App key') as HTMLInputElement).value).toMatch(/^([a-z2-9]{4}-){5}[a-z2-9]{4}$/);
  });

  it('forgets the key when the phone is disconnected', async () => {
    standInServer();
    const user = userEvent.setup();
    await connectServer(KEY);
    await openSettings();
    await user.click(await screen.findByRole('button', { name: 'Disconnect this phone' }));
    expect(await screen.findByLabelText('App key')).toBeInTheDocument();
    expect(await getAppKey()).toBeUndefined();
  });
});

describe('automatic backup in Settings', () => {
  it('shows the recovery code first, and backs up only once it is confirmed saved', async () => {
    const server = standInServer();
    const user = userEvent.setup();
    await connectServer(KEY);
    await openSettings();

    await user.click(await screen.findByRole('button', { name: 'Turn on automatic backup' }));
    const code = (await screen.findByLabelText('Recovery code')).textContent!;
    expect(code).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    expect(server.snapshots).toBe(0);
    expect((await getBackupState()).on).toBe(false);

    await user.click(screen.getByRole('button', { name: 'I saved it. Turn on backup' }));
    expect(await screen.findByText(/Automatic backup is on\. First backup made/)).toBeInTheDocument();
    expect(server.snapshots).toBe(1);
    expect(await getBackupState()).toMatchObject({ on: true, recoveryCode: code });
    expect(screen.getByText(/An encrypted copy is kept on your own server/)).toBeInTheDocument();

    // The code can be shown again later.
    expect(screen.queryByLabelText('Recovery code')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show recovery code' }));
    expect(screen.getByLabelText('Recovery code')).toHaveTextContent(code);
  });

  it('shows why the last backup failed', async () => {
    const server = standInServer();
    const user = userEvent.setup();
    await connectServer(KEY);
    await openSettings();
    await user.click(await screen.findByRole('button', { name: 'Turn on automatic backup' }));
    await screen.findByLabelText('Recovery code');
    server.down = true;
    await user.click(screen.getByRole('button', { name: 'I saved it. Turn on backup' }));
    expect(await within(card('Automatic backup')).findByRole('alert')).toHaveTextContent('could not be reached');
    expect(await within(card('Automatic backup')).findByText(/Failed: The server could not be reached/)).toBeInTheDocument();
  });
});

describe('the evening reminder in Settings', () => {
  it('explains that alerts need the installed app when the browser has none', async () => {
    standInServer();
    await connectServer(KEY);
    await openSettings();
    await screen.findByRole('heading', { name: 'Evening reminder' });
    expect(within(card('Evening reminder')).getByText(/Alerts work only in the installed app/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on reminders' })).not.toBeInTheDocument();
  });
});

describe('erase', () => {
  it('erases the server too when the box is ticked', async () => {
    const server = standInServer();
    const user = userEvent.setup();
    await connectServer(KEY);
    await openSettings();
    expect(await screen.findByRole('checkbox', { name: /Also erase the server/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Erase everything' }));
    expect(screen.getByText(/on this phone and on your server/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, erase everything' }));
    expect(await screen.findByRole('heading', { name: 'Set up your wardrobe' })).toBeInTheDocument();
    expect(server.calls).toContain('DELETE /api/data');
    expect(await db.meta.count()).toBe(0);
  });

  it('erases only the phone when the box is unticked', async () => {
    const server = standInServer();
    const user = userEvent.setup();
    await connectServer(KEY);
    await openSettings();
    await user.click(await screen.findByRole('checkbox', { name: /Also erase the server/ }));
    await user.click(screen.getByRole('button', { name: 'Erase everything' }));
    await user.click(screen.getByRole('button', { name: 'Yes, erase everything' }));
    expect(await screen.findByRole('heading', { name: 'Set up your wardrobe' })).toBeInTheDocument();
    expect(server.calls).not.toContain('DELETE /api/data');
  });

  it('erases nothing when the server cannot be reached, and says how to go on', async () => {
    const server = standInServer();
    const user = userEvent.setup();
    await connectServer(KEY);
    await openSettings();
    await screen.findByRole('checkbox', { name: /Also erase the server/ });
    server.down = true;
    await user.click(screen.getByRole('button', { name: 'Erase everything' }));
    await user.click(screen.getByRole('button', { name: 'Yes, erase everything' }));
    expect(await within(card('Erase')).findByRole('alert')).toHaveTextContent('Nothing was erased');
    expect(await db.pieces.count()).toBe(5);
    expect(await getAppKey()).toBe(KEY);
  });
});

describe('the welcome screen', () => {
  it('offers to restore the automatic backup only where a server is running', async () => {
    standInServer();
    const user = userEvent.setup();
    const view = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Restore my automatic backup' }));
    expect(screen.getByLabelText('App key')).toBeInTheDocument();
    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore from the server' })).toBeDisabled();
    view.unmount();

    standInServer({ kind: 'files-only' });
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Set up your wardrobe' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore my automatic backup' })).not.toBeInTheDocument());
  });
});

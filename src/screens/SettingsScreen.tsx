import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { backupFileName, exportBackup } from '../data/backup';
import { db } from '../data/db';
import { getProfile } from '../data/profileRepo';
import { turnOffReminders } from '../data/reminders';
import { eraseServerData, getAppKey } from '../data/server';
import { getBackupState } from '../data/serverBackup';
import { eraseEverything, isInstalled, requestPersistentStorage, type StorageStatus } from '../data/setup';
import { Card, PageHeader } from '../ui/controls';
import { count, describeFile, useFileImport } from '../ui/useFileImport';
import { WeatherSetup } from '../ui/WeatherSetup';
import { AiCards } from './AiCards';
import { ServerCards } from './ServerCards';

const STORAGE_TEXT: Record<StorageStatus, string> = {
  protected: 'Protected. The browser has agreed not to clear this app\'s data on its own.',
  'not-protected': 'Not protected yet. The browser may clear this data if the phone runs low on space or the app goes unused. Keep a backup.',
  unknown: 'This browser does not say whether the data is protected. Keep a backup.',
};

/** Hands the backup to the share menu where that works (iPhone), or downloads it. */
async function saveFile(name: string, text: string): Promise<void> {
  const file = new File([text], name, { type: 'application/json' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      // Closing the share menu is not an error. Anything else falls back to a download.
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SettingsScreen() {
  const counts = useLiveQuery(async () => ({ pieces: await db.pieces.count(), photos: await db.photos.count() }), []);
  const profile = useLiveQuery(() => getProfile(), []);
  const [storage, setStorage] = useState<StorageStatus>();
  const [exportNote, setExportNote] = useState<string>();
  const [confirmingErase, setConfirmingErase] = useState(false);
  // Whether this phone is connected to the small server, and backing up to it.
  const server = useLiveQuery(async () => ({ connected: Boolean(await getAppKey()), backingUp: (await getBackupState()).on }), []);
  const [eraseServerToo, setEraseServerToo] = useState(true);
  const [eraseError, setEraseError] = useState<string>();
  const importer = useFileImport();
  const fileInput = useRef<HTMLInputElement>(null);
  const installed = isInstalled();

  useEffect(() => {
    let live = true;
    void requestPersistentStorage().then((status) => {
      if (live) setStorage(status);
    });
    return () => {
      live = false;
    };
  }, []);

  async function onExport() {
    setExportNote(undefined);
    try {
      const backup = await exportBackup();
      await saveFile(backupFileName(backup.exportedAt), JSON.stringify(backup));
      setExportNote(`Backup made with ${count(backup.pieces.length, 'piece')} and ${count(backup.photos.length, 'photo')}.`);
    } catch {
      setExportNote('The backup could not be made.');
    }
  }

  async function onErase() {
    setEraseError(undefined);
    if (server?.connected && eraseServerToo) {
      try {
        // The alert address first, while the server still knows this phone.
        await turnOffReminders().catch(() => undefined);
        await eraseServerData();
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'The server could not be reached.';
        setEraseError(`${reason} Nothing was erased. To erase only this phone, untick the box and try again.`);
        return;
      }
    }
    await eraseEverything();
  }

  return (
    <>
      <PageHeader
        eyebrow="This phone"
        title="Settings"
        sub={
          server?.backingUp
            ? 'Everything is stored on this phone. An encrypted copy is kept on your own server, which cannot read it.'
            : 'Everything is stored on this phone. There is no account and nothing is uploaded.'
        }
      />

      <Card title="Your data">
        <dl className="facts">
          <div>
            <dt>Stored here</dt>
            <dd>{counts ? `${count(counts.pieces, 'piece')}, ${count(counts.photos, 'photo')}` : ' '}</dd>
          </div>
          <div>
            <dt>Storage</dt>
            <dd>{storage ? STORAGE_TEXT[storage] : 'Checking'}</dd>
          </div>
          <div>
            <dt>Home Screen</dt>
            <dd>
              {installed
                ? 'Installed. You opened the app from the Home Screen.'
                : 'Open in a browser tab. On an iPhone, tap Share in Safari, then "Add to Home Screen". Data saved in the tab does not move over, so make a backup first and restore it in the installed app.'}
            </dd>
          </div>
        </dl>
      </Card>

      {profile && (
        <Card title="Weather">
          <WeatherSetup key={`${profile.home.point?.lat},${profile.home.point?.lon}`} profile={profile} />
        </Card>
      )}

      <ServerCards profile={profile} />

      <AiCards />

      <Card title="Back up to a file">
        <p className="hint">
          Saves your profile, pieces, clothing photos, color test results, day plans and outfit log to one file that you keep. Photos of you,
          such as the color test photos, are never included.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void onExport()}>
          Make a backup file
        </button>
        {exportNote && (
          <p className="notice" role="status">
            {exportNote}
          </p>
        )}
      </Card>

      <Card title="Load a file">
        <p className="hint">Restore a backup, or load a setup file with a new copy of your profile.</p>
        <button type="button" className="btn" disabled={importer.busy} onClick={() => fileInput.current?.click()}>
          Choose a file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="Choose a backup or setup file"
          onChange={(e) => {
            void importer.read(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {importer.pending && (
          <div className="notice">
            <p>{describeFile(importer.pending)}</p>
            <div className="row">
              <button type="button" className="btn btn-primary btn-small" disabled={importer.busy} onClick={() => void importer.confirm()}>
                {importer.pending.kind === 'setup' ? 'Load it' : 'Replace everything'}
              </button>
              <button type="button" className="btn btn-small" onClick={importer.cancel}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {importer.result && (
          <p className="notice" role="status">
            {importer.result.kind === 'setup'
              ? `Loaded. Profile replaced, ${count(importer.result.piecesAdded, 'piece')} added, ${importer.result.piecesKept} already here.`
              : `Restored ${count(importer.result.piecesAdded, 'piece')} and ${count(importer.result.photos, 'photo')}.`}
          </p>
        )}
        {importer.error && (
          <p className="notice notice-bad" role="alert">
            {importer.error}
          </p>
        )}
      </Card>

      <Card title="Erase">
        <p className="hint">Deletes your profile, every piece and every photo from this phone. A backup file you saved is not touched.</p>
        {server?.connected && (
          <label className="check">
            <input type="checkbox" checked={eraseServerToo} onChange={(e) => setEraseServerToo(e.target.checked)} />
            <span>Also erase the server: its encrypted backups and this phone's alert address</span>
          </label>
        )}
        {confirmingErase ? (
          <div className="notice notice-bad">
            <p>
              {server?.connected && eraseServerToo
                ? 'Erase everything on this phone and on your server? This cannot be undone.'
                : 'Erase everything on this phone? This cannot be undone.'}
            </p>
            <div className="row">
              <button type="button" className="btn btn-danger btn-small" onClick={() => void onErase()}>
                Yes, erase everything
              </button>
              <button type="button" className="btn btn-small" onClick={() => setConfirmingErase(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-quiet-danger" onClick={() => setConfirmingErase(true)}>
            Erase everything
          </button>
        )}
        {eraseError && (
          <p className="notice notice-bad" role="alert">
            {eraseError}
          </p>
        )}
      </Card>
    </>
  );
}

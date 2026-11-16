import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import {
  DEFAULT_REMINDER_HOUR,
  getReminderState,
  reminderSupport,
  sendTestAlert,
  setReminderHour,
  turnOffReminders,
  turnOnReminders,
} from '../data/reminders';
import { connectServer, disconnectServer, findServer, getAppKey, makeAppKey, type ServerKind } from '../data/server';
import { backupNow, getBackupState, prepareRecoveryCode, turnOffBackup, turnOnBackup } from '../data/serverBackup';
import type { Profile } from '../domain/types';
import { Card, Chips, TextField } from '../ui/controls';
import { count } from '../ui/useFileImport';
import { describeRestore, RestoreFromServer } from './RestoreFromServer';

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const NO_SERVER_TEXT: Partial<Record<ServerKind, string>> = {
  none: 'This address serves the app only. There is no server here, so automatic backup and reminders are not available.',
  'no-key':
    'The server is running but has no app key yet. In Cloudflare, open the wardrobe-builder Worker, then Settings, then Variables and Secrets, and add a secret named APP_KEY.',
  unreachable: 'The server could not be reached. Check your connection.',
};

/** Connect this phone to the server with the app key. */
function ConnectCard() {
  const [kind, setKind] = useState<ServerKind>();
  const [key, setKey] = useState('');
  const [made, setMade] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void findServer().then((found) => {
      if (live) setKind(found);
    });
    return () => {
      live = false;
    };
  }, []);

  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      await connectServer(key);
    } catch (e) {
      setError(message(e, 'The server could not be reached.'));
      setKind(await findServer());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Your server">
      <p className="hint">
        A small server on your own Cloudflare account keeps an encrypted backup and sends the evening reminder. It answers only requests that
        carry your app key.
      </p>
      {kind && kind !== 'ready' && <p className="notice">{NO_SERVER_TEXT[kind]}</p>}
      {kind !== 'none' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <TextField label="App key" hint="The value of the APP_KEY secret in Cloudflare." value={key} onChange={setKey} />
          {made && (
            <p className="notice">
              This is a new key. Save it in your password manager, then add it in Cloudflare as a secret named APP_KEY before you tap Connect.
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>
              Connect
            </button>
            {kind === 'no-key' && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const fresh = makeAppKey();
                  setKey(fresh);
                  setMade(true);
                  void copy(fresh);
                }}
              >
                Make a key for me
              </button>
            )}
          </div>
          {error && (
            <p className="notice notice-bad" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}

/** Automatic encrypted backup: turn on, see the last one, back up now, restore. */
function BackupCard() {
  const state = useLiveQuery(getBackupState, []);
  const [showCode, setShowCode] = useState(false);
  const [pendingCode, setPendingCode] = useState<string>();
  const [restoring, setRestoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  if (!state) return null;

  async function run(work: () => Promise<string | undefined>) {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      setNote(await work());
    } catch (e) {
      setError(message(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  }

  const backUp = () =>
    run(async () => {
      const result = await backupNow({ force: true });
      return `Backed up. ${count(result.photosUploaded, 'new photo')} uploaded.`;
    });

  if (!state.on) {
    return (
      <Card title="Automatic backup">
        <p className="hint">
          About once a day, when you open the app, it encrypts a copy of your profile, pieces and clothing photos on this phone and uploads it. The
          server stores a copy it cannot read. Photos of you are never uploaded.
        </p>
        {pendingCode ? (
          <div className="notice">
            <p>
              <strong>Save this recovery code now.</strong> It is the only thing that opens your backup. If you lose it, nobody can open the backup,
              including you.
            </p>
            <p className="code-block" aria-label="Recovery code">
              {pendingCode}
            </p>
            <div className="row">
              <button type="button" className="btn btn-small" onClick={() => void copy(pendingCode).then((ok) => setNote(ok ? 'Copied.' : 'Copying is not allowed here. Select the code and copy it by hand.'))}>
                Copy the code
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await turnOnBackup();
                    setPendingCode(undefined);
                    const result = await backupNow({ force: true });
                    return `Automatic backup is on. First backup made, with ${count(result.photosUploaded, 'photo')}.`;
                  })
                }
              >
                I saved it. Turn on backup
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void prepareRecoveryCode().then(setPendingCode)}>
              Turn on automatic backup
            </button>
            <button type="button" className="btn" onClick={() => setRestoring((v) => !v)}>
              Restore a backup
            </button>
          </div>
        )}
        {restoring && !pendingCode && (
          <RestoreFromServer
            askForAppKey={false}
            warning="Restoring replaces your profile, pieces and clothing photos on this phone with the backup."
            onCancel={() => setRestoring(false)}
            onDone={(result) => {
              setRestoring(false);
              setNote(describeRestore(result));
            }}
          />
        )}
        <Feedback note={note} error={error} />
      </Card>
    );
  }

  return (
    <Card title="Automatic backup">
      <dl className="facts">
        <div>
          <dt>Status</dt>
          <dd>On. A backup is made about once a day when you open the app, if anything changed.</dd>
        </div>
        <div>
          <dt>Last backup</dt>
          <dd>{state.lastAt ? when(state.lastAt) : 'Not yet'}</dd>
        </div>
        {state.lastError && (
          <div>
            <dt>Last try</dt>
            <dd>Failed: {state.lastError}</dd>
          </div>
        )}
      </dl>
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void backUp()}>
          Back up now
        </button>
        <button type="button" className="btn" onClick={() => setShowCode((v) => !v)}>
          {showCode ? 'Hide recovery code' : 'Show recovery code'}
        </button>
      </div>
      {showCode && state.recoveryCode && (
        <div className="notice">
          <p>Keep this somewhere safe, such as your password manager. A new phone needs it to open the backup.</p>
          <p className="code-block" aria-label="Recovery code">
            {state.recoveryCode}
          </p>
        </div>
      )}
      <Feedback note={note} error={error} />
      {restoring ? (
        <RestoreFromServer
          askForAppKey={false}
          knownCode={state.recoveryCode}
          warning="Restoring replaces your profile, pieces and clothing photos on this phone with the newest backup. Changes made since then are lost."
          onCancel={() => setRestoring(false)}
          onDone={(result) => {
            setRestoring(false);
            setNote(describeRestore(result));
          }}
        />
      ) : (
        <div className="row">
          <button type="button" className="link-btn" onClick={() => setRestoring(true)}>
            Restore the newest backup
          </button>
          <button type="button" className="link-btn link-danger" disabled={busy} onClick={() => void run(async () => (await turnOffBackup(), 'Automatic backup is off. Backups already on the server stay there.'))}>
            Turn off
          </button>
        </div>
      )}
    </Card>
  );
}

const HOURS = [18, 19, 20, 21, 22].map((hour) => ({ value: hour, label: `${hour - 12} pm` }));
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The evenings an alert is sent: the day before each office day. */
function eveningsBefore(officeDays: number[]): string {
  const days = [...new Set(officeDays.map((day) => (day + 6) % 7))].sort().map((day) => DAY_NAMES[day]!);
  if (days.length <= 1) return days[0] ?? '';
  return `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`;
}

/** The evening reminder: turn on, pick the hour, send a test alert. */
function ReminderCard({ profile }: { profile: Profile }) {
  const state = useLiveQuery(getReminderState, []);
  const [hour, setHour] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const support = reminderSupport();
  const officeDays = profile.week.officeDays;
  const hasPlace = Boolean((profile.home as { point?: unknown }).point);

  if (!state) return null;
  const chosenHour = hour ?? state.hour ?? DEFAULT_REMINDER_HOUR;

  async function run(work: () => Promise<string | undefined>) {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      setNote(await work());
    } catch (e) {
      setError(message(e, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Evening reminder">
      <p className="hint">
        On the evening before an office day the server sends one alert with the next morning's forecast. Tap it and the app picks the outfit on this
        phone. The server never sees your wardrobe.
      </p>
      {support === 'not-installed' && (
        <p className="notice">Alerts work only in the installed app. In Safari, tap Share, then "Add to Home Screen", and open the app from its icon.</p>
      )}
      {support === 'unsupported' && <p className="notice">This phone or browser cannot receive alerts from a web app. An iPhone needs iOS 16.4 or later.</p>}
      {support === 'ok' && officeDays.length === 0 && <p className="notice">Add your office days in Profile first. The reminder goes out the evening before each one.</p>}
      {support === 'ok' && officeDays.length > 0 && (
        <>
          <Chips
            label="Send it at"
            options={HOURS}
            value={chosenHour}
            allowClear={false}
            onChange={(value) => {
              if (value === undefined) return;
              setHour(value);
              if (state.on) void run(async () => (await setReminderHour(value), `Changed to ${value - 12} pm.`));
            }}
          />
          <dl className="facts">
            <div>
              <dt>Status</dt>
              <dd>{state.on ? `On. ${eveningsBefore(officeDays)} at ${chosenHour - 12} pm.` : 'Off'}</dd>
            </div>
            <div>
              <dt>Forecast</dt>
              <dd>{hasPlace ? 'Included, for the forecast place in your profile.' : 'Not included. No forecast place is set in your profile yet.'}</dd>
            </div>
          </dl>
          <div className="row">
            {state.on ? (
              <>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => (await sendTestAlert(), 'Sent. It should arrive within a minute.'))}>
                  Send a test alert
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => (await turnOffReminders(), 'Reminders are off.'))}>
                  Turn off
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void run(async () => (await turnOnReminders(chosenHour), 'Reminders are on. Send a test alert to check that they arrive.'))}
              >
                Turn on reminders
              </button>
            )}
          </div>
        </>
      )}
      <Feedback note={note} error={error} />
    </Card>
  );
}

function Feedback({ note, error }: { note?: string; error?: string }) {
  return (
    <>
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** The Settings cards for the small server: connect, backup, reminders. */
export function ServerCards({ profile }: { profile: Profile | undefined }) {
  const connection = useLiveQuery(async () => ({ key: await getAppKey() }), []);
  if (!connection) return null;
  if (!connection.key) return <ConnectCard />;
  return (
    <>
      <BackupCard />
      {profile && <ReminderCard profile={profile} />}
      <Card title="Your server">
        <p className="hint">This phone is connected to your server.</p>
        <button type="button" className="link-btn" onClick={() => void disconnectServer()}>
          Disconnect this phone
        </button>
      </Card>
    </>
  );
}

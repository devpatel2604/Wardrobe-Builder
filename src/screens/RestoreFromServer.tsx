import { useState } from 'react';
import { restoreFromServer, type RestoreResult } from '../data/serverBackup';
import { TextField } from '../ui/controls';
import { count } from '../ui/useFileImport';

interface Props {
  /** True on a new phone, where the app key has to be typed in as well. */
  askForAppKey: boolean;
  /** Filled in when this phone already knows its recovery code. */
  knownCode?: string;
  /** Shown above the button when restoring will replace data already here. */
  warning?: string;
  onDone?: (result: RestoreResult) => void;
  onCancel?: () => void;
}

/** Brings back the newest backup from the server. */
export function RestoreFromServer({ askForAppKey, knownCode, warning, onDone, onCancel }: Props) {
  const [appKey, setAppKey] = useState('');
  const [code, setCode] = useState(knownCode ?? '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();

  async function restore() {
    setBusy(true);
    setError(undefined);
    setProgress('Fetching your backup');
    try {
      const result = await restoreFromServer({
        appKey: askForAppKey ? appKey : undefined,
        recoveryCode: code,
        onProgress: (done, total) => setProgress(total ? `Fetching photos, ${done} of ${total}` : 'Fetching your backup'),
      });
      onDone?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The backup could not be restored.');
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void restore();
      }}
    >
      {askForAppKey && <TextField label="App key" hint="The key you saved in Cloudflare as APP_KEY." value={appKey} onChange={setAppKey} />}
      <TextField
        label="Recovery code"
        hint="The 52 letters and numbers you saved when you turned on automatic backup. Dashes and capitals do not matter."
        value={code}
        onChange={setCode}
      />
      {warning && <p className="notice notice-bad">{warning}</p>}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim() || (askForAppKey && !appKey.trim())}>
          Restore from the server
        </button>
        {onCancel && (
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {progress && (
        <p className="notice" role="status">
          {progress}
        </p>
      )}
      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function describeRestore(result: RestoreResult): string {
  const date = new Date(result.madeAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `Restored the backup from ${date}: ${count(result.pieces, 'piece')} and ${count(result.photos, 'photo')}.`;
}

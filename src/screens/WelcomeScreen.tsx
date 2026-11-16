import { useRef } from 'react';
import { startEmpty } from '../data/setup';
import { useFileImport } from '../ui/useFileImport';

/** First run, and after an erase: the app holds nothing yet. */
export function WelcomeScreen() {
  const input = useRef<HTMLInputElement>(null);
  const importer = useFileImport();

  return (
    <div className="app">
      <main className="screen welcome">
        <p className="eyebrow">Wardrobe Builder</p>
        <h1>Set up your wardrobe</h1>
        <p className="sub">
          This app keeps everything on this phone. Nothing is loaded yet. Load your setup file to bring in your profile,
          your rules and the pieces you own, or start with an empty profile and fill it in by hand.
        </p>

        <div className="stack">
          <button type="button" className="btn btn-primary" disabled={importer.busy} onClick={() => input.current?.click()}>
            Load a setup file or backup
          </button>
          <input
            ref={input}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            aria-label="Choose a setup file or backup"
            onChange={async (e) => {
              const parsed = await importer.read(e.target.files?.[0]);
              e.target.value = '';
              // Nothing is on the phone yet, so there is nothing to confirm.
              // A file without a profile still gets the app started, with a blank one.
              if (parsed && (await importer.confirm(parsed))) await startEmpty();
            }}
          />
          <button type="button" className="btn" onClick={() => void startEmpty()}>
            Start with an empty profile
          </button>
        </div>

        {importer.error && (
          <p className="notice notice-bad" role="alert">
            {importer.error}
          </p>
        )}
      </main>
    </div>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { colorTestPromptDismissed, dismissColorTestPrompt, getColorTest } from '../../data/colorTestRepo';

/** The way into the color test from the profile's Colors card. The words follow how far the test has got. */
export function ColorTestLink() {
  const loaded = useLiveQuery(async () => ({ test: await getColorTest() }), []);
  if (!loaded) return null;
  const { test } = loaded;
  const label = !test ? 'Take the color photo test' : test.applied ? 'Open the color photo test' : 'Continue the color photo test';
  return (
    <Link className={test?.applied ? 'btn' : 'btn btn-primary'} to="/color-test">
      {label}
    </Link>
  );
}

/** A nudge on the wardrobe screen until the test has been started or waved off. */
export function ColorTestPrompt() {
  const loaded = useLiveQuery(async () => ({ test: await getColorTest(), dismissed: await colorTestPromptDismissed() }), []);
  if (!loaded || loaded.test || loaded.dismissed) return null;
  return (
    <section className="card prompt-card" aria-label="Color photo test">
      <div>
        <h3>Next: find your colors</h3>
        <p className="muted">A ten-minute photo test replaces the stylists' guesses in your palette with your own ranking.</p>
      </div>
      <div className="row">
        <Link className="btn btn-primary btn-small" to="/color-test">
          Start the color test
        </Link>
        <button type="button" className="btn btn-small" onClick={() => void dismissColorTestPrompt()}>
          Not now
        </button>
      </div>
    </section>
  );
}

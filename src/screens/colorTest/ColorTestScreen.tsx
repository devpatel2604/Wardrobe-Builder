import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteColorTestPhotos, resetColorTest, setTestColors } from '../../data/colorTestRepo';
import { listPieces } from '../../data/piecesRepo';
import { getProfile } from '../../data/profileRepo';
import {
  ALL_TEST_COLORS,
  captureSpanMinutes,
  MAX_CAPTURE_SPAN_MINUTES,
  openTestColors,
  rankColors,
  recommendedPicks,
  STANDARD_TEST_COLORS,
  testColorLabel,
  totalPairs,
  type ColorTest,
  type TestColor,
} from '../../domain/colorTest';
import type { Photo, Piece, Rule } from '../../domain/types';
import { Card, PageHeader } from '../../ui/controls';
import { ShotImage, shortDate, shotColors, Swatch, useColorTestData } from './shared';

const STEPS = [
  'Take one photo for each color, with the color held under your chin.',
  'The app shows two photos at a time. You tap the one where your face looks better.',
  'Your picks become a ranking. You decide what goes into your palette.',
];

const SETUP_TIPS = [
  'Stand facing a window in daylight, out of direct sun. Turn off lamps near you.',
  'Wear what is on your face every day, such as glasses.',
  'Wear a plain top. Hold each color flat under your chin so it covers the top.',
  'Keep the same spot and the same pose for every photo.',
  'Take all the photos in one go. Daylight changes within the hour.',
  'Prop the phone at eye level, or hold it at arm\'s length. No flash.',
];

/** The pieces the owner has in each color, as a hint for what to hold up. */
function ownedByColor(pieces: Piece[]): Map<TestColor, string[]> {
  const found = new Map<TestColor, string[]>();
  for (const piece of pieces) {
    if (piece.status !== 'owned' || !piece.colorFamily || piece.colorFamily === 'other') continue;
    found.set(piece.colorFamily, [...(found.get(piece.colorFamily) ?? []), piece.name]);
  }
  return found;
}

export function ColorTestScreen() {
  const data = useColorTestData();
  const loaded = useLiveQuery(async () => ({ pieces: await listPieces(), rules: (await getProfile())?.rules ?? [] }), []);
  const [choosing, setChoosing] = useState(false);

  if (!data || !loaded) return <div aria-busy="true" />;
  const { test, photos } = data;

  return (
    <>
      <Link className="back" to="/profile">
        ‹ Profile
      </Link>
      <PageHeader
        eyebrow="Colors near your face"
        title="Color photo test"
        sub="Find out which colors suit your face from your own photos, not from a chart. About ten minutes."
      />
      {!test || choosing ? (
        <Setup test={test} pieces={loaded.pieces} rules={loaded.rules} onDone={() => setChoosing(false)} />
      ) : (
        <Progress test={test} photos={photos} onChangeColors={() => setChoosing(true)} />
      )}
    </>
  );
}

function Setup({ test, pieces, rules, onDone }: { test: ColorTest | undefined; pieces: Piece[]; rules: Rule[]; onDone: () => void }) {
  const navigate = useNavigate();
  // Colors the profile's open tests ask about are turned on too, even outside the standard twelve.
  const extras = openTestColors(rules).filter((c) => !STANDARD_TEST_COLORS.includes(c));
  const [chosen, setChosen] = useState<TestColor[]>(test?.colors ?? [...STANDARD_TEST_COLORS, ...extras]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const owned = ownedByColor(pieces);
  const ownedHints = ALL_TEST_COLORS.filter((c) => owned.has(c));
  const dropsPhotos = test ? test.shots.filter((s) => !chosen.includes(s.color)).length : 0;

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      // Keep the capture order steady: the standard order, whatever order the chips were tapped in.
      const ordered = ALL_TEST_COLORS.filter((c) => chosen.includes(c));
      const saved = await setTestColors(ordered);
      if (test) return onDone();
      navigate(`/color-test/capture/${saved.colors[0]}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The colors could not be saved.');
      setSaving(false);
    }
  }

  return (
    <>
      {!test && (
        <>
          <Card title="How it works">
            <ol className="steps">
              {STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Card>
          <Card title="Before you start">
            <ul className="tips">
              {SETUP_TIPS.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Card title="Colors to test">
        <p className="hint">
          Anything in the color works: a tee, a towel, a knit, even trousers. Turn off a color you have nothing for. The first twelve are the
          ones worth testing first.
          {!test && extras.length > 0 && ` ${extras.map(testColorLabel).join(' and ')} ${extras.length === 1 ? 'is' : 'are'} on as well, because an open test in your profile asks about ${extras.length === 1 ? 'it' : 'them'}.`}
        </p>
        <div className="chips" role="group" aria-label="Colors to test">
          {ALL_TEST_COLORS.map((color) => {
            const on = chosen.includes(color);
            return (
              <button
                key={color}
                type="button"
                className={on ? 'chip chip-on' : 'chip'}
                aria-pressed={on}
                onClick={() => setChosen(on ? chosen.filter((c) => c !== color) : [...chosen, color])}
              >
                <Swatch color={color} />
                {testColorLabel(color)}
              </button>
            );
          })}
        </div>
        <p className="hint" role="status">
          {chosen.length} {chosen.length === 1 ? 'color' : 'colors'} chosen.
        </p>
        {ownedHints.length > 0 && (
          <div className="owned-hints">
            <h3>In your wardrobe</h3>
            <ul className="plain-list">
              {ownedHints.map((color) => (
                <li key={color} className="muted">
                  <strong>{testColorLabel(color)}:</strong> {owned.get(color)!.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <p className="hint privacy-note">
        The photos stay on this phone. They are never part of a backup, and you can delete them when the test is done.
      </p>

      {dropsPhotos > 0 && (
        <p className="notice" role="status">
          {dropsPhotos === 1 ? 'One photo belongs' : `${dropsPhotos} photos belong`} to a color you turned off. Saving deletes{' '}
          {dropsPhotos === 1 ? 'it' : 'them'} and the picks made with {dropsPhotos === 1 ? 'it' : 'them'}.
        </p>
      )}
      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}
      <div className="form-foot stack">
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
          {test ? 'Save the colors' : 'Start the test'}
        </button>
        {test && (
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </>
  );
}

function Progress({ test, photos, onChangeColors }: { test: ColorTest; photos: Map<TestColor, Photo>; onChangeColors: () => void }) {
  const [confirming, setConfirming] = useState<'photos' | 'reset'>();
  const ranked = shotColors(test);
  const comparable = ranked.filter((c) => photos.has(c));
  const nextToShoot = test.colors.find((c) => !ranked.includes(c));
  const standings = rankColors(ranked, test.picks);
  const picksDone = standings.reduce((sum, s) => sum + s.games, 0) / 2;
  const target = recommendedPicks(ranked.length);
  const pairsLeft = totalPairs(ranked.length) - picksDone;
  const span = captureSpanMinutes(test.shots);
  const photosOnPhone = photos.size;

  return (
    <>
      <Card title="1 · Photos">
        <p>
          <strong>
            {ranked.length} of {test.colors.length}
          </strong>{' '}
          colors photographed.
        </p>
        <ul className="shot-grid">
          {test.colors.map((color) => {
            const taken = ranked.includes(color);
            return (
              <li key={color}>
                <Link
                  to={`/color-test/capture/${color}`}
                  className="shot-tile"
                  aria-label={`${testColorLabel(color)}: ${taken ? 'retake the photo' : 'take the photo'}`}
                >
                  {taken ? (
                    <ShotImage color={color} photo={photos.get(color)} className="shot-thumb" />
                  ) : (
                    <span className="shot-thumb shot-todo">
                      <Swatch color={color} className="shot-todo-dot" />
                    </span>
                  )}
                  <span className="shot-name">{testColorLabel(color)}</span>
                  <span className="muted">{taken ? (photos.has(color) ? 'Retake' : 'Photo deleted') : 'Take photo'}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        {span > MAX_CAPTURE_SPAN_MINUTES && (
          <p className="notice" role="status">
            These photos were taken over {span >= 120 ? `${Math.round(span / 60)} hours` : `${span} minutes`}. Daylight shifts in that time, so the
            comparison may be unfair. For a clean result, retake them in one go.
          </p>
        )}
        {nextToShoot ? (
          <Link className="btn btn-primary" to={`/color-test/capture/${nextToShoot}`}>
            {ranked.length === 0 ? 'Take the first photo' : `Next photo: ${testColorLabel(nextToShoot)}`}
          </Link>
        ) : (
          <p className="hint">Every color has a photo. Tap one to retake it.</p>
        )}
      </Card>

      <Card title="2 · Compare">
        {comparable.length < 2 ? (
          <p className="hint">
            {ranked.length >= 2 ? 'The photos are no longer on this phone, so there is nothing to compare. Retake them to go on.' : 'Take at least two photos, then compare them two at a time.'}
          </p>
        ) : (
          <>
            <p>
              <strong>
                {picksDone} of about {target}
              </strong>{' '}
              picks made.
              {picksDone >= target && pairsLeft > 0 && ' That is enough for a solid ranking. More picks sharpen it.'}
              {pairsLeft === 0 && ' Every pair has been compared.'}
            </p>
            <div className="meter" role="progressbar" aria-label="Picks made" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(picksDone, target)}>
              <span style={{ width: `${Math.min(100, (picksDone / Math.max(1, target)) * 100)}%` }} />
            </div>
            {pairsLeft > 0 && (
              <Link className={picksDone >= target || nextToShoot ? 'btn' : 'btn btn-primary'} to="/color-test/compare">
                {picksDone === 0 ? 'Start comparing' : 'Keep comparing'}
              </Link>
            )}
          </>
        )}
      </Card>

      <Card title="3 · Results">
        {picksDone === 0 ? (
          <p className="hint">Your ranking appears here after the first picks.</p>
        ) : (
          <>
            <ol className="top-list">
              {standings.slice(0, 3).map((s) => (
                <li key={s.color}>
                  <Swatch color={s.color} /> {testColorLabel(s.color)}
                </li>
              ))}
            </ol>
            {test.applied ? (
              <p className="hint">Saved to your palette on {shortDate(test.applied.appliedAt)}.</p>
            ) : (
              <p className="hint">Not in your palette yet. Check the ranking, then save it.</p>
            )}
            <Link className={picksDone >= target && !test.applied ? 'btn btn-primary' : 'btn'} to="/color-test/results">
              See your ranking
            </Link>
          </>
        )}
      </Card>

      <Card title="Manage">
        <button type="button" className="link-btn" onClick={onChangeColors}>
          Change the colors
        </button>
        {confirming === 'photos' ? (
          <div className="notice">
            <p>Delete the {photosOnPhone === 1 ? 'photo' : `${photosOnPhone} photos`} of you? Your picks, your ranking and your palette stay. You cannot compare any further without retaking them.</p>
            <div className="row">
              <button type="button" className="btn btn-danger btn-small" onClick={() => void deleteColorTestPhotos().then(() => setConfirming(undefined))}>
                Yes, delete the photos
              </button>
              <button type="button" className="btn btn-small" onClick={() => setConfirming(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          photosOnPhone > 0 && (
            <button type="button" className="link-btn" onClick={() => setConfirming('photos')}>
              Delete the photos, keep the results
            </button>
          )
        )}
        {confirming === 'reset' ? (
          <div className="notice notice-bad">
            <p>
              Start over? This deletes the photos, the picks and the ranking.
              {test.applied && ' The palette you saved stays, but it can no longer be undone from here.'}
            </p>
            <div className="row">
              <button type="button" className="btn btn-danger btn-small" onClick={() => void resetColorTest()}>
                Yes, start over
              </button>
              <button type="button" className="btn btn-small" onClick={() => setConfirming(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="link-btn link-danger" onClick={() => setConfirming('reset')}>
            Start over
          </button>
        )}
      </Card>
    </>
  );
}

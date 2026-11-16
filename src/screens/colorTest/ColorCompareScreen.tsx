import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { addPick, undoLastPick } from '../../data/colorTestRepo';
import { nextPair, rankColors, recommendedPicks, testColorLabel, totalPairs, type ColorTest, type TestColor } from '../../domain/colorTest';
import type { Photo } from '../../domain/types';
import { ShotImage, shotColors, Swatch, useColorTestData } from './shared';

export function ColorCompareScreen() {
  const data = useColorTestData();
  if (!data) return <div aria-busy="true" />;
  if (!data.test) return <Navigate to="/color-test" replace />;
  return <Compare test={data.test} photos={data.photos} />;
}

function Compare({ test, photos }: { test: ColorTest; photos: Map<TestColor, Photo> }) {
  const [big, setBig] = useState(false);
  const [busy, setBusy] = useState(false);
  const ranked = shotColors(test);
  // Only colors whose photo is on this phone can be shown, so only they get new picks.
  const comparable = ranked.filter((c) => photos.has(c));
  const picksDone = rankColors(ranked, test.picks).reduce((sum, s) => sum + s.games, 0) / 2;
  const target = recommendedPicks(ranked.length);
  const pair = nextPair(comparable, test.picks);
  const enough = picksDone >= target;

  async function pick(winner: TestColor | 'same') {
    if (!pair || busy) return;
    setBusy(true);
    try {
      await addPick(pair.left, pair.right, winner);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="detail-top">
        <Link className="back" to="/color-test">
          ‹ Color test
        </Link>
        <p className="muted" role="status">
          {pair ? (enough ? `${picksDone} picks made, ${totalPairs(ranked.length) - picksDone} pairs left` : `Pick ${picksDone + 1} of about ${target}`) : `${picksDone} picks made`}
        </p>
      </div>

      <div className="meter" role="progressbar" aria-label="Picks made" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(picksDone, target)}>
        <span style={{ width: `${Math.min(100, (picksDone / Math.max(1, target)) * 100)}%` }} />
      </div>

      {enough && (
        <div className="notice" role="status">
          <p>{pair ? 'That is enough for a solid ranking. Keep going if you want to sharpen it.' : 'Every pair has been compared.'}</p>
          <Link className="btn btn-primary btn-small" to="/color-test/results">
            See your ranking
          </Link>
        </div>
      )}

      {pair ? (
        <>
          <header>
            <h1 className="compare-title">Which is better for your face?</h1>
            <p className="sub">Look at your face first, not the cloth. Pick the photo where your skin looks clearer and your eyes stand out.</p>
          </header>

          <div className={big ? 'compare compare-big' : 'compare'}>
            {[pair.left, pair.right].map((color) => (
              <button key={color} type="button" className="compare-choice" disabled={busy} onClick={() => void pick(color)} aria-label={`Pick ${testColorLabel(color)}`}>
                <ShotImage color={color} photo={photos.get(color)} full className="compare-photo" />
                <span className="compare-name">
                  <Swatch color={color} /> {testColorLabel(color)}
                </span>
              </button>
            ))}
          </div>

          <button type="button" className="btn" disabled={busy} onClick={() => void pick('same')}>
            About the same
          </button>
          <div className="row compare-tools">
            <button type="button" className="link-btn" disabled={busy || test.picks.length === 0} onClick={() => void undoLastPick()}>
              Undo the last pick
            </button>
            <button type="button" className="link-btn" aria-pressed={big} onClick={() => setBig(!big)}>
              {big ? 'Side by side' : 'Bigger photos'}
            </button>
          </div>
        </>
      ) : (
        !enough && (
          <p className="empty">
            {comparable.length < 2 ? 'There are not two photos on this phone to compare. Take more photos first.' : 'Every pair you can compare has been compared.'}
          </p>
        )
      )}
      {!pair && test.picks.length > 0 && (
        <button type="button" className="link-btn" onClick={() => void undoLastPick()}>
          Undo the last pick
        </button>
      )}
    </>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { applyColorTest, undoApplyColorTest } from '../../data/colorTestRepo';
import { getProfile } from '../../data/profileRepo';
import {
  rankColors,
  recommendedPicks,
  rulesAnsweredBy,
  testColorLabel,
  testedColors,
  VERDICTS,
  type ColorTest,
  type TestColor,
} from '../../domain/colorTest';
import type { NearFaceVerdict, Photo, Rule } from '../../domain/types';
import { Card, PageHeader } from '../../ui/controls';
import { ShotImage, shortDate, shotColors, useColorTestData } from './shared';

export function ColorResultsScreen() {
  const data = useColorTestData();
  const loaded = useLiveQuery(async () => ({ profile: await getProfile() }), []);
  if (!data || !loaded) return <div aria-busy="true" />;
  if (!data.test) return <Navigate to="/color-test" replace />;
  return <Results test={data.test} photos={data.photos} rules={loaded.profile?.rules ?? []} />;
}

function record(wins: number, losses: number, ties: number): string {
  const parts = [`Won ${wins}`, `lost ${losses}`];
  if (ties > 0) parts.push(`same ${ties}`);
  return parts.join(', ');
}

function Results({ test, photos, rules }: { test: ColorTest; photos: Map<TestColor, Photo>; rules: Rule[] }) {
  const ranked = shotColors(test);
  const standings = rankColors(ranked, test.picks);
  const picksDone = standings.reduce((sum, s) => sum + s.games, 0) / 2;
  const target = recommendedPicks(ranked.length);

  // Verdicts the owner set. They start from what was saved last time, if anything was.
  const [chosen, setChosen] = useState<Partial<Record<TestColor, NearFaceVerdict>>>(() =>
    Object.fromEntries((test.applied?.results ?? []).map((r) => [r.color, r.verdict])),
  );
  const results = testedColors(standings, chosen);

  const openTests = rules.filter((r) => r.kind === 'open-test');
  const suggested = rulesAnsweredBy(rules, ranked).map((r) => r.id);
  const [answered, setAnswered] = useState<string[]>();
  const ticked = answered ?? suggested;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [justSaved, setJustSaved] = useState(false);

  const saved = test.applied?.results;
  const unchanged =
    saved !== undefined &&
    saved.length === results.length &&
    saved.every((s, i) => s.color === results[i]!.color && s.verdict === results[i]!.verdict && s.rank === results[i]!.rank);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await applyColorTest(results, ticked);
      setAnswered(undefined);
      setJustSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The palette could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setBusy(true);
    try {
      await undoApplyColorTest();
      setJustSaved(false);
    } finally {
      setBusy(false);
    }
  }

  if (picksDone === 0) {
    return (
      <>
        <Link className="back" to="/color-test">
          ‹ Color test
        </Link>
        <p className="empty">There is no ranking yet. Compare a few photos first.</p>
      </>
    );
  }

  return (
    <>
      <Link className="back" to="/color-test">
        ‹ Color test
      </Link>
      <PageHeader
        eyebrow="Your own picks"
        title="Your colors, ranked"
        sub={`From ${picksDone} ${picksDone === 1 ? 'pick' : 'picks'} between ${ranked.length} colors. The order comes from your picks. Where each color lands is your call, so change any of them before you save.`}
      />

      {picksDone < target && (
        <div className="notice" role="status">
          <p>
            This is an early read. About {target - picksDone} more {target - picksDone === 1 ? 'pick' : 'picks'} would firm it up.
          </p>
          <Link className="btn btn-small" to="/color-test/compare">
            Keep comparing
          </Link>
        </div>
      )}

      <p className="hint ranking-key">
        For each color near your face: <strong>Best</strong> would beat an average color in your test two times in three,{' '}
        <strong>Not near face</strong> would lose two times in three, and <strong>Fine</strong> is everything between.
      </p>

      <ol className="ranking">
        {results.map((r) => (
          <li key={r.color} className="ranking-row">
            <span className="ranking-place">{r.rank}</span>
            <ShotImage color={r.color} photo={photos.get(r.color)} className="ranking-thumb" />
            <div className="ranking-body">
              <p>
                <strong>{testColorLabel(r.color)}</strong> <span className="muted">{record(r.wins, r.losses, r.ties)}</span>
              </p>
              <div className="chips" role="group" aria-label={`${testColorLabel(r.color)} near your face`}>
                {VERDICTS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    className={r.verdict === v.value ? `chip chip-small chip-on verdict-${v.value}` : 'chip chip-small'}
                    aria-pressed={r.verdict === v.value}
                    onClick={() => {
                      setChosen({ ...chosen, [r.color]: v.value });
                      setJustSaved(false);
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {openTests.length > 0 && (
        <Card title="Open tests this answers">
          <p className="hint">Tick the open tests in your profile that this settles. They leave the list when you save, and the answer lives in your palette.</p>
          {openTests.map((rule) => (
            <label key={rule.id} className="check">
              <input
                type="checkbox"
                checked={ticked.includes(rule.id)}
                onChange={(e) => {
                  setAnswered(e.target.checked ? [...ticked, rule.id] : ticked.filter((id) => id !== rule.id));
                  setJustSaved(false);
                }}
              />
              <span>{rule.text}</span>
            </label>
          ))}
        </Card>
      )}

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      {test.applied && (
        <div className="notice" role="status">
          <p>
            {justSaved ? 'Saved. ' : ''}These results are in your palette since {shortDate(test.applied.appliedAt)}. Tested colors now lead it, marked "Your test".
          </p>
          <div className="row">
            <Link className="btn btn-small" to="/profile">
              See your palette
            </Link>
            <button type="button" className="btn btn-small" disabled={busy} onClick={() => void undo()}>
              Undo, put the old palette back
            </button>
          </div>
        </div>
      )}

      <div className="form-foot">
        <button type="button" className="btn btn-primary" disabled={busy || (unchanged && ticked.length === 0)} onClick={() => void save()}>
          {test.applied ? 'Save the changes to my palette' : 'Save to my palette'}
        </button>
      </div>

      <Card title="How much to trust this">
        <p className="hint">
          This is your own eye, in one light, on one day. That is a fair signal, and a better one than a chart: published color advice is mostly
          stylists' convention and was tested on very few people. Something always comes last in a ranking, so last does not have to mean bad. If
          a result surprises you, retake those photos in different daylight and compare again.
        </p>
      </Card>
    </>
  );
}

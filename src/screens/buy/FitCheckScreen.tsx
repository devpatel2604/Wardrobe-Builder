import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { saveFitCheck } from '../../data/wishlistRepo';
import { VERDICT_LABELS, fitChecksFor, suggestVerdict, type FitAnswer, type FitCheckId, type FitCheckItem, type FitVerdict } from '../../domain/buyNext/fitCheck';
import { paperPiece } from '../../domain/buyNext/paper';
import type { WishItem } from '../../domain/buyNext/types';
import { daysBetween, monthDay } from '../../domain/buyNext/wishes';
import { now } from '../../domain/clock';
import { dateKey } from '../../domain/dates';
import type { Option } from '../../domain/options';
import { isCoat } from '../../domain/outfits/traits';
import { Card, Chips, TextField } from '../../ui/controls';
import { useBuyData } from './buyData';

const VERDICTS: Option<FitVerdict>[] = (Object.keys(VERDICT_LABELS) as FitVerdict[]).map((value) => ({ value, label: VERDICT_LABELS[value] }));

function answersFor(check: FitCheckItem): Option<FitAnswer>[] {
  return [
    { value: 'pass', label: 'Yes' },
    ...(check.tailorable ? [{ value: 'fixable' as const, label: 'A tailor can fix it' }] : []),
    { value: 'fail', label: 'No' },
  ];
}

function FitCheckForm({ item }: { item: WishItem }) {
  const navigate = useNavigate();
  const today = dateKey(now());
  const checks = fitChecksFor(item.spec.slots, isCoat(paperPiece(item)));
  const [answers, setAnswers] = useState<Partial<Record<FitCheckId, FitAnswer>>>({});
  const [chosen, setChosen] = useState<FitVerdict>();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const answered = checks.filter((c) => answers[c.id] !== undefined).length;
  const suggested = answered === checks.length ? suggestVerdict(answers) : undefined;
  const verdict = chosen ?? suggested;
  const returnBy = item.bought?.returnBy;
  const daysLeft = returnBy ? daysBetween(today, returnBy) : undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!verdict) return setError('Answer each check, or pick keep, tailor or return yourself.');
    setSaving(true);
    try {
      await saveFitCheck(item.id, { on: today, answers, verdict, note: note.trim() || undefined });
      navigate(verdict === 'return' || !item.pieceId ? '/buy' : `/wardrobe/${item.pieceId}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The fit check could not be saved.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <Link className="back" to={`/buy/${item.id}`}>
        ‹ {item.name}
      </Link>
      <header className="page-head">
        <div>
          <p className="eyebrow">Fit check</p>
          <h1>{item.name}</h1>
          <p className="sub">
            A minute in front of the mirror, with the piece on.
            {returnBy
              ? daysLeft !== undefined && daysLeft < 0
                ? ` The return window closed on ${monthDay(returnBy, today)}.`
                : ` It can go back until ${monthDay(returnBy, today)}${daysLeft !== undefined ? ` (${daysLeft === 0 ? 'today' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`})` : ''}.`
              : ''}
          </p>
        </div>
      </header>

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      <Card>
        {checks.map((check) => (
          <div key={check.id} className="fit-check">
            <Chips
              label={check.label}
              hint={check.pass}
              options={answersFor(check)}
              value={answers[check.id]}
              onChange={(v) => setAnswers((a) => ({ ...a, [check.id]: v }))}
            />
            {answers[check.id] === 'fail' && <p className="muted">{check.failNote}</p>}
          </div>
        ))}
      </Card>

      <Card title="Keep, tailor or return">
        {suggested && (
          <p role="status">
            Your answers point to: <strong>{VERDICT_LABELS[suggested].toLowerCase()}</strong>.
          </p>
        )}
        <Chips label="Your call" options={VERDICTS} value={verdict} allowClear={false} onChange={(v) => setChosen(v)} />
        {verdict === 'return' && <p className="hint">The piece leaves your wardrobe and goes back on the Buy next list, with a note on the product you sent back.</p>}
        <TextField label="Note" value={note} onChange={setNote} placeholder="Sleeves an inch long" />
      </Card>

      <div className="form-foot">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving' : 'Save the fit check'}
        </button>
      </div>
    </form>
  );
}

export function FitCheckScreen() {
  const { id = '' } = useParams();
  const data = useBuyData();
  if (!data) return <div aria-busy="true" />;
  const item = data.wishes.find((w) => w.id === id);
  if (!item || item.state !== 'bought') {
    return (
      <>
        <Link className="back" to="/buy">
          ‹ Buy next
        </Link>
        <p className="empty">The fit check is for a piece you have bought. Tap "Bought it" on the piece first.</p>
      </>
    );
  }
  return <FitCheckForm item={item} />;
}

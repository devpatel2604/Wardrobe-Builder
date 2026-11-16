import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createLook, listLooks, lookCovers } from '../../data/looksRepo';
import { listPieces } from '../../data/piecesRepo';
import { getProfile } from '../../data/profileRepo';
import { commonThreads, lookCredit, lookStage, matchLook, type LookMatch, type LookStage, type SavedLook } from '../../domain/looks';
import type { Photo } from '../../domain/types';
import { Card, PageHeader, StoredImage } from '../../ui/controls';

/** What a look is waiting for, or how far the wardrobe is from it. */
export function lookStatus(stage: LookStage, match: LookMatch): { text: string; tone: 'todo' | 'good' | 'plain' } {
  if (stage === 'needs-screenshot') return { text: 'Add a screenshot', tone: 'todo' };
  if (stage === 'needs-pieces') return { text: 'List the pieces', tone: 'todo' };
  if (stage === 'needs-check') return { text: 'Check the pieces', tone: 'todo' };
  if (match.status === 'make-now') return { text: 'You can make this now', tone: 'good' };
  if (match.status === 'one-away') return { text: 'One piece away', tone: 'plain' };
  if (match.status === 'several-away') return { text: match.summary, tone: 'plain' };
  return { text: 'No main pieces listed', tone: 'todo' };
}

export function LooksScreen() {
  const navigate = useNavigate();
  const data = useLiveQuery(async () => {
    const [looks, covers, pieces, profile] = await Promise.all([listLooks(), lookCovers(), listPieces(), getProfile()]);
    return { looks, covers, pieces, rules: profile?.rules ?? [] };
  }, []);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!data) return <div aria-busy="true" />;
  const { looks, covers, pieces, rules } = data;

  async function save(text: string) {
    if (!text.trim()) return setError('Paste the link of the post first.');
    setBusy(true);
    setError(undefined);
    try {
      const { look } = await createLook({ link: text });
      navigate(`/inspiration/${look.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The link could not be saved.');
      setBusy(false);
    }
  }

  async function paste() {
    setError(undefined);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return setError('There is nothing copied. Copy the link of the post first.');
      setLink(text.trim());
      await save(text);
    } catch {
      setError('The phone did not let the app read what you copied. Tap the box and paste the link by hand.');
    }
  }

  const rows = looks.map((look) => {
    const shots = covers.get(look.id);
    const match = matchLook(look, rules, pieces);
    return { look, cover: shots?.cover, match, status: lookStatus(lookStage(look, shots?.count ?? 0), match) };
  });
  const ready = rows.filter((r) => r.look.confirmedAt);
  const makeNow = ready.filter((r) => r.match.status === 'make-now').length;
  const threads = commonThreads(looks, rules);
  const canReadClipboard = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function';

  return (
    <>
      <PageHeader
        eyebrow="Inspiration"
        title="Looks"
        sub={
          looks.length === 0
            ? 'Save an outfit you like and see how close your wardrobe is to it.'
            : `${looks.length} saved ${looks.length === 1 ? 'look' : 'looks'}${ready.length > 0 ? `. You can make ${makeNow} of them now.` : '.'}`
        }
      />

      <Card title="Save a post">
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void save(link);
          }}
        >
          <p className="hint">In Instagram, tap Share on the post, then Copy link. The app keeps the link and plays the post in Instagram's own player.</p>
          <input
            type="url"
            inputMode="url"
            aria-label="Link to the post"
            placeholder="https://www.instagram.com/reel/…"
            autoComplete="off"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          {error && (
            <p className="notice notice-bad" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            {canReadClipboard && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void paste()}>
                Paste link
              </button>
            )}
            <button type="submit" className={canReadClipboard ? 'btn' : 'btn btn-primary'} disabled={busy}>
              Save
            </button>
          </div>
        </form>
        <Link className="link-btn" to="/inspiration/new">
          Save a look without a link
        </Link>
      </Card>

      {threads.length > 0 && (
        <Card title="What your looks share">
          <ul className="plain-list">
            {threads.map((t) => (
              <li key={t.label}>
                {t.label}: in {t.count} of your {t.of} looks.
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rows.length === 0 ? (
        <p className="empty">Nothing saved yet. A saved look shows your version of it, what you already own for it, and what is missing.</p>
      ) : (
        <ul className="look-list">
          {rows.map(({ look, cover, status }) => (
            <li key={look.id}>
              <LookCard look={look} cover={cover} status={status} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function LookCard({ look, cover, status }: { look: SavedLook; cover: Photo | undefined; status: ReturnType<typeof lookStatus> }) {
  const credit = lookCredit(look);
  return (
    <Link className="look-card" to={`/inspiration/${look.id}`}>
      {cover ? <StoredImage bytes={cover.thumb} mimeType={cover.mimeType} alt="" className="look-thumb" /> : <span className="look-thumb look-thumb-blank" aria-hidden="true" />}
      <span className="look-card-body">
        {credit && <span className="look-credit">{credit.text}</span>}
        <span className="look-name">{look.name}</span>
        <span className="piece-tags">
          <span className={status.tone === 'todo' ? 'tag tag-todo' : status.tone === 'good' ? 'tag tag-your-rule' : 'tag'}>{status.text}</span>
        </span>
      </span>
    </Link>
  );
}

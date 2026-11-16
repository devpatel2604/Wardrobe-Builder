import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getInboxItem } from '../../data/inboxRepo';
import { MAX_SCREENSHOTS, attachInboxScreenshot, listLooks, lookCovers } from '../../data/looksRepo';
import { lookCredit } from '../../domain/looks';
import { Card, StoredImage } from '../../ui/controls';

/**
 * A screenshot that came in through the share menu goes to a look here. The
 * inbox opens this screen with "?inbox=<id>". The owner picks the look it
 * shows, or starts a new one from it.
 */
export function LookAttachScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inboxId = params.get('inbox') ?? '';
  const data = useLiveQuery(async () => {
    const [item, looks, covers] = await Promise.all([getInboxItem(inboxId), listLooks(), lookCovers()]);
    return { item, looks, covers };
  }, [inboxId]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!data) return <div aria-busy="true" />;
  const { item, looks, covers } = data;
  const image = item?.image;

  async function attach(lookId?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const look = await attachInboxScreenshot(inboxId, lookId);
      navigate(`/inspiration/${look.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The screenshot could not be added.');
      setBusy(false);
    }
  }

  // After a screenshot is attached it leaves the inbox. The move to the look's screen is already on its way.
  if (!image && busy) return <div aria-busy="true" />;

  return (
    <>
      <div className="detail-top">
        <Link className="back" to="/inspiration">
          ‹ Looks
        </Link>
      </div>
      <header className="page-head">
        <div>
          <h1>Add a screenshot to a look</h1>
          <p className="sub">Pick the look this screenshot shows, or start a new look from it.</p>
        </div>
      </header>

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      {!image ? (
        <p className="empty">That screenshot is no longer in your inbox.</p>
      ) : (
        <>
          <Card title="The screenshot">
            <StoredImage bytes={image.thumb} mimeType={image.mimeType} alt="The shared screenshot" className="photo-thumb photo-thumb-tall" />
          </Card>

          <Card title="Which look is it?">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void attach()}>
              Start a new look
            </button>
            <p className="hint">A look started from a screenshot has no link, so it is not tied to anyone's post. You can add the link later.</p>
            {looks.length > 0 && (
              <ul className="look-list">
                {looks.map((look) => {
                  const shots = covers.get(look.id);
                  const full = (shots?.count ?? 0) >= MAX_SCREENSHOTS;
                  const credit = lookCredit(look);
                  return (
                    <li key={look.id}>
                      <button type="button" className="look-card" disabled={busy || full} aria-label={`Add to ${look.name}`} onClick={() => void attach(look.id)}>
                        {shots ? (
                          <StoredImage bytes={shots.cover.thumb} mimeType={shots.cover.mimeType} alt="" className="look-thumb" />
                        ) : (
                          <span className="look-thumb look-thumb-blank" aria-hidden="true" />
                        )}
                        <span className="look-card-body">
                          {credit && <span className="look-credit">{credit.text}</span>}
                          <span className="look-name">{look.name}</span>
                          <span className="piece-tags">
                            <span className="tag">{full ? `Already has ${MAX_SCREENSHOTS} screenshots` : shots ? `${shots.count} ${shots.count === 1 ? 'screenshot' : 'screenshots'}` : 'No screenshot yet'}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}

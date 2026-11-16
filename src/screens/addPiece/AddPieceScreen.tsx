import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { processIncoming } from '../../data/images';
import { addInboxItem, collectInbox, listInbox, removeInboxItem } from '../../data/inboxRepo';
import { getAppKey } from '../../data/server';
import { canBecomeLook, canBecomePiece, inboxDetail, inboxTitle, isInstagramLink, type InboxDoor, type InboxItem } from '../../domain/inbox';
import { asLink, readClipboardImage } from '../../ui/clipboard';
import { Card, StoredImage, TextField } from '../../ui/controls';
import { LOOK_ROUTES } from './lookRoutes';

const count = (n: number) => (n === 1 ? '1 new item came in.' : `${n} new items came in.`);

/**
 * The start of adding a piece. Everything lands in the waiting list first,
 * whichever way it came in, and leaves it when it is saved as a piece.
 */
export function AddPieceScreen() {
  const navigate = useNavigate();
  const data = useLiveQuery(async () => ({ items: await listInbox(), connected: Boolean(await getAppKey()) }), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [link, setLink] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const addPhoto = useCallback(
    async (blob: Blob, door: InboxDoor) => {
      setBusy(true);
      setError(undefined);
      try {
        const image = await processIncoming(blob);
        const item = await addInboxItem({ kind: 'photo', door, image });
        navigate(`/wardrobe/new?inbox=${item.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That photo could not be added.');
        setBusy(false);
      }
    },
    [navigate],
  );

  const addLink = useCallback(
    async (url: string) => {
      const item = await addInboxItem({ kind: 'link', door: 'paste', url });
      if (!isInstagramLink(url)) return navigate(`/wardrobe/new?inbox=${item.id}`);
      if (LOOK_ROUTES.ready) return navigate(LOOK_ROUTES.fromLink(item.id));
      setLink('');
      setNote('That is an Instagram link, so it is a look, not a piece. It waits in the list above.');
    },
    [navigate],
  );

  // Collect what the share menu sent, quietly, each time this screen opens.
  useEffect(() => {
    void collectInbox().catch(() => undefined);
  }, []);

  // Pasting anywhere on the page works too, which is the quick way with a keyboard.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const picture = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (picture) {
        event.preventDefault();
        void addPhoto(picture, 'paste');
        return;
      }
      const pasted = asLink(event.clipboardData?.getData('text/plain'));
      if (pasted) {
        event.preventDefault();
        void addLink(pasted);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addPhoto, addLink]);

  async function onPasteCutout() {
    setError(undefined);
    setNote(undefined);
    try {
      const picture = await readClipboardImage();
      if (!picture) return setError('There is no picture on the clipboard. In Photos, press and hold the piece until it lifts, tap Copy, then come back.');
      await addPhoto(picture, 'paste');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nothing was pasted.');
    }
  }

  async function onCheckShared() {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const added = await collectInbox();
      setNote(added === 0 ? 'Nothing new on your server.' : count(added));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  function onLink() {
    setError(undefined);
    setNote(undefined);
    const url = asLink(link);
    if (!url) return setError('That does not look like a web link. It should start with https://');
    void addLink(url);
  }

  if (!data) return <div aria-busy="true" />;

  return (
    <>
      <div className="detail-top">
        <Link className="back" to="/wardrobe">
          ‹ Wardrobe
        </Link>
      </div>

      <header className="page-head">
        <div>
          <h1>Add a piece</h1>
          <p className="sub">Start from a photo or a store page. Whatever you add waits here until you save it, so nothing is lost if the app reloads.</p>
        </div>
      </header>

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      {data.items.length > 0 && (
        <Card title="Waiting to be added">
          <ul className="inbox-list">
            {data.items.map((item) => (
              <WaitingRow key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      )}

      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}

      <Card title="From a photo">
        <p className="hint">
          Best: in Photos, press and hold the piece until it lifts off the background, tap Copy, then come back and tap Paste. That keeps your room
          out of the picture.
        </p>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onPasteCutout()}>
            Paste a cut-out
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
            Take or choose a photo
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="visually-hidden"
          aria-label="Take or choose a photo of the piece"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void addPhoto(file, 'picker');
            e.target.value = '';
          }}
        />
      </Card>

      <Card title="From a store page">
        <form
          className="stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onLink();
          }}
        >
          <TextField label="Link to the product page" type="url" inputMode="url" value={link} onChange={setLink} placeholder="https://" />
          <p className="hint">The app never opens the store's site. On the next step you can add a screenshot of the page or paste its details.</p>
          <button type="submit" className="btn" disabled={busy || !link.trim()}>
            Use this link
          </button>
        </form>
      </Card>

      <Card title="From the share menu">
        {data.connected ? (
          <>
            <p className="hint">
              Share a photo or a store page to the Shortcut named "Save to Wardrobe" from any app. It goes to your server and turns up here the
              next time the app opens.
            </p>
            <div className="row">
              <button type="button" className="btn" disabled={busy} onClick={() => void onCheckShared()}>
                Check for shared items
              </button>
            </div>
            <Link className="link-btn" to="/settings/shortcut">
              How to set up the Shortcut
            </Link>
          </>
        ) : (
          <p className="hint">
            Sharing from other apps goes through your own server. <Link to="/settings">Connect it in Settings</Link> first.
          </p>
        )}
      </Card>

      <Link className="btn" to="/wardrobe/new">
        Fill in everything by hand
      </Link>
    </>
  );
}

function WaitingRow({ item }: { item: InboxItem }) {
  const [confirming, setConfirming] = useState(false);
  const asPiece = canBecomePiece(item) && !item.problem;
  const asLook = canBecomeLook(item) && !item.problem;
  const lookOnly = asLook && !asPiece;
  return (
    <li className="inbox-row">
      {item.image ? (
        <StoredImage bytes={item.image.thumb} mimeType={item.image.mimeType} alt="" className="inbox-thumb" />
      ) : (
        <span className="inbox-tile" aria-hidden="true">
          {item.kind === 'page' ? 'Page' : item.kind === 'photo' ? 'Photo' : 'Link'}
        </span>
      )}
      <div className="inbox-body">
        <p className="inbox-title">{inboxTitle(item)}</p>
        <p className="muted">{inboxDetail(item)}</p>
        {item.problem && <p className="muted">{item.problem}</p>}
        {lookOnly && !LOOK_ROUTES.ready && <p className="muted">This is a look, not a piece. It waits here until the looks screens are in the app.</p>}
        {confirming ? (
          <div className="row">
            <button type="button" className="link-btn link-danger" onClick={() => void removeInboxItem(item.id)}>
              Yes, remove it
            </button>
            <button type="button" className="link-btn" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <div className="row">
            {asPiece && (
              <Link className="btn btn-primary btn-small" to={`/wardrobe/new?inbox=${item.id}`} aria-label={`Add as a piece: ${inboxTitle(item)}`}>
                Add as a piece
              </Link>
            )}
            {asLook && LOOK_ROUTES.ready && (
              <Link
                className="btn btn-small"
                to={item.kind === 'screenshot' ? LOOK_ROUTES.fromScreenshot(item.id) : LOOK_ROUTES.fromLink(item.id)}
                aria-label={`Save as a look: ${inboxTitle(item)}`}
              >
                Save as a look
              </Link>
            )}
            <button type="button" className="link-btn" aria-label={`Remove: ${inboxTitle(item)}`} onClick={() => setConfirming(true)}>
              Remove
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

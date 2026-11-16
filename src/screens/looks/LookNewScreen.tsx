import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getInboxItem, removeInboxItem } from '../../data/inboxRepo';
import { createLook, saveLookFromShare } from '../../data/looksRepo';
import { Card, TextField } from '../../ui/controls';

/**
 * Saves a look by hand, with or without a link. Also the door for a link
 * that came in through the share menu: the inbox opens this screen with
 * "?inbox=<id>", and the link becomes a look waiting for its screenshot.
 */
export function LookNewScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inboxId = params.get('inbox');
  const [link, setLink] = useState(params.get('url') ?? '');
  const [creator, setCreator] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(Boolean(inboxId));
  const taken = useRef(false);

  useEffect(() => {
    if (!inboxId || taken.current) return;
    taken.current = true;
    void (async () => {
      try {
        const item = await getInboxItem(inboxId);
        if (!item?.url) throw new Error('That shared link is no longer in your inbox.');
        const { look } = await saveLookFromShare({ url: item.url, receivedAt: item.receivedAt });
        await removeInboxItem(inboxId);
        navigate(`/inspiration/${look.id}`, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The shared link could not be saved.');
        setBusy(false);
      }
    })();
  }, [inboxId, navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const { look } = await createLook({ link, creator, name });
      navigate(`/inspiration/${look.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The look could not be saved.');
      setBusy(false);
    }
  }

  if (inboxId && busy) return <div aria-busy="true" />;

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="detail-top">
        <Link className="back" to="/inspiration">
          ‹ Cancel
        </Link>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
          Save
        </button>
      </div>
      <header className="page-head">
        <div>
          <h1>Save a look</h1>
          <p className="sub">Everything here is optional. You add screenshots and the pieces on the next screen.</p>
        </div>
      </header>

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      <Card>
        <TextField
          label="Link to the post"
          hint="With a link, the look is tied to the creator's post. Without one it is saved as “in the style of”."
          type="url"
          inputMode="url"
          value={link}
          onChange={setLink}
          placeholder="https://"
        />
        <TextField label="Creator" hint="A handle such as @name, or a name." value={creator} onChange={setCreator} />
        <TextField label="Name for the look" hint="Leave it empty and the app names it from its pieces." value={name} onChange={setName} />
      </Card>
    </form>
  );
}

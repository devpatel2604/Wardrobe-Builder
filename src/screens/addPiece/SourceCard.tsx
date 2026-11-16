import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiErrorCode, aiErrorMessage, getAiStatus } from '../../data/ai';
import { cropImage, processIncoming } from '../../data/images';
import { updateInboxItem } from '../../data/inboxRepo';
import { getAppKey, ServerError } from '../../data/server';
import { canSuggest, suggestTags, whatIsSent } from '../../data/tagging';
import { siteOf, type InboxImage, type InboxItem } from '../../domain/inbox';
import { isUsable, subjectProblem, type PieceProposal } from '../../domain/tagging';
import { readClipboardImage } from '../../ui/clipboard';
import { Card, StoredImage } from '../../ui/controls';
import { CropBox, type CropShare } from '../../ui/CropBox';

type AiState =
  | { kind: 'checking' }
  | { kind: 'no-server' } // this phone is not connected to the small server
  | { kind: 'off' } // the server has no AI key
  | { kind: 'on' }
  | { kind: 'unknown'; message: string };

function words(error: unknown, fallback: string): string {
  if (error instanceof ServerError) return aiErrorMessage(error);
  return error instanceof Error ? error.message : fallback;
}

/**
 * What the piece is being added from: the photo or the store page, with the
 * tools to tidy it (crop, swap in a cut-out) and to ask an AI model for tags.
 * Sits at the top of the piece form.
 */
export function SourceCard({ item, onProposal }: { item: InboxItem; onProposal: (proposal: PieceProposal, model: string) => void }) {
  const [ai, setAi] = useState<AiState>({ kind: 'checking' });
  const [busy, setBusy] = useState<'ai' | 'photo'>();
  const [error, setError] = useState<string>();
  const [cropping, setCropping] = useState(false);
  // A page shared by the Shortcut arrives as one block of data, which is not for reading or editing.
  const packed = Boolean(item.text?.startsWith('{'));
  const [details, setDetails] = useState(packed ? '' : (item.text ?? ''));
  const extraInput = useRef<HTMLInputElement>(null);
  const isPhoto = item.kind === 'photo';

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!(await getAppKey())) return { kind: 'no-server' } as const;
      try {
        return { kind: (await getAiStatus()).ready ? 'on' : 'off' } as const;
      } catch (e) {
        // A server from before the AI route has no such address.
        if (e instanceof ServerError && e.status === 404) return { kind: 'off' } as const;
        return { kind: 'unknown', message: words(e, 'The server could not be reached.') } as const;
      }
    })().then((state) => {
      if (live) setAi(state);
    });
    return () => {
      live = false;
    };
  }, []);

  async function withPhoto(work: () => Promise<void>, fallback: string) {
    setBusy('photo');
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(undefined);
    }
  }

  const onCrop = (crop: CropShare) =>
    withPhoto(async () => {
      const image = item.image;
      if (!image) return;
      const cropped = await cropImage(image, {
        x: crop.x * image.width,
        y: crop.y * image.height,
        width: crop.width * image.width,
        height: crop.height * image.height,
      });
      await updateInboxItem(item.id, { image: { ...cropped, cutout: image.cutout } });
      setCropping(false);
    }, 'The photo could not be cropped.');

  const onPasteCutout = () =>
    withPhoto(async () => {
      const picture = await readClipboardImage();
      if (!picture) throw new Error('There is no picture on the clipboard. In Photos, press and hold the piece until it lifts, tap Copy, then come back.');
      await updateInboxItem(item.id, { image: await processIncoming(picture) });
    }, 'Nothing was pasted.');

  const onExtra = (file: File | undefined) =>
    withPhoto(async () => {
      if (!file) return;
      const extraImage: InboxImage = await processIncoming(file);
      await updateInboxItem(item.id, { extraImage });
    }, 'That picture could not be added.');

  async function keepDetails(): Promise<InboxItem> {
    if (isPhoto || packed) return item;
    const text = details.trim() || undefined;
    if (text === item.text) return item;
    await updateInboxItem(item.id, { text });
    return { ...item, text };
  }

  async function onSuggest() {
    setBusy('ai');
    setError(undefined);
    try {
      const { proposal, model } = await suggestTags(await keepDetails());
      onProposal(proposal, model);
    } catch (e) {
      if (aiErrorCode(e) === 'no-ai-key') setAi({ kind: 'off' });
      setError(words(e, 'The AI request did not work. Try again.'));
    } finally {
      setBusy(undefined);
    }
  }

  const proposal = item.proposal;
  const ready = canSuggest(isPhoto || packed ? item : { ...item, text: details.trim() || undefined });
  const extraName = isPhoto ? 'care label' : 'page';

  return (
    <Card title={isPhoto ? 'The photo' : 'The store page'}>
      {isPhoto && item.image && cropping ? (
        <CropBox bytes={item.image.data} mimeType={item.image.mimeType} busy={busy === 'photo'} onDone={(crop) => void onCrop(crop)} onCancel={() => setCropping(false)} />
      ) : isPhoto && item.image ? (
        <>
          <div className="source">
            <StoredImage bytes={item.image.thumb} mimeType={item.image.mimeType} alt="The photo this piece is added from" className="source-photo" />
            <div className="source-facts">
              <p>
                <span className={item.image.cutout ? 'tag tag-good' : 'tag tag-todo'}>{item.image.cutout ? 'Cut-out' : 'Photo as taken'}</span>
              </p>
              <p className="hint">{item.image.cutout ? 'Only the piece is in this picture. It becomes the first photo of the piece.' : 'It becomes the first photo of the piece.'}</p>
              <div className="row">
                <button type="button" className="btn btn-small" disabled={busy !== undefined} onClick={() => setCropping(true)}>
                  Crop
                </button>
                <button type="button" className="btn btn-small" disabled={busy !== undefined} onClick={() => void onPasteCutout()}>
                  Paste a cut-out instead
                </button>
              </div>
            </div>
          </div>
          {!item.image.cutout && (
            <p className="notice">
              This photo still has its background. Crop it to the piece, or paste a cut-out from Photos. If you ask AI for tags, everything in the
              photo is sent, so keep people out of it.
            </p>
          )}
        </>
      ) : (
        <div className="source-facts">
          {item.title && <p className="inbox-title">{item.title}</p>}
          {item.url && (
            <p className="muted">
              {siteOf(item.url) ?? item.url}. The app does not open this page. The link is kept with the piece.
            </p>
          )}
          {packed && <p className="muted">Your phone copied the page's text when you shared it ({item.text!.length.toLocaleString()} characters).</p>}
        </div>
      )}

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      <div className="ai-box">
        {ai.kind === 'checking' && <p className="hint">Checking whether AI tagging is on.</p>}
        {ai.kind === 'no-server' && (
          <p className="hint">
            AI tagging needs your server, and this phone is not connected to it. Fill in the tags below by hand, or <Link to="/settings">connect in Settings</Link>.
          </p>
        )}
        {ai.kind === 'off' && (
          <p className="hint">
            AI tagging is off, because your server has no AI key yet. Fill in the tags below by hand. <Link to="/settings">Settings has the steps to turn it on.</Link>
          </p>
        )}
        {ai.kind === 'unknown' && <p className="hint">{ai.message} Fill in the tags below by hand, or try again later.</p>}
        {ai.kind === 'on' && (
          <>
            {!isPhoto && !packed && (
              <div className="field">
                <div className="field-label">
                  <label htmlFor={`details-${item.id}`}>Details copied from the page</label>
                </div>
                <p className="hint">Optional. In Safari, select the name, color, material and price on the page, copy, and paste here for the AI to read.</p>
                <textarea id={`details-${item.id}`} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} onBlur={() => void keepDetails()} />
              </div>
            )}
            {item.extraImage ? (
              <div className="source-extra">
                <StoredImage bytes={item.extraImage.thumb} mimeType={item.extraImage.mimeType} alt={`Your picture of the ${extraName}`} className="thumb" />
                <p className="muted">{isPhoto ? 'Care label photo added.' : 'Screenshot added.'}</p>
                <button type="button" className="link-btn" onClick={() => void updateInboxItem(item.id, { extraImage: undefined })}>
                  Remove
                </button>
              </div>
            ) : (
              <button type="button" className="link-btn" disabled={busy !== undefined} onClick={() => extraInput.current?.click()}>
                {isPhoto ? 'Add a photo of the care label, so the cloth can be read' : 'Add a screenshot of the page'}
              </button>
            )}
            <input
              ref={extraInput}
              type="file"
              accept="image/*"
              className="visually-hidden"
              aria-label={isPhoto ? 'Choose a photo of the care label' : 'Choose a screenshot of the page'}
              onChange={(e) => {
                void onExtra(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button type="button" className="btn btn-primary" disabled={busy !== undefined || !ready} onClick={() => void onSuggest()}>
              {busy === 'ai' ? 'Reading' : proposal ? 'Ask AI again' : 'Suggest tags with AI'}
            </button>
            <p className="hint">{ready ? whatIsSent(isPhoto || packed ? item : { ...item, text: details.trim() || undefined }) : 'Add a screenshot of the page or paste its details first, so the AI has something to read.'}</p>
          </>
        )}
        {proposal &&
          (isUsable(proposal) ? (
            <p className="notice" role="status">
              Tags suggested{item.proposalModel ? ` by ${item.proposalModel}` : ''}. Each field it filled is marked AI. Check them against the piece before you save.
              {proposal.note && ` Its note: ${proposal.note}`}
            </p>
          ) : (
            <p className="notice" role="status">
              {subjectProblem(proposal.subject) ?? 'The AI could not tell what goes where on this one. Fill in the tags by hand.'}
            </p>
          ))}
      </div>
    </Card>
  );
}

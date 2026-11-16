import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { processImage, type ProcessedImage } from '../../data/images';
import { MAX_SCREENSHOTS_READ, readLook, readingState, type ReadingState } from '../../data/lookReader';
import { buyListReady, dropLookFromBuyList, openWishIds, sendMissingToBuyList, sendPieceToBuyList, syncLookWishes } from '../../data/lookWishes';
import {
  MAX_SCREENSHOTS,
  addLookPhotos,
  confirmLook,
  deleteLook,
  getLook,
  listLookPhotos,
  removeLookPhoto,
  removeLookPiece,
  saveLookPiece,
  setPieceChoice,
  setStandIn,
  updateLookDetails,
} from '../../data/looksRepo';
import { listPieces } from '../../data/piecesRepo';
import { getProfile } from '../../data/profileRepo';
import { parseSharedLink } from '../../domain/links';
import { lookCredit, lookStage, matchLook, yourVersion, type LookPiece, type PieceMatch, type SavedLook, type VersionLine } from '../../domain/looks';
import { NECKLINES, SLOTS, labelOf, swatchOf } from '../../domain/options';
import type { Photo, Piece, Rule } from '../../domain/types';
import { Card, EvidenceTag, StoredImage, TextField } from '../../ui/controls';
import { LookPieceForm, type PieceFields } from './LookPieceForm';
import { lookStatus } from './LooksScreen';
import { PostPlayer } from './PostPlayer';

const SLOT_LABELS: Record<string, string> = { ...Object.fromEntries(SLOTS.map((s) => [s.value, s.label])), 'outer-layer': 'Layer or coat', accessory: 'Accessory' };

export function LookDetailScreen() {
  const { id = '' } = useParams();
  const data = useLiveQuery(async () => {
    const [look, photos, pieces, profile, wishes] = await Promise.all([getLook(id), listLookPhotos(id), listPieces(), getProfile(), openWishIds()]);
    return { look, photos, pieces, rules: profile?.rules ?? [], wishes };
  }, [id]);

  if (!data) return <div aria-busy="true" />;
  if (!data.look) {
    return (
      <>
        <Link className="back" to="/inspiration">
          ‹ Looks
        </Link>
        <p className="empty">That look is no longer saved.</p>
      </>
    );
  }
  return <LookDetail look={data.look} photos={data.photos} pieces={data.pieces} rules={data.rules} wishes={data.wishes} />;
}

interface Loaded {
  look: SavedLook;
  photos: Photo[];
  pieces: Piece[];
  rules: Rule[];
  /** The ids of buy-list lines that are still open. */
  wishes: Set<string>;
}

function LookDetail({ look, photos, pieces, rules, wishes }: Loaded) {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [editingDetails, setEditingDetails] = useState(false);
  const [editingPiece, setEditingPiece] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [sent, setSent] = useState<string>();
  const [showPieces, setShowPieces] = useState(false);
  const reading = useReadingState();
  const fileInput = useRef<HTMLInputElement>(null);

  const shared = look.link ? parseSharedLink(look.link) : undefined;
  const credit = lookCredit(look);
  const stage = lookStage(look, photos.length);
  const version = yourVersion(look, rules);
  const match = matchLook(look, rules, pieces);
  const status = lookStatus(stage, match);
  const ready = stage === 'ready';
  // Once the pieces are confirmed the list folds away, so the screen leads with the owner's version.
  const piecesOpen = !ready || showPieces || editingPiece !== undefined;
  const canRead = photos.length > 0 && reading !== 'no-key' && reading !== 'no-server';

  /** Runs one change, shows what went wrong, and keeps the buy list in step with the look. */
  async function run(label: string, work: () => Promise<unknown>, options: { sync?: boolean } = {}) {
    setBusy(label);
    setError(undefined);
    setSent(undefined);
    try {
      await work();
      if (options.sync) await syncLookWishes(look.id);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
      return false;
    } finally {
      setBusy(undefined);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    await run('photos', async () => {
      const room = MAX_SCREENSHOTS - photos.length;
      const processed: ProcessedImage[] = [];
      for (const file of Array.from(files).slice(0, room)) processed.push(await processImage(file));
      await addLookPhotos(look.id, processed);
      if (files.length > room) throw new Error(`A look holds up to ${MAX_SCREENSHOTS} screenshots. The first ${room} were added.`);
    });
  }

  async function savePiece(fields: PieceFields) {
    await saveLookPiece(look.id, fields);
    await syncLookWishes(look.id);
    setEditingPiece(undefined);
  }

  const toSend = match.missing.filter((m) => !onList(m, wishes));
  // The buy list is its own part of the app. Until it is there, its buttons are left out.
  const canSend = buyListReady();
  const onListCount = match.lines.filter((m) => m.toFind && onList(m, wishes)).length;

  return (
    <>
      <div className="detail-top">
        <Link className="back" to="/inspiration">
          ‹ Looks
        </Link>
        <button type="button" className="btn btn-small" onClick={() => setEditingDetails((v) => !v)}>
          {editingDetails ? 'Close' : 'Edit details'}
        </button>
      </div>

      <header className="page-head">
        <div>
          {credit && <p className="eyebrow">{credit.text}</p>}
          <h1>{look.name}</h1>
          <p className="piece-tags">
            <span className={status.tone === 'todo' ? 'tag tag-todo' : status.tone === 'good' ? 'tag tag-your-rule' : 'tag'}>{status.text}</span>
          </p>
        </div>
      </header>

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      {editingDetails && <DetailsForm key={look.updatedAt} look={look} onDone={() => setEditingDetails(false)} />}

      <Card title="The post">
        {shared ? (
          <PostPlayer shared={shared} startOpen={photos.length === 0} />
        ) : (
          <p className="hint">
            No link is saved, so this look is not tied to a creator's post{look.creator ? ` and is credited as “in the style of ${look.creator}”` : ''}. Add the link under Edit details.
          </p>
        )}
        {look.notes && <p className="prose">{look.notes}</p>}
      </Card>

      <Card title="Your screenshots">
        <p className="hint">One or two screenshots of the whole outfit are enough. They stay on this phone and in your encrypted backup, and are shown nowhere else.</p>
        <ul className="photo-strip">
          {photos.map((photo, i) => (
            <li key={photo.id}>
              <StoredImage bytes={photo.thumb} mimeType={photo.mimeType} alt={`Screenshot ${i + 1}`} className="photo-thumb photo-thumb-tall" />
              <button type="button" className="photo-remove" aria-label={`Remove screenshot ${i + 1}`} onClick={() => void run('photos', () => removeLookPhoto(photo.id))}>
                Remove
              </button>
            </li>
          ))}
          {photos.length < MAX_SCREENSHOTS && (
            <li>
              <button type="button" className="photo-add photo-thumb-tall" disabled={busy === 'photos'} onClick={() => fileInput.current?.click()}>
                {busy === 'photos' ? 'Adding' : 'Add screenshot'}
              </button>
            </li>
          )}
        </ul>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          aria-label="Choose screenshots"
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </Card>

      <Card
        title="The pieces"
        action={
          ready && !piecesOpen ? (
            <button type="button" className="link-btn" onClick={() => setShowPieces(true)}>
              Edit the pieces
            </button>
          ) : undefined
        }
      >
        {!piecesOpen ? (
          <p className="hint">
            {look.pieces.length} {look.pieces.length === 1 ? 'piece' : 'pieces'}, checked by you. Your version of the look is below.
          </p>
        ) : (
          <>
            {look.pieces.length === 0 && <p className="hint">List what the outfit is made of, slot by slot. The app can read it from your screenshots, or you can add the pieces yourself.</p>}
            {stage === 'needs-check' && (
              <p className="notice">
                {look.pieces.some((p) => p.from === 'ai') ? 'These were read from your screenshots and may be wrong. ' : ''}Check each piece, fix what is off, then confirm.
              </p>
            )}

            {look.pieces.length > 0 && (
              <ul className="look-rows">
                {look.pieces.map((piece) =>
                  editingPiece === piece.id ? (
                    <li key={piece.id}>
                      <LookPieceForm
                        piece={piece}
                        onSave={savePiece}
                        onCancel={() => setEditingPiece(undefined)}
                        onRemove={async () => {
                          await removeLookPiece(look.id, piece.id);
                          await syncLookWishes(look.id);
                          setEditingPiece(undefined);
                        }}
                      />
                    </li>
                  ) : (
                    <li key={piece.id} className="look-row">
                      <PieceLine piece={piece} />
                      <button type="button" className="link-btn" aria-label={`Edit ${piece.description}`} onClick={() => setEditingPiece(piece.id)}>
                        Edit
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}

            {editingPiece === 'new' ? (
              <LookPieceForm onSave={savePiece} onCancel={() => setEditingPiece(undefined)} />
            ) : (
              <div className="row">
                {stage === 'needs-check' && (
                  <button type="button" className="btn btn-primary" disabled={busy !== undefined} onClick={() => void run('confirm', () => confirmLook(look.id))}>
                    These are right
                  </button>
                )}
                {canRead && (
                  <button
                    type="button"
                    className={look.pieces.length === 0 ? 'btn btn-primary' : 'btn'}
                    disabled={busy !== undefined}
                    onClick={() => void run('read', () => readLook(look.id), { sync: true })}
                  >
                    {busy === 'read' ? 'Reading the screenshots' : look.reading ? 'Read the screenshots again' : 'Read the screenshots'}
                  </button>
                )}
                <button type="button" className={look.pieces.length === 0 && !canRead ? 'btn btn-primary' : 'btn'} disabled={busy !== undefined} onClick={() => setEditingPiece('new')}>
                  Add a piece by hand
                </button>
                {ready && (
                  <button type="button" className="btn" onClick={() => setShowPieces(false)}>
                    Done
                  </button>
                )}
              </div>
            )}

            {reading === 'no-key' ? (
              <p className="hint">Reading screenshots is switched off, because your server has no AI key yet. Add the pieces by hand for now. Everything else here works without it.</p>
            ) : reading === 'no-server' ? (
              <p className="hint">This phone is not connected to your server, so the app cannot read screenshots. Add the pieces by hand, or connect in Settings.</p>
            ) : photos.length > 0 ? (
              <p className="hint">
                Reading sends {photos.length > MAX_SCREENSHOTS_READ ? `your first ${MAX_SCREENSHOTS_READ} screenshots` : photos.length === 1 ? 'the screenshot' : 'the screenshots'} to your own server and on to the
                AI provider. They show a creator's public post, not you. Pieces you wrote or edited yourself are kept.
              </p>
            ) : (
              look.pieces.length === 0 && <p className="hint">Add a screenshot above to have the app read the outfit for you.</p>
            )}
            {look.reading?.notes && <p className="hint">Note from the reading: {look.reading.notes}</p>}
          </>
        )}
      </Card>

      {ready && (
        <Card title="Your version">
          <p className="look-summary">{match.summary}</p>
          <p className="hint">The look after your own rules, next to what you own. You have the last word on every piece.</p>
          <ul className="look-rows">
            {[...version.filter((l) => l.action !== 'drop'), ...version.filter((l) => l.action === 'drop')].map((line) => {
              const found = match.lines.find((m) => m.wanted.id === line.piece.id);
              return (
                <VersionRow
                  key={line.piece.id}
                  line={line}
                  match={found}
                  listed={found !== undefined && onList(found, wishes)}
                  busy={busy !== undefined}
                  onChoice={(choice) => void run('choice', () => setPieceChoice(look.id, line.piece.id, choice), { sync: true })}
                  onStandIn={(ownedId) => void run('stand-in', () => setStandIn(look.id, line.piece.id, ownedId), { sync: true })}
                  onSend={
                    canSend
                      ? () =>
                          void run('send', async () => {
                            await sendPieceToBuyList(look.id, line.piece.id);
                            setSent('Added to your buy list.');
                          })
                      : undefined
                  }
                />
              );
            })}
          </ul>
          {canSend && toSend.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== undefined}
              onClick={() =>
                void run('send', async () => {
                  const count = await sendMissingToBuyList(look.id);
                  setSent(`${count} ${count === 1 ? 'piece' : 'pieces'} sent to your buy list, marked as completing this look.`);
                })
              }
            >
              {toSend.length === 1 ? 'Send the missing piece to the buy list' : `Send ${toSend.length} missing pieces to the buy list`}
            </button>
          )}
          {sent && <p role="status">{sent}</p>}
          {onListCount > 0 && (
            <Link className="link-btn" to="/buy">
              Open the buy list
            </Link>
          )}
        </Card>
      )}

      <div className="danger-zone">
        {confirmingDelete ? (
          <>
            <p>Delete this look and its screenshots? Pieces it sent to the buy list are taken off, unless another look needs them.</p>
            <div className="row">
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  const done = await run('delete', async () => {
                    await dropLookFromBuyList(look.id);
                    await deleteLook(look.id);
                  });
                  if (done) navigate('/inspiration', { replace: true });
                }}
              >
                Yes, delete it
              </button>
              <button type="button" className="btn" onClick={() => setConfirmingDelete(false)}>
                Keep it
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn btn-quiet-danger" onClick={() => setConfirmingDelete(true)}>
            Delete this look
          </button>
        )}
      </div>
    </>
  );
}

/** Whether the screenshot reading can be used right now. "unknown" until the server has answered. */
function useReadingState(): ReadingState {
  const [state, setState] = useState<ReadingState>('unknown');
  useEffect(() => {
    let live = true;
    void readingState().then((value) => {
      if (live) setState(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function onList(match: PieceMatch, wishes: Set<string>): boolean {
  return match.wanted.wishId !== undefined && wishes.has(match.wanted.wishId);
}

function Dot({ piece }: { piece: LookPiece }) {
  const swatch = swatchOf(piece.colorFamily);
  return <span className={swatch ? 'thumb look-dot' : 'thumb look-dot look-dot-blank'} style={swatch ? { background: swatch } : undefined} aria-hidden="true" />;
}

function details(piece: LookPiece): string[] {
  return [
    labelOf(NECKLINES, piece.neckline),
    piece.texture === 'rough' ? 'Rough texture' : undefined,
    piece.fit && piece.fit !== 'regular' ? `${piece.fit[0]!.toUpperCase()}${piece.fit.slice(1)} fit` : undefined,
    piece.material && !piece.description.toLowerCase().includes(piece.material) ? `Looks like ${piece.material}` : undefined,
    piece.hardware === 'gold-or-brass' ? 'Gold or brass metal' : piece.hardware === 'silver' ? 'Silver metal' : undefined,
    ...piece.tags.filter((t) => !piece.description.toLowerCase().includes(t)),
  ].filter((v): v is string => Boolean(v));
}

function PieceLine({ piece, struck }: { piece: LookPiece; struck?: boolean }) {
  const extra = details(piece);
  return (
    <div className="outfit-row">
      <Dot piece={piece} />
      <div>
        <p className="outfit-slot">{SLOT_LABELS[piece.slot] ?? piece.slot}</p>
        <p className={struck ? 'outfit-name struck' : 'outfit-name'}>{piece.description}</p>
        {(extra.length > 0 || piece.confidence === 'low') && (
          <p className="piece-tags">
            {piece.confidence === 'low' && <span className="tag tag-todo">Not sure</span>}
            {extra.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

interface VersionRowProps {
  line: VersionLine;
  /** How the piece stands against the wardrobe. Missing for a piece that is left out. */
  match: PieceMatch | undefined;
  /** True when the piece is on the buy list. */
  listed: boolean;
  busy: boolean;
  onChoice: (choice: LookPiece['choice']) => void;
  onStandIn: (ownedId: string | undefined) => void;
  /** Nothing given when the app has no buy list yet. */
  onSend?: () => void;
}

/** One piece of the owner's version: what the rules did with it, and what the wardrobe has for it. */
function VersionRow({ line, match, listed, busy, onChoice, onStandIn, onSend }: VersionRowProps) {
  const { piece, action, byYou, ruled } = line;
  const name = piece.description;
  const owned = match?.owned;
  const ownedLink = owned && <Link to={`/wardrobe/${owned.id}`}>{owned.name}</Link>;
  return (
    <li className="look-row look-row-stack">
      <PieceLine piece={piece} struck={action === 'drop'} />

      {action === 'adjust' && (
        <p className="look-change">
          <span className="tag tag-todo">Changed</span> {line.changes.join('. ')}.
        </p>
      )}
      {action === 'drop' && (
        <p className="look-change">
          <span className="tag tag-bad">Left out</span> {byYou ? 'You left this out.' : 'Your rules leave this out.'}
        </p>
      )}
      {action === 'keep' && byYou && (
        <p className="look-change">
          <span className="tag">Kept by you</span> Your rules would {ruled === 'drop' ? 'leave this out' : 'change this'}.
        </p>
      )}
      {line.reasons.map((reason) => (
        <p key={reason.rule} className="hint">
          {reason.rule}. {reason.detail} <EvidenceTag evidence={reason.evidence} />
        </p>
      ))}

      {match?.level === 'have' && (
        <p className="look-change">
          <span className="tag tag-your-rule">You own it</span> {ownedLink}
        </p>
      )}
      {match?.level === 'close' && match.accepted && (
        <p className="look-change">
          <span className="tag tag-your-rule">Using yours</span> {ownedLink}. {match.differences.join(' ')}
        </p>
      )}
      {match?.level === 'close' && !match.accepted && (
        <p className="look-change">
          <span className="tag tag-todo">Close</span> Closest you own: {ownedLink}. {match.differences.join(' ')}
        </p>
      )}
      {match?.level === 'missing' && (
        <p className="look-change">
          <span className="tag tag-bad">Missing</span> {match.core ? 'Nothing you own fits this.' : 'A finishing touch. It does not count as a piece away.'}
        </p>
      )}
      {listed && (
        <p className="look-change">
          <span className="tag">On your buy list</span>
        </p>
      )}

      <div className="row">
        {byYou ? (
          <button type="button" className="link-btn" disabled={busy} aria-label={`Go back to your rules for ${name}`} onClick={() => onChoice(undefined)}>
            {action === 'drop' ? 'Put it back' : 'Go back to your rules'}
          </button>
        ) : (
          action !== 'keep' && (
            <button type="button" className="link-btn" disabled={busy} aria-label={`Keep ${name} as it is`} onClick={() => onChoice('keep')}>
              {action === 'drop' ? 'Keep it anyway' : 'Keep it as it is'}
            </button>
          )
        )}
        {match?.level === 'close' && !match.accepted && owned && (
          <button type="button" className="link-btn" disabled={busy} aria-label={`Use ${owned.name} for ${name}`} onClick={() => onStandIn(owned.id)}>
            Mine is close enough
          </button>
        )}
        {match?.accepted && (
          <button type="button" className="link-btn" disabled={busy} aria-label={`Stop using your own piece for ${name}`} onClick={() => onStandIn(undefined)}>
            Look for the real one
          </button>
        )}
        {onSend && match?.toFind && !match.core && !listed && (
          <button type="button" className="link-btn" disabled={busy} aria-label={`Add ${name} to the buy list`} onClick={onSend}>
            Add to the buy list
          </button>
        )}
      </div>
    </li>
  );
}

function DetailsForm({ look, onDone }: { look: SavedLook; onDone: () => void }) {
  const [name, setName] = useState(look.name);
  const [link, setLink] = useState(look.link ?? '');
  const [creator, setCreator] = useState(look.creator ?? '');
  const [notes, setNotes] = useState(look.notes ?? '');
  const [error, setError] = useState<string>();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await updateLookDetails(look.id, { name, link, creator, notes });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The details could not be saved.');
    }
  }

  return (
    <Card title="Details">
      <form onSubmit={onSubmit} noValidate>
        <TextField label="Name" value={name} onChange={setName} />
        <TextField
          label="Link to the post"
          hint="With a link, the look is tied to the creator's post. Without one it is “in the style of”."
          type="url"
          inputMode="url"
          value={link}
          onChange={setLink}
          placeholder="https://"
        />
        <TextField label="Creator" hint="A handle such as @name, or a name." value={creator} onChange={setCreator} />
        <TextField label="Notes" multiline value={notes} onChange={setNotes} />
        {error && (
          <p className="notice notice-bad" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary">
          Save details
        </button>
      </form>
    </Card>
  );
}

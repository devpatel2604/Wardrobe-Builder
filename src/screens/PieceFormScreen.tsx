import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { processImage, type ProcessedImage } from '../data/images';
import { getInboxItem, removeInboxItem } from '../data/inboxRepo';
import { createPiece, getPiece, listPhotos, updatePiece } from '../data/piecesRepo';
import { getProfile } from '../data/profileRepo';
import { now } from '../domain/clock';
import { dateKey } from '../domain/dates';
import type { InboxItem } from '../domain/inbox';
import {
  COLOR_FAMILIES,
  DEPTHS,
  DRESS_LEVELS,
  FITS,
  HARDWARE,
  HEMS,
  NECKLINES,
  SLOTS,
  STATUSES,
  TEXTURES,
  TOP_SLOTS,
  WARMTHS,
} from '../domain/options';
import { checkPiece } from '../domain/ruleChecks';
import { isUsable, type PieceProposal, type ProposalField, type TaggingRecord } from '../domain/tagging';
import type { Photo, Piece, Rule } from '../domain/types';
import { Card, Chips, MultiChips, StoredImage, TextField } from '../ui/controls';
import { RuleFindings } from '../ui/RuleFindings';
import { SourceCard } from './addPiece/SourceCard';
import { applyProposal, blankForm, draftFromForm, fieldOf, formFromItem, formFromPiece, MARK_WORDS, type FormState, type Marks } from './pieceFormState';

const WET_OPTIONS = [
  { value: 'yes', label: 'Fine when wet' },
  { value: 'no', label: 'Dry days only' },
];

export function PieceFormScreen() {
  const { id } = useParams();
  const [params] = useSearchParams();
  // A new piece can start from something in the waiting list.
  const inboxId = id ? undefined : (params.get('inbox') ?? undefined);
  const loaded = useLiveQuery(async () => {
    const profile = await getProfile();
    const rules = profile?.rules ?? [];
    const item = inboxId ? await getInboxItem(inboxId) : undefined;
    if (!id) return { piece: undefined, photos: [] as Photo[], rules, item };
    const [piece, photos] = await Promise.all([getPiece(id), listPhotos(id)]);
    return { piece, photos, rules, item };
  }, [id, inboxId]);
  // The item leaves the waiting list the moment the piece is saved. Remembering
  // that the form did start keeps "no longer waiting" from flashing up then.
  const [started, setStarted] = useState<string>();
  const found = loaded?.item?.id;
  if (found && started !== found) setStarted(found);

  if (!loaded) return <div aria-busy="true" />;
  if (id !== undefined && !loaded.piece) {
    return (
      <>
        <Link className="back" to="/wardrobe">
          ‹ Wardrobe
        </Link>
        <p className="empty">That piece is no longer in your wardrobe.</p>
      </>
    );
  }
  if (inboxId !== undefined && !loaded.item && started !== inboxId) {
    return (
      <>
        <Link className="back" to="/wardrobe/add">
          ‹ Add a piece
        </Link>
        <p className="empty">That item is no longer waiting. It was saved or removed.</p>
      </>
    );
  }
  // Keyed, so the form is filled once and later live updates never wipe what was typed.
  return <PieceForm key={id ?? inboxId ?? 'new'} piece={loaded.piece} photos={loaded.photos} rules={loaded.rules} item={loaded.item} fromInbox={inboxId !== undefined} />;
}

/** What is kept on the piece about the AI proposal it started from. */
function taggingRecord(item: InboxItem | undefined): TaggingRecord | undefined {
  if (!item?.proposal || !isUsable(item.proposal)) return undefined;
  return {
    source: item.kind === 'photo' ? 'photo' : 'page',
    model: item.proposalModel ?? 'unknown',
    at: item.proposedAt ?? now().toISOString(),
    proposal: item.proposal,
  };
}

function PieceForm({
  piece,
  photos,
  rules,
  item,
  fromInbox,
}: {
  piece: Piece | undefined;
  photos: Photo[];
  rules: Rule[];
  item: InboxItem | undefined;
  fromInbox: boolean;
}) {
  const navigate = useNavigate();
  const editing = piece !== undefined;
  const [{ form, marks }, setState] = useState<{ form: FormState; marks: Marks }>(() => {
    if (piece) return { form: formFromPiece(piece), marks: {} };
    if (!item) return { form: blankForm(), marks: {} };
    const start = formFromItem(item);
    // Tags proposed before the app was closed or reloaded are still with the item.
    return item.proposal ? applyProposal(start.form, start.marks, item.proposal) : start;
  });
  const [addedPhotos, setAddedPhotos] = useState<ProcessedImage[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const findings = useMemo(() => checkPiece(form, rules), [form, rules]);

  // Changing a field by hand makes the value the owner's own, so its mark goes.
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setState((state) => {
      const field = fieldOf(key);
      const nextMarks = { ...state.marks };
      if (field) delete nextMarks[field];
      return { form: { ...state.form, [key]: value }, marks: nextMarks };
    });
  const onProposal = (proposal: PieceProposal) => setState((state) => applyProposal(state.form, state.marks, proposal));
  const mark = (field: ProposalField) => {
    const kind = marks[field];
    return kind ? <span className={kind === 'ai-unsure' ? 'tag tag-ai tag-ai-unsure' : 'tag tag-ai'}>{MARK_WORDS[kind]}</span> : undefined;
  };
  const isTop = form.slots.some((s) => TOP_SLOTS.includes(s));
  const keptPhotos = photos.filter((p) => !removedPhotoIds.includes(p.id));
  const backTo = piece ? `/wardrobe/${piece.id}` : fromInbox ? '/wardrobe/add' : '/wardrobe';
  const aiFilled = Object.values(marks).some((kind) => kind === 'ai' || kind === 'ai-unsure');

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPhotoBusy(true);
    setError(undefined);
    try {
      const processed: ProcessedImage[] = [];
      for (const file of Array.from(files)) processed.push(await processImage(file));
      setAddedPhotos((current) => [...current, ...processed]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That photo could not be added.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return setError('Give the piece a name.');
    if (form.slots.length === 0) return setError('Pick where the piece goes in an outfit.');
    if (form.price.trim() !== '' && !(Number(form.price) >= 0)) return setError('The price should be a number, such as 49.90.');
    if (form.listPrice.trim() !== '' && !(Number(form.listPrice) >= 0)) return setError('The price on the page should be a number, such as 49.90.');
    setSaving(true);
    setError(undefined);
    try {
      // Read again, so a crop or a proposal made a moment ago is the one saved.
      const source = item ? ((await getInboxItem(item.id)) ?? item) : undefined;
      const draft = draftFromForm(form, { piece, tagging: taggingRecord(source), today: dateKey(now()) });
      const first: ProcessedImage[] = [];
      if (source?.kind === 'photo' && source.image) {
        const { mimeType, width, height, data, thumb } = source.image;
        first.push({ mimeType, width, height, data, thumb });
      }
      const changes = { add: [...first, ...addedPhotos], remove: removedPhotoIds };
      const saved = piece ? await updatePiece(piece.id, draft, changes) : await createPiece(draft, changes);
      // It is a piece now, so it leaves the waiting list.
      if (source) await removeInboxItem(source.id);
      navigate(`/wardrobe/${saved.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The piece could not be saved.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="detail-top">
        <Link className="back" to={backTo}>
          ‹ Cancel
        </Link>
        <button type="submit" className="btn btn-primary btn-small" disabled={saving || photoBusy}>
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>

      <header className="page-head">
        <div>
          <h1>{editing ? 'Edit piece' : 'Add a piece'}</h1>
          <p className="sub">
            {aiFilled
              ? 'Check each field marked AI against the piece. Change anything that is off, and its mark goes away.'
              : 'Only the name and where it goes are needed. Fill in the rest when you have the garment in hand.'}
          </p>
        </div>
      </header>

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      {item && <SourceCard item={item} onProposal={onProposal} />}

      <Card title={item?.kind === 'photo' ? 'More photos' : 'Photos'}>
        <p className="hint">Lay the piece flat or hang it up, with nothing else in the shot. Photos are shrunk and kept on this phone.</p>
        <ul className="photo-strip">
          {keptPhotos.map((photo, i) => (
            <li key={photo.id}>
              <StoredImage bytes={photo.thumb} mimeType={photo.mimeType} alt={`Photo ${i + 1}`} className="photo-thumb" />
              <button type="button" className="photo-remove" aria-label={`Remove photo ${i + 1}`} onClick={() => setRemovedPhotoIds((ids) => [...ids, photo.id])}>
                Remove
              </button>
            </li>
          ))}
          {addedPhotos.map((photo, i) => (
            <li key={`new-${i}`}>
              <StoredImage bytes={photo.thumb} mimeType={photo.mimeType} alt={`New photo ${i + 1}`} className="photo-thumb" />
              <button
                type="button"
                className="photo-remove"
                aria-label={`Remove new photo ${i + 1}`}
                onClick={() => setAddedPhotos((current) => current.filter((_, index) => index !== i))}
              >
                Remove
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="photo-add" disabled={photoBusy} onClick={() => fileInput.current?.click()}>
              {photoBusy ? 'Adding' : 'Add photo'}
            </button>
          </li>
        </ul>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          aria-label="Choose photos"
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </Card>

      <Card title="Basics">
        <TextField label="Name" mark={mark('name')} value={form.name} onChange={(v) => set('name', v)} placeholder="Burgundy cable-knit crewneck" required />
        <TextField label="Brand" mark={mark('brand')} value={form.brand} onChange={(v) => set('brand', v)} />
        <Chips label="Status" options={STATUSES} value={form.status} allowClear={false} onChange={(v) => v && set('status', v)} />
        <MultiChips
          label="Where it goes in an outfit"
          mark={mark('slots')}
          hint="Pick more than one if it does two jobs, such as a tee worn alone or under a knit."
          options={SLOTS}
          value={form.slots}
          onChange={(v) => set('slots', v)}
        />
      </Card>

      <Card title="Color and texture">
        <Chips label="Color family" mark={mark('colorFamily')} options={COLOR_FAMILIES} value={form.colorFamily} onChange={(v) => set('colorFamily', v)} />
        <Chips label="Light or dark" mark={mark('depth')} options={DEPTHS} value={form.depth} onChange={(v) => set('depth', v)} />
        <TextField label="The maker's name for the color" mark={mark('colorName')} value={form.colorName} onChange={(v) => set('colorName', v)} placeholder="Coffee" />
        <Chips
          label="Texture"
          mark={mark('texture')}
          hint="Smooth: fine knit, poplin, polished leather. Rough: cable knit, suede, corduroy, heavy twill."
          options={TEXTURES}
          value={form.texture}
          onChange={(v) => set('texture', v)}
        />
      </Card>

      {isTop && (
        <Card title="Shape">
          <Chips label="Neckline" mark={mark('neckline')} options={NECKLINES} value={form.neckline} onChange={(v) => set('neckline', v)} />
          <Chips label="Fit" mark={mark('fit')} options={FITS} value={form.fit} onChange={(v) => set('fit', v)} />
          <Chips label="Where the hem ends" options={HEMS} value={form.hem} onChange={(v) => set('hem', v)} />
        </Card>
      )}

      <Card title="Dress level, cloth and weather">
        <Chips label="Dress level" mark={mark('dressLevel')} hint="How dressy the piece is on its own." options={DRESS_LEVELS} value={form.dressLevel} onChange={(v) => set('dressLevel', v)} />
        <TextField
          label="Cloth"
          mark={mark('cloth')}
          hint="From the care label or the product page. Don't guess it from a photo."
          value={form.cloth}
          onChange={(v) => set('cloth', v)}
          placeholder="100% cotton"
        />
        <Chips label="Hardware color" mark={mark('hardware')} hint="Zips, buttons, buckles." options={HARDWARE} value={form.hardware} onChange={(v) => set('hardware', v)} />
        <Chips label="Warmth" mark={mark('warmth')} options={WARMTHS} value={form.warmth} onChange={(v) => set('warmth', v)} />
        <Chips
          label="Rain or snow"
          mark={mark('wetOk')}
          options={WET_OPTIONS}
          value={form.wetOk === undefined ? undefined : form.wetOk ? 'yes' : 'no'}
          onChange={(v) => set('wetOk', v === undefined ? undefined : v === 'yes')}
        />
      </Card>

      <RuleFindings findings={findings} />

      <Card title="Size and buying">
        <TextField label="Size" value={form.size} onChange={(v) => set('size', v)} placeholder="S" />
        <TextField label="Product page link" type="url" inputMode="url" value={form.link} onChange={(v) => set('link', v)} placeholder="https://" />
        {(form.status === 'considering' || form.listPrice !== '') && (
          <TextField
            label="Price on the page, in dollars"
            mark={mark('price')}
            hint="Saved with today's date, because a price is only as good as its day."
            inputMode="decimal"
            value={form.listPrice}
            onChange={(v) => set('listPrice', v)}
            placeholder="49.90"
          />
        )}
        <TextField label="Price paid, in dollars" inputMode="decimal" value={form.price} onChange={(v) => set('price', v)} placeholder="49.90" />
        <TextField label="Date bought" type="date" value={form.acquiredOn} onChange={(v) => set('acquiredOn', v)} />
      </Card>

      <Card title="Notes and tags">
        <TextField label="Notes" multiline value={form.notes} onChange={(v) => set('notes', v)} />
        <TextField label="Tags" mark={mark('tags')} hint="Your own words, separated by commas." value={form.tagText} onChange={(v) => set('tagText', v)} placeholder="pleated, office" />
        <label className="check">
          <input type="checkbox" checked={form.detailsConfirmed} onChange={(e) => set('detailsConfirmed', e.target.checked)} />
          <span>I have checked these details against the garment</span>
        </label>
      </Card>

      <div className="form-foot">
        <button type="submit" className="btn btn-primary" disabled={saving || photoBusy}>
          {saving ? 'Saving' : editing ? 'Save changes' : 'Add to wardrobe'}
        </button>
      </div>
    </form>
  );
}

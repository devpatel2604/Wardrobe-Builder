import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { processImage, type ProcessedImage } from '../data/images';
import { createPiece, getPiece, listPhotos, updatePiece } from '../data/piecesRepo';
import { getProfile } from '../data/profileRepo';
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
import type { Photo, Piece, PieceDraft, Rule } from '../domain/types';
import { Card, Chips, MultiChips, StoredImage, TextField } from '../ui/controls';
import { RuleFindings } from '../ui/RuleFindings';

/** The form keeps text as typed. It is tidied into a draft on save. */
interface FormState extends Omit<PieceDraft, 'pricePaid' | 'tags' | 'brand' | 'colorName' | 'cloth' | 'size' | 'link' | 'notes' | 'acquiredOn'> {
  brand: string;
  colorName: string;
  cloth: string;
  size: string;
  link: string;
  notes: string;
  acquiredOn: string;
  price: string;
  tagText: string;
}

function blankForm(): FormState {
  return {
    name: '',
    brand: '',
    status: 'owned',
    slots: [],
    colorName: '',
    cloth: '',
    size: '',
    link: '',
    notes: '',
    acquiredOn: '',
    price: '',
    tagText: '',
    // A piece added by hand has been looked at, so it starts as checked.
    detailsConfirmed: true,
  };
}

function formFromPiece(piece: Piece): FormState {
  return {
    name: piece.name,
    brand: piece.brand ?? '',
    status: piece.status,
    slots: piece.slots,
    colorFamily: piece.colorFamily,
    colorName: piece.colorName ?? '',
    depth: piece.depth,
    texture: piece.texture,
    neckline: piece.neckline,
    fit: piece.fit,
    hem: piece.hem,
    dressLevel: piece.dressLevel,
    cloth: piece.cloth ?? '',
    hardware: piece.hardware,
    warmth: piece.warmth,
    wetOk: piece.wetOk,
    size: piece.size ?? '',
    link: piece.link ?? '',
    notes: piece.notes ?? '',
    acquiredOn: piece.acquiredOn ?? '',
    price: piece.pricePaid === undefined ? '' : String(piece.pricePaid),
    tagText: piece.tags.join(', '),
    detailsConfirmed: piece.detailsConfirmed,
  };
}

export function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

function draftFromForm(form: FormState): PieceDraft {
  const isTop = form.slots.some((s) => TOP_SLOTS.includes(s));
  const price = form.price.trim() === '' ? undefined : Number(form.price);
  return {
    name: form.name,
    brand: form.brand,
    status: form.status,
    slots: form.slots,
    colorFamily: form.colorFamily,
    colorName: form.colorName,
    depth: form.depth,
    texture: form.texture,
    // Top-only tags are dropped if the piece is no longer a top.
    neckline: isTop ? form.neckline : undefined,
    fit: isTop ? form.fit : undefined,
    hem: isTop ? form.hem : undefined,
    dressLevel: form.dressLevel,
    cloth: form.cloth,
    hardware: form.hardware,
    warmth: form.warmth,
    wetOk: form.wetOk,
    size: form.size,
    link: form.link,
    notes: form.notes,
    acquiredOn: form.acquiredOn,
    pricePaid: price !== undefined && Number.isFinite(price) && price >= 0 ? price : undefined,
    tags: parseTags(form.tagText),
    detailsConfirmed: form.detailsConfirmed,
  };
}

const WET_OPTIONS = [
  { value: 'yes', label: 'Fine when wet' },
  { value: 'no', label: 'Dry days only' },
];

export function PieceFormScreen() {
  const { id } = useParams();
  const loaded = useLiveQuery(async () => {
    const profile = await getProfile();
    const rules = profile?.rules ?? [];
    if (!id) return { piece: undefined, photos: [] as Photo[], rules };
    const [piece, photos] = await Promise.all([getPiece(id), listPhotos(id)]);
    return { piece, photos, rules };
  }, [id]);

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
  // Keyed by id, so the form is filled once and later live updates never wipe what was typed.
  return <PieceForm key={id ?? 'new'} piece={loaded.piece} photos={loaded.photos} rules={loaded.rules} />;
}

function PieceForm({ piece, photos, rules }: { piece: Piece | undefined; photos: Photo[]; rules: Rule[] }) {
  const navigate = useNavigate();
  const editing = piece !== undefined;
  const [form, setForm] = useState<FormState>(() => (piece ? formFromPiece(piece) : blankForm()));
  const [addedPhotos, setAddedPhotos] = useState<ProcessedImage[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const findings = useMemo(() => checkPiece(form, rules), [form, rules]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const isTop = form.slots.some((s) => TOP_SLOTS.includes(s));
  const keptPhotos = photos.filter((p) => !removedPhotoIds.includes(p.id));
  const backTo = piece ? `/wardrobe/${piece.id}` : '/wardrobe';

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
    setSaving(true);
    setError(undefined);
    try {
      const draft = draftFromForm(form);
      const changes = { add: addedPhotos, remove: removedPhotoIds };
      const saved = piece ? await updatePiece(piece.id, draft, changes) : await createPiece(draft, changes);
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
          <p className="sub">Only the name and where it goes are needed. Fill in the rest when you have the garment in hand.</p>
        </div>
      </header>

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      <Card title="Photos">
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
        <TextField label="Name" value={form.name} onChange={(v) => set('name', v)} placeholder="Burgundy cable-knit crewneck" required />
        <TextField label="Brand" value={form.brand} onChange={(v) => set('brand', v)} />
        <Chips label="Status" options={STATUSES} value={form.status} allowClear={false} onChange={(v) => v && set('status', v)} />
        <MultiChips
          label="Where it goes in an outfit"
          hint="Pick more than one if it does two jobs, such as a tee worn alone or under a knit."
          options={SLOTS}
          value={form.slots}
          onChange={(v) => set('slots', v)}
        />
      </Card>

      <Card title="Color and texture">
        <Chips label="Color family" options={COLOR_FAMILIES} value={form.colorFamily} onChange={(v) => set('colorFamily', v)} />
        <Chips label="Light or dark" options={DEPTHS} value={form.depth} onChange={(v) => set('depth', v)} />
        <TextField label="The maker's name for the color" value={form.colorName} onChange={(v) => set('colorName', v)} placeholder="Coffee" />
        <Chips
          label="Texture"
          hint="Smooth: fine knit, poplin, polished leather. Rough: cable knit, suede, corduroy, heavy twill."
          options={TEXTURES}
          value={form.texture}
          onChange={(v) => set('texture', v)}
        />
      </Card>

      {isTop && (
        <Card title="Shape">
          <Chips label="Neckline" options={NECKLINES} value={form.neckline} onChange={(v) => set('neckline', v)} />
          <Chips label="Fit" options={FITS} value={form.fit} onChange={(v) => set('fit', v)} />
          <Chips label="Where the hem ends" options={HEMS} value={form.hem} onChange={(v) => set('hem', v)} />
        </Card>
      )}

      <Card title="Dress level, cloth and weather">
        <Chips label="Dress level" hint="How dressy the piece is on its own." options={DRESS_LEVELS} value={form.dressLevel} onChange={(v) => set('dressLevel', v)} />
        <TextField
          label="Cloth"
          hint="From the care label or the product page. Don't guess it from a photo."
          value={form.cloth}
          onChange={(v) => set('cloth', v)}
          placeholder="100% cotton"
        />
        <Chips label="Hardware color" hint="Zips, buttons, buckles." options={HARDWARE} value={form.hardware} onChange={(v) => set('hardware', v)} />
        <Chips label="Warmth" options={WARMTHS} value={form.warmth} onChange={(v) => set('warmth', v)} />
        <Chips
          label="Rain or snow"
          options={WET_OPTIONS}
          value={form.wetOk === undefined ? undefined : form.wetOk ? 'yes' : 'no'}
          onChange={(v) => set('wetOk', v === undefined ? undefined : v === 'yes')}
        />
      </Card>

      <RuleFindings findings={findings} />

      <Card title="Size and buying">
        <TextField label="Size" value={form.size} onChange={(v) => set('size', v)} placeholder="S" />
        <TextField label="Product page link" type="url" inputMode="url" value={form.link} onChange={(v) => set('link', v)} placeholder="https://" />
        <TextField label="Price paid, in dollars" inputMode="decimal" value={form.price} onChange={(v) => set('price', v)} placeholder="49.90" />
        <TextField label="Date bought" type="date" value={form.acquiredOn} onChange={(v) => set('acquiredOn', v)} />
      </Card>

      <Card title="Notes and tags">
        <TextField label="Notes" multiline value={form.notes} onChange={(v) => set('notes', v)} />
        <TextField label="Tags" hint="Your own words, separated by commas." value={form.tagText} onChange={(v) => set('tagText', v)} placeholder="pleated, office" />
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

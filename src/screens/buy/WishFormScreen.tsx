import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createWish, updateWish, type WishDraft } from '../../data/wishlistRepo';
import type { WishItem, WishOrigin } from '../../domain/buyNext/types';
import {
  COLOR_FAMILIES,
  DEPTHS,
  DRESS_LEVELS,
  FITS,
  HARDWARE,
  HEMS,
  NECKLINES,
  SLOTS,
  TEXTURES,
  TOP_SLOTS,
  WARMTHS,
  type Option,
} from '../../domain/options';
import { checkPiece } from '../../domain/ruleChecks';
import type { LookSource, Profile, Slot } from '../../domain/types';
import { Card, Chips, MultiChips, TextField } from '../../ui/controls';
import { RuleFindings } from '../../ui/RuleFindings';
import { useBuyData } from './buyData';

/** Places in an outfit the score can count. A watch or a fragrance makes no outfits. */
const WISH_SLOTS = SLOTS.filter((s) => (['main-top', 'under-layer', 'trousers', 'shoes', 'outer-layer', 'belt'] as Slot[]).includes(s.value));

const ORIGINS: Option<WishOrigin>[] = [
  { value: 'your-looks', label: 'From your saved looks' },
  { value: 'beyond-looks', label: 'Beyond your looks' },
];

const BEYOND: Option<Exclude<LookSource, 'your-looks' | 'test'>>[] = [
  { value: 'suits-you', label: 'Suits you' },
  { value: 'in-season', label: 'In season' },
  { value: 'similar-creators', label: 'Creators like yours' },
];

const WET: Option<'yes' | 'no'>[] = [
  { value: 'yes', label: 'Fine when wet' },
  { value: 'no', label: 'Dry days only' },
];

interface FormState {
  name: string;
  lookFor: string;
  why: string;
  spec: WishItem['spec'];
  tagText: string;
  origin: WishOrigin;
  beyondSource: WishItem['beyondSource'];
  sizeLabel: string | undefined;
  wears: string;
  holdUntil: string;
  holdReason: string;
}

function startForm(item: WishItem | undefined): FormState {
  return {
    name: item?.name ?? '',
    lookFor: item?.lookFor ?? '',
    why: item?.why ?? '',
    spec: item?.spec ?? { slots: [], tags: [] },
    tagText: item?.spec.tags.join(', ') ?? '',
    origin: item?.origin ?? 'your-looks',
    beyondSource: item?.beyondSource,
    sizeLabel: item?.sizeLabel,
    wears: item?.wearsPerWeek !== undefined ? String(item.wearsPerWeek) : '',
    holdUntil: item?.holdUntil ?? '',
    holdReason: item?.holdReason ?? '',
  };
}

function WishForm({ item, profile }: { item: WishItem | undefined; profile: Profile }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => startForm(item));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setSpec = <K extends keyof FormState['spec']>(key: K, value: FormState['spec'][K]) => setForm((f) => ({ ...f, spec: { ...f.spec, [key]: value } }));
  const isTop = form.spec.slots.some((s) => TOP_SLOTS.includes(s));
  const findings = useMemo(() => checkPiece(form.spec, profile.rules), [form.spec, profile.rules]);
  const sizes: Option<string>[] = profile.sizes.map((s) => ({ value: s.label, label: `${s.label}: ${s.value}` }));
  const backTo = item ? `/buy/${item.id}` : '/buy';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return setError('Give the piece a name.');
    if (form.spec.slots.length === 0) return setError('Pick where the piece goes in an outfit.');
    const wears = form.wears.trim() === '' ? undefined : Number(form.wears);
    if (wears !== undefined && !(wears > 0 && wears <= 7)) return setError('Wears a week should be a number from 1 to 7.');
    setSaving(true);
    setError(undefined);
    const draft: WishDraft = {
      name: form.name,
      lookFor: form.lookFor,
      why: form.why,
      spec: { ...form.spec, tags: form.tagText.split(',') },
      origin: form.origin,
      beyondSource: form.beyondSource,
      sizeLabel: form.sizeLabel,
      wearsPerWeek: wears,
      holdUntil: form.holdUntil,
      holdReason: form.holdReason,
    };
    try {
      const saved = item ? await updateWish(item.id, draft) : await createWish(draft);
      navigate(`/buy/${saved.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The piece could not be saved.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <div className="detail-top">
        <Link className="back" to={backTo}>
          ‹ Cancel
        </Link>
        <button type="submit" className="btn btn-primary btn-small" disabled={saving}>
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>

      <header className="page-head">
        <div>
          <h1>{item ? 'Edit needed piece' : 'Add a needed piece'}</h1>
          <p className="sub">Describe the piece, not a product. The tags are what the ranking counts outfits with, so fill in what you can.</p>
        </div>
      </header>

      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}

      <Card title="The piece">
        <TextField label="Name" value={form.name} onChange={(v) => set('name', v)} placeholder="Grey flannel trousers" required />
        <TextField label="What to look for" hint="Cut, cloth and details, in your own words." multiline value={form.lookFor} onChange={(v) => set('lookFor', v)} />
        <MultiChips label="Where it goes in an outfit" options={WISH_SLOTS} value={form.spec.slots} onChange={(v) => setSpec('slots', v)} />
        {sizes.length > 0 && <Chips label="Which of your sizes applies" options={sizes} value={form.sizeLabel} onChange={(v) => set('sizeLabel', v)} />}
      </Card>

      <Card title="Color and texture">
        <Chips label="Color family" options={COLOR_FAMILIES} value={form.spec.colorFamily} onChange={(v) => setSpec('colorFamily', v)} />
        <Chips label="Light or dark" options={DEPTHS} value={form.spec.depth} onChange={(v) => setSpec('depth', v)} />
        <Chips label="Texture" options={TEXTURES} value={form.spec.texture} onChange={(v) => setSpec('texture', v)} />
      </Card>

      {isTop && (
        <Card title="Shape">
          <Chips label="Neckline" options={NECKLINES} value={form.spec.neckline} onChange={(v) => setSpec('neckline', v)} />
          <Chips label="Fit" options={FITS} value={form.spec.fit} onChange={(v) => setSpec('fit', v)} />
          <Chips label="Where the hem ends" options={HEMS} value={form.spec.hem} onChange={(v) => setSpec('hem', v)} />
        </Card>
      )}

      <Card title="Dress level, cloth and weather">
        <Chips label="Dress level" options={DRESS_LEVELS} value={form.spec.dressLevel} onChange={(v) => setSpec('dressLevel', v)} />
        <TextField label="Cloth you want" value={form.spec.cloth ?? ''} onChange={(v) => setSpec('cloth', v || undefined)} placeholder="Wool flannel" />
        <Chips label="Hardware color" options={HARDWARE} value={form.spec.hardware} onChange={(v) => setSpec('hardware', v)} />
        <Chips label="Warmth" options={WARMTHS} value={form.spec.warmth} onChange={(v) => setSpec('warmth', v)} />
        <Chips
          label="Rain or snow"
          options={WET}
          value={form.spec.wetOk === undefined ? undefined : form.spec.wetOk ? 'yes' : 'no'}
          onChange={(v) => setSpec('wetOk', v === undefined ? undefined : v === 'yes')}
        />
        <TextField label="Tags" hint="Your own words, separated by commas. Words such as jeans, sneaker, boot or coat help tell kinds apart." value={form.tagText} onChange={(v) => set('tagText', v)} />
      </Card>

      <RuleFindings findings={findings} />

      <Card title="Why, and when">
        <Chips label="Where the idea comes from" options={ORIGINS} value={form.origin} allowClear={false} onChange={(v) => v && set('origin', v)} />
        {form.origin === 'beyond-looks' && <Chips label="Which kind" options={BEYOND} value={form.beyondSource} onChange={(v) => set('beyondSource', v)} />}
        <TextField label="Why it is on the list" multiline value={form.why} onChange={(v) => set('why', v)} />
        <TextField label="Wears a week in season" hint="A guess. Used only for the cost-per-wear line." inputMode="decimal" value={form.wears} onChange={(v) => set('wears', v)} />
        <TextField label="Do not suggest before" hint="Leave empty to rank it now." type="date" value={form.holdUntil} onChange={(v) => set('holdUntil', v)} />
        {form.holdUntil && <TextField label="Why it waits" value={form.holdReason} onChange={(v) => set('holdReason', v)} placeholder="White sneakers wait for spring" />}
      </Card>

      <div className="form-foot">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving' : item ? 'Save changes' : 'Add to the list'}
        </button>
      </div>
    </form>
  );
}

export function WishFormScreen() {
  const { id } = useParams();
  const data = useBuyData();
  if (!data) return <div aria-busy="true" />;
  const item = id ? data.wishes.find((w) => w.id === id) : undefined;
  if (id && !item) {
    return (
      <>
        <Link className="back" to="/buy">
          ‹ Buy next
        </Link>
        <p className="empty">That piece is no longer on the list.</p>
      </>
    );
  }
  return <WishForm key={item?.id ?? 'new'} item={item} profile={data.profile} />;
}

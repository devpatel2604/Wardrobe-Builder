import { useState, type FormEvent } from 'react';
import type { OptionDraft } from '../../data/wishlistRepo';
import type { OptionRole, PickupSeen, StockSeen, StoreCheck, WishOption } from '../../domain/buyNext/types';
import type { Option } from '../../domain/options';
import { Chips, TextField } from '../../ui/controls';

const ROLES: Option<OptionRole>[] = [
  { value: 'exact', label: 'Exact item' },
  { value: 'lookalike', label: 'Cheaper lookalike' },
];

const STOCK: Option<StockSeen>[] = [
  { value: 'in-stock', label: 'In stock in my size' },
  { value: 'low-stock', label: 'Low stock' },
  { value: 'sold-out-in-size', label: 'Sold out in my size' },
  { value: 'sold-out', label: 'Sold out' },
  { value: 'no-longer-made', label: 'No longer made' },
];

const PICKUP: Option<PickupSeen>[] = [
  { value: 'today', label: 'Pickup today' },
  { value: 'ship-to-store', label: 'Ships to my store' },
  { value: 'none', label: 'No pickup' },
];

function parsePrice(text: string): number | undefined | 'bad' {
  const trimmed = text.trim().replace(/^\$/, '');
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : 'bad';
}

/** "What did the page say?": one tap-through look, saved with today's date. */
export function CheckForm({
  option,
  size,
  today,
  onSave,
  onCancel,
}: {
  option: WishOption;
  size: string | undefined;
  today: string;
  onSave: (check: StoreCheck) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(String(option.check?.price ?? option.price ?? ''));
  const [sizeSeen, setSizeSeen] = useState(option.check?.size ?? size ?? '');
  const [stock, setStock] = useState<StockSeen | undefined>();
  const [pickup, setPickup] = useState<PickupSeen | undefined>();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parsePrice(price);
    if (parsed === 'bad') return setError('The price should be a number, such as 49.90.');
    setError(undefined);
    await onSave({
      on: today,
      by: 'you',
      price: parsed,
      stock,
      size: stock && sizeSeen.trim() ? sizeSeen.trim() : undefined,
      pickup,
      note: note.trim() || undefined,
    });
  }

  return (
    <form className="buy-form" onSubmit={(e) => void submit(e)} noValidate aria-label={`What you saw for ${option.name}`}>
      <p className="hint">Fill in only what you looked at. It is saved with today's date and replaces the earlier look.</p>
      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}
      <TextField label="Price on the page, in dollars" hint="The price of one item, not a sale banner or a two-for price." inputMode="decimal" value={price} onChange={setPrice} />
      <Chips label="Stock" options={STOCK} value={stock} onChange={setStock} />
      {stock && stock !== 'no-longer-made' && <TextField label="Size you looked at" value={sizeSeen} onChange={setSizeSeen} />}
      <Chips label="Pickup at your store" options={PICKUP} value={pickup} onChange={setPickup} />
      <TextField label="Note" value={note} onChange={setNote} placeholder="Cloth is 80% wool" />
      <div className="row">
        <button type="submit" className="btn btn-primary btn-small">
          Save what I saw
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Add a product under a line, or edit one. */
export function OptionForm({
  option,
  onSave,
  onCancel,
}: {
  option?: WishOption;
  onSave: (draft: OptionDraft) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState<OptionRole>(option?.role ?? 'exact');
  const [name, setName] = useState(option?.name ?? '');
  const [store, setStore] = useState(option?.store ?? '');
  const [url, setUrl] = useState(option?.url ?? '');
  const [price, setPrice] = useState(option?.price !== undefined ? String(option.price) : '');
  const [givesUp, setGivesUp] = useState(option?.givesUp ?? '');
  const [note, setNote] = useState(option?.note ?? '');
  const [nearby, setNearby] = useState(option?.nearby ?? false);
  const [tryOnFirst, setTryOnFirst] = useState(option?.tryOnFirst ?? false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parsePrice(price);
    if (parsed === 'bad') return setError('The price should be a number, such as 49.90.');
    try {
      setError(undefined);
      await onSave({
        role,
        name,
        store,
        url,
        price: parsed,
        priceText: option?.priceText,
        givesUp,
        note,
        nearby,
        tryOnFirst,
        chosen: option?.chosen,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The product could not be saved.');
    }
  }

  return (
    <form className="buy-form" onSubmit={(e) => void submit(e)} noValidate aria-label={option ? `Edit ${option.name}` : 'Add a product'}>
      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}
      <Chips label="What it is" options={ROLES} value={role} allowClear={false} onChange={(v) => v && setRole(v)} />
      <TextField label="Product name" hint="As the store gives it." value={name} onChange={setName} required />
      <TextField label="Store" value={store} onChange={setStore} required />
      <TextField label="Product page link" type="url" inputMode="url" value={url} onChange={setUrl} placeholder="https://" />
      <TextField label="Price, in dollars" inputMode="decimal" value={price} onChange={setPrice} />
      <TextField
        label={role === 'lookalike' ? 'What it gives up against the exact item' : 'How it differs from what you want'}
        value={givesUp}
        onChange={setGivesUp}
      />
      <TextField label="Note" value={note} onChange={setNote} />
      <label className="check">
        <input type="checkbox" checked={nearby} onChange={(e) => setNearby(e.target.checked)} />
        <span>The store is in my mall, so I can try it on</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={tryOnFirst} onChange={(e) => setTryOnFirst(e.target.checked)} />
        <span>Try on first: a fitting-room decision</span>
      </label>
      <div className="row">
        <button type="submit" className="btn btn-primary btn-small">
          {option ? 'Save changes' : 'Add the product'}
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

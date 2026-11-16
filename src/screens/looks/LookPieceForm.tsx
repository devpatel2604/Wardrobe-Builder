import { useState } from 'react';
import type { LookPiece } from '../../domain/looks';
import { COLOR_FAMILIES, DEPTHS, DRESS_LEVELS, FITS, HARDWARE, HEMS, NECKLINES, SLOTS, TEXTURES, TOP_SLOTS } from '../../domain/options';
import type { Slot } from '../../domain/types';
import { Chips, TextField } from '../../ui/controls';

/** A scent cannot be seen in a screenshot, so that slot is left out. */
export const LOOK_SLOTS = SLOTS.filter((s) => s.value !== 'fragrance').map((s) => ({ value: s.value, label: s.label }));

export type PieceFields = Omit<LookPiece, 'id' | 'from'> & { id?: string };

interface FormState extends Omit<PieceFields, 'tags' | 'material' | 'slot'> {
  slot: Slot | undefined;
  material: string;
  tagText: string;
}

function toForm(piece: LookPiece | undefined): FormState {
  if (!piece) return { slot: undefined, description: '', material: '', tagText: '' };
  return { ...piece, material: piece.material ?? '', tagText: piece.tags.join(', ') };
}

/** Adds a piece of a look by hand, or fixes one the screenshot reading proposed. */
export function LookPieceForm({
  piece,
  onSave,
  onCancel,
  onRemove,
}: {
  piece?: LookPiece;
  onSave: (fields: PieceFields) => Promise<void>;
  onCancel: () => void;
  onRemove?: () => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(piece));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const isTop = form.slot !== undefined && TOP_SLOTS.includes(form.slot);

  async function save() {
    if (!form.slot) return setError('Pick where the piece goes in the outfit.');
    if (!form.description.trim()) return setError('Say what the piece is, such as “cream pleated trousers”.');
    setBusy(true);
    setError(undefined);
    try {
      const { tagText, slot, material, ...rest } = form;
      await onSave({ ...rest, slot, material: material.trim() || undefined, tags: tagText.split(',') });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The piece could not be saved.');
      setBusy(false);
    }
  }

  return (
    <div className="look-edit" role="group" aria-label={piece ? `Edit ${piece.description}` : 'Add a piece'}>
      <Chips label="Where it goes" options={LOOK_SLOTS} value={form.slot} allowClear={false} onChange={(v) => set('slot', v)} />
      <TextField label="What it is" hint="Color first, the way you would search for it." value={form.description} onChange={(v) => set('description', v)} placeholder="Cream pleated trousers" />
      <Chips label="Color family" options={COLOR_FAMILIES} value={form.colorFamily} onChange={(v) => set('colorFamily', v)} />
      {isTop && <Chips label="Neckline" options={NECKLINES} value={form.neckline} onChange={(v) => set('neckline', v)} />}
      <TextField label="Tags" hint="Separated by commas. “Pleated” on trousers is the one that matters most." value={form.tagText} onChange={(v) => set('tagText', v)} placeholder="pleated, cable" />
      <details className="more">
        <summary>More details</summary>
        <div className="stack">
          <Chips label="Light or dark" options={DEPTHS} value={form.depth} onChange={(v) => set('depth', v)} />
          <Chips label="Texture" options={TEXTURES} value={form.texture} onChange={(v) => set('texture', v)} />
          {isTop && <Chips label="Fit" options={FITS} value={form.fit} onChange={(v) => set('fit', v)} />}
          {isTop && <Chips label="Where the hem ends" options={HEMS} value={form.hem} onChange={(v) => set('hem', v)} />}
          <TextField label="What it looks like it is made of" hint="A guess from the picture, such as suede or cable knit." value={form.material} onChange={(v) => set('material', v)} />
          <Chips label="Metal color" hint="Zips, buttons, buckles, a watch case." options={HARDWARE} value={form.hardware} onChange={(v) => set('hardware', v)} />
          <Chips label="Dress level" options={DRESS_LEVELS} value={form.dressLevel} onChange={(v) => set('dressLevel', v)} />
        </div>
      </details>
      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>
          {piece ? 'Save piece' : 'Add piece'}
        </button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button type="button" className="link-btn link-danger" disabled={busy} onClick={() => void onRemove()}>
            Remove from the look
          </button>
        )}
      </div>
    </div>
  );
}

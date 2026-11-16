import { useEffect, useId, useRef, type ReactNode } from 'react';
import { EVIDENCE_LABELS, type Option } from '../domain/options';
import type { Evidence } from '../domain/types';

interface ChipsProps<T> {
  label: string;
  hint?: string;
  options: (Option<T> & { swatch?: string })[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  /** When true, tapping the chosen chip again clears it. */
  allowClear?: boolean;
  /** A small label after the name, such as "AI" on a value a model filled in. */
  mark?: ReactNode;
}

/** One choice from a short list, as tappable chips. */
export function Chips<T extends string | number>({ label, hint, options, value, onChange, allowClear = true, mark }: ChipsProps<T>) {
  return (
    <fieldset className="field">
      <legend>
        {label}
        {mark}
      </legend>
      {hint && <p className="hint">{hint}</p>}
      <div className="chips">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              className={on ? 'chip chip-on' : 'chip'}
              aria-pressed={on}
              onClick={() => onChange(on && allowClear ? undefined : o.value)}
            >
              {o.swatch && <span className="dot" style={{ background: o.swatch }} aria-hidden="true" />}
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface MultiChipsProps<T> {
  label: string;
  hint?: string;
  options: Option<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  mark?: ReactNode;
}

/** Any number of choices from a short list. */
export function MultiChips<T extends string | number>({ label, hint, options, value, onChange, mark }: MultiChipsProps<T>) {
  return (
    <fieldset className="field">
      <legend>
        {label}
        {mark}
      </legend>
      {hint && <p className="hint">{hint}</p>}
      <div className="chips">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={String(o.value)}
              type="button"
              className={on ? 'chip chip-on' : 'chip'}
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface TextFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'url' | 'date' | 'number';
  inputMode?: 'text' | 'decimal' | 'url';
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  mark?: ReactNode;
}

export function TextField({ label, hint, value, onChange, type = 'text', inputMode, placeholder, multiline, required, mark }: TextFieldProps) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        {mark}
      </div>
      {hint && <p className="hint">{hint}</p>}
      {multiline ? (
        <textarea id={id} value={value} placeholder={placeholder} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          value={value}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function EvidenceTag({ evidence }: { evidence: Evidence }) {
  return <span className={`tag tag-${evidence}`}>{EVIDENCE_LABELS[evidence]}</span>;
}

/**
 * Shows a photo stored as bytes. The bytes become a temporary URL that is set
 * on the image and freed when the photo changes or leaves the page.
 */
export function StoredImage({ bytes, mimeType, alt, className }: { bytes: ArrayBuffer; mimeType: string; alt: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!img || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [bytes, mimeType]);
  return <img ref={ref} alt={alt} className={className} />;
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

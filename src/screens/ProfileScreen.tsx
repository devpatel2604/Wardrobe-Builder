import { useState, type ReactNode } from 'react';
import { newId } from '../data/db';
import { updateProfile } from '../data/profileRepo';
import { CONFIDENCE_LABELS, RULE_KINDS, WEEKDAYS } from '../domain/options';
import type { Profile, Rule, RuleKind, SizeEntry, StoreEntry } from '../domain/types';
import { Card, EvidenceTag, PageHeader, TextField } from '../ui/controls';

interface SectionProps<T> {
  title: string;
  value: T;
  onSave: (value: T) => Promise<unknown>;
  view: (value: T) => ReactNode;
  edit: (draft: T, setDraft: (next: T) => void) => ReactNode;
}

/** A card that shows part of the profile and switches to a form on Edit. */
function Section<T>({ title, value, onSave, view, edit }: SectionProps<T>) {
  const [draft, setDraft] = useState<T>();
  const [saving, setSaving] = useState(false);

  if (draft === undefined) {
    return (
      <Card
        title={title}
        action={
          <button type="button" className="link-btn" aria-label={`Edit ${title.toLowerCase()}`} onClick={() => setDraft(structuredClone(value))}>
            Edit
          </button>
        }
      >
        {view(value)}
      </Card>
    );
  }

  return (
    <Card title={title}>
      <form
        aria-label={title}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            await onSave(draft);
            setDraft(undefined);
          } finally {
            setSaving(false);
          }
        }}
      >
        {edit(draft, setDraft)}
        <div className="row">
          <button type="submit" className="btn btn-primary btn-small" disabled={saving}>
            Save
          </button>
          <button type="button" className="btn btn-small" onClick={() => setDraft(undefined)}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Nothing({ children }: { children: ReactNode }) {
  return <p className="hint">{children}</p>;
}

function formatFileDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function ProfileScreen({ profile }: { profile: Profile }) {
  const about = { body: profile.body, coloring: profile.coloring, scentNote: profile.scentNote };
  const week = { week: profile.week, home: profile.home };
  const shopping = { stores: profile.stores, budget: profile.budget };
  const aboutIsEmpty = ![...Object.values(profile.body), ...Object.values(profile.coloring), profile.scentNote].some(Boolean);

  return (
    <>
      <PageHeader
        eyebrow="About you"
        title="Profile"
        sub={
          profile.profileFileDate
            ? `Loaded from your profile file dated ${formatFileDate(profile.profileFileDate)}. That file stays the source of truth.`
            : 'Your sizes, your week and your rules. Everything else in the app builds on this.'
        }
      />

      <Section
        title="You"
        value={about}
        onSave={(v) => updateProfile(v)}
        view={(v) =>
          aboutIsEmpty ? (
            <Nothing>Nothing here yet. Add your build, coloring and glasses.</Nothing>
          ) : (
            <dl className="facts">
              <Fact label="Build" value={[v.body.height, v.body.weight, v.body.build].filter(Boolean).join(' · ')} />
              <Fact label="Skin" value={v.coloring.skin} />
              <Fact label="Hair" value={v.coloring.hair} />
              <Fact label="Glasses" value={v.coloring.glasses} />
              <Fact label="Face shape" value={v.coloring.faceShape} />
              <Fact label="Scents" value={v.scentNote} />
            </dl>
          )
        }
        edit={(d, set) => (
          <>
            <TextField label="Height" value={d.body.height} onChange={(x) => set({ ...d, body: { ...d.body, height: x } })} />
            <TextField label="Weight" value={d.body.weight} onChange={(x) => set({ ...d, body: { ...d.body, weight: x } })} />
            <TextField label="Build" value={d.body.build} onChange={(x) => set({ ...d, body: { ...d.body, build: x } })} />
            <TextField label="Skin" multiline value={d.coloring.skin} onChange={(x) => set({ ...d, coloring: { ...d.coloring, skin: x } })} />
            <TextField label="Hair" value={d.coloring.hair} onChange={(x) => set({ ...d, coloring: { ...d.coloring, hair: x } })} />
            <TextField label="Glasses" multiline value={d.coloring.glasses} onChange={(x) => set({ ...d, coloring: { ...d.coloring, glasses: x } })} />
            <TextField label="Face shape" multiline value={d.coloring.faceShape} onChange={(x) => set({ ...d, coloring: { ...d.coloring, faceShape: x } })} />
            <TextField label="Scents you like" multiline value={d.scentNote} onChange={(x) => set({ ...d, scentNote: x })} />
          </>
        )}
      />

      <Section<SizeEntry[]>
        title="Sizes"
        value={profile.sizes}
        onSave={(sizes) => updateProfile({ sizes: sizes.filter((s) => s.label.trim() || s.value.trim()) })}
        view={(sizes) =>
          sizes.length === 0 ? (
            <Nothing>No sizes yet.</Nothing>
          ) : (
            <dl className="facts facts-wide">
              {sizes.map((s) => (
                <Fact key={s.id} label={s.label} value={s.value} />
              ))}
            </dl>
          )
        }
        edit={(sizes, set) => (
          <>
            {sizes.map((s, i) => (
              <div key={s.id} className="edit-row">
                <TextField label={`Item ${i + 1}`} value={s.label} onChange={(x) => set(sizes.map((o) => (o.id === s.id ? { ...o, label: x } : o)))} />
                <TextField label={`Size for ${s.label || `item ${i + 1}`}`} value={s.value} onChange={(x) => set(sizes.map((o) => (o.id === s.id ? { ...o, value: x } : o)))} />
                <button type="button" className="link-btn link-danger" onClick={() => set(sizes.filter((o) => o.id !== s.id))}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="link-btn" onClick={() => set([...sizes, { id: newId(), label: '', value: '' }])}>
              Add a size
            </button>
          </>
        )}
      />

      <Section
        title="Your week"
        value={week}
        onSave={(v) => updateProfile(v)}
        view={(v) => (
          <dl className="facts">
            <Fact label="Office days" value={v.week.officeDays.length ? [...v.week.officeDays].sort().map((d) => WEEKDAYS[d]).join(', ') : 'None set'} />
            <Fact label="Office hours" value={v.week.officeHours} />
            <Fact label="Dress code" value={v.week.dressCode} />
            <Fact label="Also dress for" value={v.week.otherOccasions} />
            <Fact label="Home" value={v.home.town} />
            <Fact label="Pickup" value={v.home.pickup} />
          </dl>
        )}
        edit={(d, set) => (
          <>
            <fieldset className="field">
              <legend>Office days</legend>
              <div className="chips">
                {WEEKDAYS.map((name, day) => {
                  const on = d.week.officeDays.includes(day);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={on ? 'chip chip-on' : 'chip'}
                      aria-pressed={on}
                      onClick={() =>
                        set({ ...d, week: { ...d.week, officeDays: on ? d.week.officeDays.filter((x) => x !== day) : [...d.week.officeDays, day].sort() } })
                      }
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <TextField label="Office hours" value={d.week.officeHours} onChange={(x) => set({ ...d, week: { ...d.week, officeHours: x } })} />
            <TextField label="Dress code" value={d.week.dressCode} onChange={(x) => set({ ...d, week: { ...d.week, dressCode: x } })} />
            <TextField label="Also dress for" value={d.week.otherOccasions} onChange={(x) => set({ ...d, week: { ...d.week, otherOccasions: x } })} />
            <TextField label="Home" hint="A town is enough. It is used for weather later." value={d.home.town} onChange={(x) => set({ ...d, home: { ...d.home, town: x } })} />
            <TextField label="Pickup" multiline value={d.home.pickup} onChange={(x) => set({ ...d, home: { ...d.home, pickup: x } })} />
          </>
        )}
      />

      <Section
        title="Shopping"
        value={shopping}
        onSave={(v) => updateProfile({ budget: v.budget, stores: v.stores.filter((s) => s.name.trim()).map(tidyStore) })}
        view={(v) => (
          <>
            {v.stores.length === 0 ? (
              <Nothing>No stores yet.</Nothing>
            ) : (
              <ul className="plain-list">
                {v.stores.map((s) => (
                  <li key={s.id}>
                    <strong>{s.name}</strong>
                    {s.note && <span className="muted"> · {s.note}</span>}
                  </li>
                ))}
              </ul>
            )}
            {v.budget && (
              <dl className="facts">
                <Fact label="Budget" value={v.budget} />
              </dl>
            )}
          </>
        )}
        edit={(d, set) => (
          <>
            {d.stores.map((s, i) => (
              <div key={s.id} className="edit-row">
                <TextField label={`Store ${i + 1}`} value={s.name} onChange={(x) => set({ ...d, stores: d.stores.map((o) => (o.id === s.id ? { ...o, name: x } : o)) })} />
                <TextField
                  label={`Note for ${s.name || `store ${i + 1}`}`}
                  value={s.note ?? ''}
                  onChange={(x) => set({ ...d, stores: d.stores.map((o) => (o.id === s.id ? { ...o, note: x } : o)) })}
                />
                <button type="button" className="link-btn link-danger" onClick={() => set({ ...d, stores: d.stores.filter((o) => o.id !== s.id) })}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="link-btn" onClick={() => set({ ...d, stores: [...d.stores, { id: newId(), name: '' }] })}>
              Add a store
            </button>
            <TextField label="Budget" multiline value={d.budget} onChange={(x) => set({ ...d, budget: x })} />
          </>
        )}
      />

      <Section<Rule[]>
        title="Rules"
        value={profile.rules}
        onSave={(rules) => updateProfile({ rules: rules.filter((r) => r.text.trim()).map(tidyRule) })}
        view={(rules) =>
          rules.length === 0 ? (
            <Nothing>No rules yet. A hard rule removes an option outright, such as "no leather clothing".</Nothing>
          ) : (
            <>
              {RULE_KINDS.map((kind) => {
                const group = rules.filter((r) => r.kind === kind.value);
                if (group.length === 0) return null;
                return (
                  <div key={kind.value} className="rule-group">
                    <h3>{kind.label}</h3>
                    <p className="hint">{kind.hint}</p>
                    <ul className="rule-list">
                      {group.map((r) => (
                        <li key={r.id}>
                          <p>
                            {r.text} <EvidenceTag evidence={r.evidence} />
                          </p>
                          {r.why && <p className="muted">{r.why}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </>
          )
        }
        edit={(rules, set) => (
          <>
            {RULE_KINDS.map((kind) => (
              <RuleGroupEditor key={kind.value} kind={kind.value} label={kind.label} rules={rules} onChange={set} />
            ))}
          </>
        )}
      />

      <Card title="Colors">
        {profile.palette.length === 0 ? (
          <Nothing>No palette yet. The color photo test will build one from your own ratings.</Nothing>
        ) : (
          <>
            <p className="hint">
              A starting point from stylists' advice, not a tested result. The color photo test will replace it with your own ranking.{' '}
              <EvidenceTag evidence="convention" />
            </p>
            <ul className="palette">
              {profile.palette.map((c) => (
                <li key={c.id}>
                  <span className="swatch" style={{ background: c.swatch }} aria-hidden="true" />
                  <div>
                    <p>
                      <strong>{c.color}</strong> <span className="tag">{CONFIDENCE_LABELS[c.confidence]}</span>
                    </p>
                    <p className="muted">
                      Near the face: {c.nearFace}. Away from it: {c.awayFromFace}.
                    </p>
                    <p className="muted">{c.why}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}

function tidyStore(store: StoreEntry): StoreEntry {
  const note = store.note?.trim();
  return { id: store.id, name: store.name.trim(), ...(note ? { note } : {}) };
}

function tidyRule(rule: Rule): Rule {
  const why = rule.why?.trim();
  const { why: _dropped, ...rest } = rule;
  void _dropped;
  return { ...rest, text: rule.text.trim(), ...(why ? { why } : {}) };
}

function RuleGroupEditor({ kind, label, rules, onChange }: { kind: RuleKind; label: string; rules: Rule[]; onChange: (rules: Rule[]) => void }) {
  const group = rules.filter((r) => r.kind === kind);
  const patch = (id: string, changes: Partial<Rule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  return (
    <div className="rule-group">
      <h3>{label}</h3>
      {group.map((r, i) => (
        <div key={r.id} className="edit-row">
          <TextField label={`${label}, rule ${i + 1}`} multiline value={r.text} onChange={(x) => patch(r.id, { text: x })} />
          <TextField label={`Why, rule ${i + 1}`} value={r.why ?? ''} onChange={(x) => patch(r.id, { why: x })} />
          <button type="button" className="link-btn link-danger" onClick={() => onChange(rules.filter((o) => o.id !== r.id))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...rules, { id: newId(), kind, text: '', evidence: 'your-rule' }])}>
        Add to {label.toLowerCase()}
      </button>
    </div>
  );
}

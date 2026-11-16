import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { aiErrorCode } from '../../data/ai';
import { ServerError } from '../../data/server';
import {
  addOption,
  chooseOption,
  deleteWish,
  dropWish,
  findOptions,
  markBought,
  recordCheck,
  removeOption,
  reopenWish,
  updateOption,
} from '../../data/wishlistRepo';
import type { RankedWish } from '../../domain/buyNext/score';
import type { WishItem, WishOption } from '../../domain/buyNext/types';
import { checkLine, costPerWear, money, monthDay, priceOf, priceText, safeUrl, searchLinks, searchWords, standingOf } from '../../domain/buyNext/wishes';
import { now } from '../../domain/clock';
import { dateKey } from '../../domain/dates';
import { occasionLabel } from '../../domain/outfits/occasions';
import { COLOR_FAMILIES, DRESS_LEVELS, NECKLINES, SLOTS, TEXTURES, WARMTHS, labelOf, type Option } from '../../domain/options';
import { checkPiece } from '../../domain/ruleChecks';
import type { Profile } from '../../domain/types';
import { Card, Chips, TextField } from '../../ui/controls';
import { OutfitLine, ReasonList } from '../../ui/OutfitCard';
import { RuleFindings } from '../../ui/RuleFindings';
import { WishTags } from './BuyNextScreen';
import { leadsRequest, sizeFor, useBuyData, useRanking } from './buyData';
import { CheckForm, OptionForm } from './OptionForms';

/** Why a "find options" tap failed, in words for the owner. The store search links never depend on it. */
export function leadsErrorMessage(error: unknown): string {
  const fallback = 'The store search links below work without it.';
  switch (aiErrorCode(error)) {
    case 'no-ai-key':
      return `AI leads are switched off: your server has no AI key yet. ${fallback}`;
    case 'daily-limit':
      return `Today's AI searches are used up. They start again tomorrow. ${fallback}`;
    case 'refused':
      return `The AI model declined this search. ${fallback}`;
    default:
      if (error instanceof ServerError && error.status === 404) return `Your server does not have AI leads yet. They arrive with its next update. ${fallback}`;
      if (error instanceof ServerError) return `${error.message} ${fallback}`;
      return `The search did not work. Try again. ${fallback}`;
  }
}

function OptionCard({ item, option, profile, today }: { item: WishItem; option: WishOption; profile: Profile; today: string }) {
  const [mode, setMode] = useState<'view' | 'check' | 'edit'>('view');
  const line = checkLine(option, today);
  const price = priceOf(option);
  const perWear = costPerWear(price, item.wearsPerWeek);
  const url = safeUrl(option.url);
  const size = sizeFor(item, profile)?.value;
  const unchecked = option.source === 'ai-lead' && !option.check;

  return (
    <li className="buy-option">
      <p className="row buy-tags">
        <span className="tag">{option.role === 'exact' ? 'Exact item' : 'Lookalike'}</span>
        {unchecked && <span className="tag tag-todo">AI lead, not checked</span>}
        {option.chosen && <span className="tag tag-your-choice">Your pick</span>}
        {option.tryOnFirst && <span className="tag tag-todo">Try on first</span>}
        {option.nearby && <span className="tag">In your mall</span>}
      </p>
      <h3>{option.name}</h3>
      <p>
        {option.store}
        {priceText(option) ? ` · ${priceText(option)}` : ' · no price yet'}
      </p>
      {perWear !== undefined && (
        <p className="muted">
          About {money(Math.round(perWear * 100) / 100)} a wear over a first season, at {item.wearsPerWeek} {item.wearsPerWeek === 1 ? 'wear' : 'wears'} a week. A guess.
        </p>
      )}
      {option.givesUp && (
        <p>
          <strong>{option.role === 'lookalike' ? 'Gives up: ' : 'Differs: '}</strong>
          {option.givesUp}
        </p>
      )}
      {option.note && <p className="muted">{option.note}</p>}
      <p className={line.weak ? 'muted buy-weak' : 'muted'}>{line.text}</p>
      {option.check?.note && <p className="muted">You noted: {option.check.note}</p>}

      {mode === 'view' && (
        <div className="row">
          {url ? (
            <a className="btn btn-primary btn-small" href={url} target="_blank" rel="noopener noreferrer" onClick={() => setMode('check')}>
              Check at the store
            </a>
          ) : (
            <button type="button" className="btn btn-small" onClick={() => setMode('check')}>
              Record what you saw
            </button>
          )}
          {url && (
            <button type="button" className="btn btn-small" onClick={() => setMode('check')}>
              Record what you saw
            </button>
          )}
          <button type="button" className="link-btn" onClick={() => void chooseOption(item.id, option.chosen ? undefined : option.id)}>
            {option.chosen ? 'Not my pick' : 'This is my pick'}
          </button>
          <button type="button" className="link-btn" onClick={() => setMode('edit')}>
            Edit
          </button>
          <button type="button" className="link-btn link-danger" onClick={() => void removeOption(item.id, option.id)} aria-label={`Remove ${option.name}`}>
            Remove
          </button>
        </div>
      )}
      {mode === 'check' && (
        <CheckForm
          option={option}
          size={size}
          today={today}
          onCancel={() => setMode('view')}
          onSave={async (check) => {
            await recordCheck(item.id, option.id, check);
            setMode('view');
          }}
        />
      )}
      {mode === 'edit' && (
        <OptionForm
          option={option}
          onCancel={() => setMode('view')}
          onSave={async (draft) => {
            await updateOption(item.id, option.id, draft);
            setMode('view');
          }}
        />
      )}
    </li>
  );
}

function FindOptions({ item, profile, today }: { item: WishItem; profile: Profile; today: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean }>();
  const links = searchLinks(item, profile.stores);

  async function find() {
    setBusy(true);
    setMessage(undefined);
    try {
      const found = await findOptions(item.id, leadsRequest(item, profile), today);
      const parts = [
        found.added === 0
          ? 'The search brought nothing new.'
          : `Added ${found.added} ${found.added === 1 ? 'lead' : 'leads'}. Each stays marked "AI lead, not checked" until you open its page and record what you see.`,
        found.result.note,
        found.result.dropped > 0 ? `${found.result.dropped} left out: the link was not in the search results, or a lookalike was not cheaper.` : undefined,
      ];
      setMessage({ text: parts.filter(Boolean).join(' '), bad: false });
    } catch (error) {
      setMessage({ text: leadsErrorMessage(error), bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Find products">
      <p className="hint">
        "Find options" asks an AI model to run a web search for this piece and bring back a few links, each exact item with a cheaper lookalike. It reads search results only.
        Nobody opens a store page, so prices and links can be stale or wrong until you check them. It sends the piece, your size, your store names and your rules.
      </p>
      <button type="button" className="btn" disabled={busy} onClick={() => void find()}>
        {busy ? 'Searching, up to a minute' : 'Find options'}
      </button>
      {message && (
        <p className={message.bad ? 'notice notice-bad' : 'notice'} role={message.bad ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {links.length > 0 && (
        <>
          <p className="hint">Or search your stores yourself for "{searchWords(item)}". Each link opens the store's own search.</p>
          <ul className="row buy-links" aria-label="Search your stores">
            {links.map((link) => (
              <li key={link.store}>
                <a className="chip" href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.store}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function BoughtForm({ item, today, onDone }: { item: WishItem; today: string; onDone: () => void }) {
  const pick = standingOf(item).pick;
  const [optionId, setOptionId] = useState<string | undefined>(pick?.id);
  const [price, setPrice] = useState(pick && priceOf(pick) !== undefined ? String(priceOf(pick)) : '');
  const [on, setOn] = useState(today);
  const [returnBy, setReturnBy] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const choices: Option<string>[] = [...item.options.map((o) => ({ value: o.id, label: `${o.name}, ${o.store}` })), { value: '', label: 'Something else' }];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const paid = price.trim() === '' ? undefined : Number(price.trim().replace(/^\$/, ''));
    if (paid !== undefined && !(paid >= 0)) return setError('The price should be a number, such as 49.90.');
    if (returnBy && returnBy < on) return setError('The return-by day is before the day you bought it.');
    setSaving(true);
    try {
      await markBought(item.id, { on, optionId: optionId || undefined, pricePaid: paid, returnBy: returnBy || undefined });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.');
      setSaving(false);
    }
  }

  return (
    <form className="buy-form" onSubmit={(e) => void submit(e)} noValidate aria-label="Bought it">
      <p className="hint">The piece moves to your wardrobe and the list is ranked again. The fit check waits for you on the Buy next screen.</p>
      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}
      {item.options.length > 0 && <Chips label="Which one" options={choices} value={optionId ?? ''} allowClear={false} onChange={(v) => setOptionId(v || undefined)} />}
      <TextField label="Price paid, in dollars" inputMode="decimal" value={price} onChange={setPrice} />
      <TextField label="Date bought" type="date" value={on} onChange={setOn} />
      <TextField label="Last day it can go back" hint="From the receipt or the store's return page." type="date" value={returnBy} onChange={setReturnBy} />
      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? 'Saving' : 'Move it to my wardrobe'}
      </button>
    </form>
  );
}

function Unlocks({ ranked }: { ranked: RankedWish }) {
  const dry = ranked.inOrder.filter((g) => !g.wet);
  const wet = ranked.inOrder.filter((g) => g.wet);
  const any = ranked.inOrder.some((g) => Math.round(g.added) > 0);
  return (
    <Card title="Outfits it unlocks">
      {any ? (
        <>
          <p className="hint">
            {ranked.rank === 1 ? 'With what you own today.' : 'Counted with what you own and the pieces ranked above it.'} Before and after, for each occasion.
          </p>
          <dl className="facts facts-wide">
            {dry.map((g, i) => {
              const rain = wet[i];
              const rainAdded = rain ? Math.round(rain.added) : 0;
              return (
                <div key={g.occasion}>
                  <dt>{occasionLabel(g.occasion)}</dt>
                  <dd>
                    {Math.round(g.before)} to {Math.round(g.before + g.added)}
                    {rainAdded > 0 ? `, wet days ${Math.round(rain!.before)} to ${Math.round(rain!.before + rain!.added)}` : ''}
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : (
        <p className="hint">
          {ranked.basic ? 'It is worn with outfits you can already make, so it adds no new ones by itself.' : 'None by itself yet. It needs another piece from the list first.'}
        </p>
      )}
      {ranked.examples.length > 0 && (
        <ul className="stack" aria-label="Example outfits">
          {ranked.examples.map((outfit, i) => (
            <li key={i}>
              <OutfitLine outfit={outfit} />
            </li>
          ))}
        </ul>
      )}
      {ranked.needsFirst.length > 0 && <p className="muted">Works best together with: {ranked.needsFirst.map((n) => n.name).join(', ')}.</p>}
    </Card>
  );
}

export function BuyDetailScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const today = dateKey(now());
  const data = useBuyData();
  const ranking = useRanking(data, today);
  const [adding, setAdding] = useState(false);
  const [buying, setBuying] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!data || !ranking) return <div aria-busy="true" />;
  const item = data.wishes.find((w) => w.id === id);
  if (!item) {
    return (
      <>
        <Link className="back" to="/buy">
          ‹ Buy next
        </Link>
        <p className="empty">That piece is no longer on the list.</p>
      </>
    );
  }

  const ranked = ranking.ranked.find((r) => r.item.id === id);
  const held = ranking.held.find((h) => h.item.id === id);
  const blocked = ranking.blocked.find((b) => b.item.id === id);
  const standing = standingOf(item);
  const size = sizeFor(item, data.profile);
  const options = [...item.options].sort((a, b) => Number(b.chosen ?? false) - Number(a.chosen ?? false) || (a.role === b.role ? 0 : a.role === 'exact' ? -1 : 1));
  const spec = item.spec;
  const facts: [string, string | undefined][] = [
    ['Worn as', spec.slots.map((s) => labelOf(SLOTS, s)).join(', ')],
    ['Color', [labelOf(COLOR_FAMILIES, spec.colorFamily), spec.colorName && `"${spec.colorName}"`].filter(Boolean).join(' · ') || undefined],
    ['Texture', labelOf(TEXTURES, spec.texture)],
    ['Neckline', labelOf(NECKLINES, spec.neckline)],
    ['Dress level', labelOf(DRESS_LEVELS, spec.dressLevel)],
    ['Cloth', spec.cloth],
    ['Warmth', labelOf(WARMTHS, spec.warmth)],
    ['Rain or snow', spec.wetOk === undefined ? undefined : spec.wetOk ? 'Fine when wet' : 'Dry days only'],
    ['Your size', size ? `${size.label}: ${size.value}` : undefined],
  ];

  const place =
    item.state === 'bought'
      ? `In your wardrobe${item.bought ? ` since ${monthDay(item.bought.on, today)}` : ''}.`
      : item.state === 'dropped'
        ? 'Taken off the list.'
        : ranked
          ? `Number ${ranked.rank} of ${ranking.ranked.length} on your list.`
          : held
            ? `Waiting. ${held.reason}`
            : blocked
              ? 'Left out of the ranking: it breaks one of your rules.'
              : undefined;

  return (
    <>
      <div className="detail-top">
        <Link className="back" to="/buy">
          ‹ Buy next
        </Link>
        <Link className="btn btn-small" to={`/buy/${item.id}/edit`}>
          Edit
        </Link>
      </div>

      <header className="page-head">
        <div>
          <p className="eyebrow">{item.origin === 'beyond-looks' ? 'Beyond your saved looks' : 'From your saved looks'}</p>
          <h1>{item.name}</h1>
          {place && <p className="sub">{place}</p>}
        </div>
      </header>

      {ranked && <WishTags ranked={ranked} standing={standing} />}
      {standing.text && item.state === 'open' && (
        <p className="notice" role="status">
          {standing.text}
        </p>
      )}
      {blocked && <RuleFindings findings={checkPiece(item.spec, data.profile.rules)} />}

      {item.state === 'bought' && (
        <div className="notice" role="status">
          {item.fitCheck ? (
            <p>
              Fit check on {monthDay(item.fitCheck.on, today)}: {item.fitCheck.verdict === 'tailor' ? 'keep and tailor' : item.fitCheck.verdict}.
            </p>
          ) : (
            <>
              <p>
                Run the fit check when it arrives.{item.bought?.returnBy ? ` It can go back until ${monthDay(item.bought.returnBy, today)}.` : ''}
              </p>
              <Link className="btn btn-small" to={`/buy/${item.id}/fit`}>
                Run the fit check
              </Link>
            </>
          )}
          {item.pieceId && <Link to={`/wardrobe/${item.pieceId}`}>See it in your wardrobe</Link>}
        </div>
      )}

      <Card title="Why it is on the list">
        {item.why && <p>{item.why}</p>}
        {ranked && <ReasonList reasons={ranked.reasons} label="Why it ranks here" />}
        {!item.why && !ranked && <p className="hint">No reason was written down.</p>}
      </Card>

      <Card title="What to look for">
        {item.lookFor && <p>{item.lookFor}</p>}
        <dl className="facts">
          {facts
            .filter((f): f is [string, string] => Boolean(f[1]))
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      </Card>

      {ranked && <Unlocks ranked={ranked} />}

      <Card
        title="Products"
        action={
          !adding && (
            <button type="button" className="link-btn" onClick={() => setAdding(true)}>
              Add a product
            </button>
          )
        }
      >
        {options.length === 0 && !adding && <p className="hint">Nothing under it yet. Search your stores below, or add a product you found.</p>}
        {options.length > 0 && (
          <ul className="buy-options">
            {options.map((option) => (
              <OptionCard key={option.id} item={item} option={option} profile={data.profile} today={today} />
            ))}
          </ul>
        )}
        {adding && (
          <OptionForm
            onCancel={() => setAdding(false)}
            onSave={async (draft) => {
              await addOption(item.id, draft, today);
              setAdding(false);
            }}
          />
        )}
      </Card>

      {item.state === 'open' && <FindOptions item={item} profile={data.profile} today={today} />}

      {item.state === 'open' && (
        <Card title="Bought it?">
          {buying ? (
            <BoughtForm item={item} today={today} onDone={() => navigate('/buy')} />
          ) : (
            <>
              <p className="hint">The app never buys anything and never fills a cart. Tell it once you have bought the piece yourself.</p>
              <button type="button" className="btn btn-primary" onClick={() => setBuying(true)}>
                Bought it
              </button>
            </>
          )}
        </Card>
      )}

      <div className="danger-zone">
        {item.state === 'open' && (
          <button type="button" className="btn btn-quiet-danger" onClick={() => void dropWish(item.id).then(() => navigate('/buy'))}>
            Take it off the list
          </button>
        )}
        {item.state === 'dropped' && (
          <>
            <button type="button" className="btn" onClick={() => void reopenWish(item.id)}>
              Put it back on the list
            </button>
            {confirmingDelete ? (
              <button type="button" className="btn btn-danger" onClick={() => void deleteWish(item.id).then(() => navigate('/buy'))}>
                Yes, delete it for good
              </button>
            ) : (
              <button type="button" className="btn btn-quiet-danger" onClick={() => setConfirmingDelete(true)}>
                Delete it
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

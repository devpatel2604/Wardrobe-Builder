import { Link } from 'react-router-dom';
import { reopenWish } from '../../data/wishlistRepo';
import type { RankedWish } from '../../domain/buyNext/score';
import type { WishItem, WishOption } from '../../domain/buyNext/types';
import { checkLine, money, monthDay, priceText, standingOf, type WishStanding } from '../../domain/buyNext/wishes';
import { now } from '../../domain/clock';
import { dateKey } from '../../domain/dates';
import { swatchOf } from '../../domain/options';
import { Card, EvidenceTag, PageHeader } from '../../ui/controls';
import { outfitsAdded, priceToPay, useBuyData, useRanking } from './buyData';

/** The short labels on a line: why it is here and what it adds. */
export function WishTags({ ranked, standing }: { ranked: RankedWish; standing: WishStanding }) {
  const finished = ranked.looks.filter((l) => l.missing === 1).length;
  const known = new Set(ranked.looks.map((l) => l.formula.id));
  const inLooks = ranked.looks.length + (ranked.item.lookIds ?? []).filter((id) => !known.has(`saved-look:${id}`) && !known.has(id)).length;
  const added = outfitsAdded(ranked);
  return (
    <p className="row buy-tags">
      {standing.status === 'wait' && <span className="tag tag-todo">Wait</span>}
      {standing.status === 'try-on-first' && <span className="tag tag-todo">Try on first</span>}
      {standing.exactGone && <span className="tag tag-todo">Exact item no longer made</span>}
      {ranked.fillsGap && <span className="tag tag-your-rule">Fills a gap</span>}
      {finished > 0 ? (
        <span className="tag tag-your-rule">{finished === 1 ? 'Finishes a saved look' : `Finishes ${finished} saved looks`}</span>
      ) : (
        inLooks > 0 && <span className="tag">{inLooks === 1 ? 'In a saved look' : `In ${inLooks} saved looks`}</span>
      )}
      {ranked.item.origin === 'beyond-looks' && <span className="tag tag-stretch">Beyond your looks</span>}
      {added > 0 && <span className="tag">{`+${added} ${added === 1 ? 'outfit' : 'outfits'}`}</span>}
    </p>
  );
}

/** One product in a line: what it is, where, the price, and when it was last looked at. */
export function OptionLine({ option, today }: { option: WishOption; today: string }) {
  const price = priceText(option);
  const line = checkLine(option, today);
  return (
    <div className="buy-option-line">
      <p>
        <strong>{option.role === 'exact' ? 'Exact: ' : 'Lookalike: '}</strong>
        {option.name}, {option.store}
        {price ? `, ${price}` : ''}
      </p>
      <p className={line.weak ? 'muted buy-weak' : 'muted'}>{line.text}</p>
    </div>
  );
}

function RankedCard({ ranked, today, total, unpriced }: { ranked: RankedWish; today: string; total: number; unpriced: number }) {
  const { item } = ranked;
  const standing = standingOf(item);
  const pick = standing.pick;
  const lookalike = item.options.find((o) => o.role === 'lookalike' && o !== pick);
  const reason = ranked.reasons[0];
  return (
    <li>
      <Link className="card buy-card" to={`/buy/${item.id}`} aria-label={`${ranked.rank}. ${item.name}`}>
        <div className="buy-card-head">
          <span className="buy-rank" aria-hidden="true">
            {ranked.rank}
          </span>
          <span className="dot dot-big" style={{ background: swatchOf(item.spec.colorFamily) }} aria-hidden="true" />
          <h2>{item.name}</h2>
        </div>
        <WishTags ranked={ranked} standing={standing} />
        {reason && (
          <p>
            {reason.text} {reason.evidence && <EvidenceTag evidence={reason.evidence} />}
          </p>
        )}
        {standing.text && <p className="buy-standing">{standing.text}</p>}
        {pick && <OptionLine option={pick} today={today} />}
        {lookalike && <OptionLine option={lookalike} today={today} />}
        {!pick && item.options.length === 0 && <p className="muted">No product under it yet. Open it to search your stores.</p>}
        <p className="muted buy-total">
          Running total so far: {money(total)}
          {unpriced > 0 ? ` (${unpriced} above ${unpriced === 1 ? 'has' : 'have'} no price yet)` : ''}
        </p>
      </Link>
    </li>
  );
}

function QuietList({ title, hint, rows }: { title: string; hint?: string; rows: { item: WishItem; text?: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <Card title={title}>
      {hint && <p className="hint">{hint}</p>}
      <ul className="plain-list buy-quiet">
        {rows.map(({ item, text }) => (
          <li key={item.id}>
            <Link to={`/buy/${item.id}`}>{item.name}</Link>
            {text && <p className="muted">{text}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function BuyNextScreen() {
  const today = dateKey(now());
  const data = useBuyData();
  const ranking = useRanking(data, today);

  if (!data || !ranking) return <div aria-busy="true" />;

  const open = data.wishes.filter((w) => w.state === 'open');
  const bought = data.wishes.filter((w) => w.state === 'bought');
  const dropped = data.wishes.filter((w) => w.state === 'dropped');
  const toFit = bought.filter((w) => !w.fitCheck);

  let total = 0;
  let unpriced = 0;
  const rows = ranking.ranked.map((ranked) => {
    const price = priceToPay(ranked.item);
    if (price === undefined) unpriced += 1;
    else total += price;
    return { ranked, total, unpriced };
  });

  return (
    <>
      <PageHeader
        eyebrow="What to buy"
        title="Buy next"
        sub={
          open.length === 0
            ? 'Nothing on the list yet.'
            : `${open.length} ${open.length === 1 ? 'piece' : 'pieces'} on the list, in the order to buy them. The order comes from the outfits each one adds.`
        }
        action={
          <Link className="btn btn-primary btn-small" to="/buy/new">
            Add a piece
          </Link>
        }
      />

      {toFit.map((item) => (
        <div key={item.id} className="notice" role="status">
          <p>
            <strong>{item.name}:</strong> run the fit check when it arrives.
            {item.bought?.returnBy ? ` It can go back until ${monthDay(item.bought.returnBy, today)}.` : ''}
          </p>
          <Link className="btn btn-small" to={`/buy/${item.id}/fit`}>
            Run the fit check
          </Link>
        </div>
      ))}

      {data.wishes.length === 0 && (
        <p className="empty">
          The list holds pieces you need, described as a spec and not as a product. Add one here, or load a setup file that carries a list in Settings.
        </p>
      )}

      {ranking.nothingWorthBuying && (
        <div className="notice" role="status">
          <p>
            <strong>Nothing worth buying right now.</strong> No piece on the list adds enough to earn its place. The list is still below, in order.
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <ol className="buy-list" aria-label="Buy in this order">
          {rows.map((row) => (
            <RankedCard key={row.ranked.item.id} ranked={row.ranked} today={today} total={row.total} unpriced={row.unpriced} />
          ))}
        </ol>
      )}

      <QuietList
        title="Waiting"
        hint="Not ranked until their time comes."
        rows={ranking.held.map((h) => ({ item: h.item, text: h.reason }))}
      />
      <QuietList
        title="Breaks one of your rules"
        hint="Left out of the ranking. Change the piece, or take it off the list."
        rows={ranking.blocked.map((b) => ({ item: b.item, text: b.findings.map((f) => f.rule).join('. ') }))}
      />
      <QuietList
        title="Bought"
        rows={bought.map((item) => ({
          item,
          text: `${item.bought ? `Bought ${monthDay(item.bought.on, today)}. ` : ''}${
            item.fitCheck ? `Fit check: ${item.fitCheck.verdict === 'tailor' ? 'keep and tailor' : item.fitCheck.verdict}.` : 'Fit check still to do.'
          }`,
        }))}
      />
      {dropped.length > 0 && (
        <Card title="Taken off the list">
          <ul className="plain-list buy-quiet">
            {dropped.map((item) => (
              <li key={item.id} className="edit-row">
                <Link to={`/buy/${item.id}`}>{item.name}</Link>
                <button type="button" className="link-btn" onClick={() => void reopenWish(item.id)}>
                  Put back
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

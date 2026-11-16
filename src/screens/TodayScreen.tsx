import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { logNotToday, logWore, setRating, setReason, undoEntry } from '../data/outfitLogRepo';
import { setManualWeather } from '../data/planRepo';
import { now } from '../domain/clock';
import { addDays, dateKey, isDateKey, longDay } from '../domain/dates';
import { evaluate, recommend, type EngineInput } from '../domain/outfits/engine';
import { OCCASIONS, forOccasion } from '../domain/outfits/occasions';
import type { OutfitLogEntry, Rating, SkipReason, TempBand } from '../domain/outfits/records';
import type { Candidate, DayWeather, Occasion, OutfitPick } from '../domain/outfits/types';
import type { Option } from '../domain/options';
import type { Piece } from '../domain/types';
import { TEMP_BANDS } from '../domain/weather';
import { Card, PageHeader } from '../ui/controls';
import { OutfitLine, OutfitPieces, ReasonList, SourceTag } from '../ui/OutfitCard';
import { useForecast, type ForecastState } from '../ui/useForecast';
import { hoursFor, isOccasion, occasionsOn, outfitFromIds, useOutfitData, weatherFor, type OutfitData } from './outfitData';

const SKIP_REASONS: Option<SkipReason>[] = [
  { value: 'too-formal', label: 'Too formal' },
  { value: 'too-casual', label: 'Too casual' },
  { value: 'too-warm', label: 'Too warm' },
  { value: 'too-cold', label: 'Too cold' },
  { value: 'colors', label: 'Colors' },
  { value: 'fit', label: 'Fit' },
  { value: 'not-feeling-it', label: 'Not feeling it' },
];

const RATINGS: Option<Rating>[] = [
  { value: 'loved', label: 'Loved it' },
  { value: 'fine', label: 'Fine' },
  { value: 'no', label: 'No' },
];

type SwapSlot = 'mainTop' | 'trousers' | 'shoes';
const SWAP_SLOTS: Option<SwapSlot>[] = [
  { value: 'mainTop', label: 'Top' },
  { value: 'trousers', label: 'Trousers' },
  { value: 'shoes', label: 'Shoes' },
];

/** Slots a "build around this piece" outfit can start from. */
const BUILD_SLOTS = ['main-top', 'trousers', 'shoes', 'outer-layer'] as const;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Which day to open on. From 6 pm the next day's outfit is the useful one,
 * since the office day starts early, unless this evening still has plans.
 */
function openingDate(today: string, data: OutfitData): string {
  const tomorrow = addDays(today, 1);
  const eveningPlans = occasionsOn(today, data).some((o) => o === 'going-out' || o === 'date');
  return now().getHours() >= 18 && !eveningPlans && occasionsOn(tomorrow, data).length > 0 ? tomorrow : today;
}

export function TodayScreen() {
  const today = dateKey(now());
  const data = useOutfitData(today);
  const forecast = useForecast(data?.profile.home.point);
  const [params, setParams] = useSearchParams();

  if (!data) return <div aria-busy="true" />;

  const paramDate = params.get('date');
  const date = isDateKey(paramDate) ? paramDate : openingDate(today, data);
  const planned = occasionsOn(date, data);
  const paramOccasion = params.get('occasion');
  const occasion: Occasion = isOccasion(paramOccasion) ? paramOccasion : (planned[0] ?? 'casual');
  const around = data.pieces.find((p) => p.id === params.get('around') && p.status === 'owned');

  const go = (next: { date?: string; occasion?: Occasion; around?: string | null }) => {
    const query = new URLSearchParams();
    query.set('date', next.date ?? date);
    query.set('occasion', next.occasion ?? occasion);
    const pin = next.around === undefined ? around?.id : next.around;
    if (pin) query.set('around', pin);
    setParams(query, { replace: true });
  };

  const tomorrow = addDays(today, 1);
  const title = date === today ? 'Today' : date === tomorrow ? 'Tomorrow' : longDay(date);

  return (
    <>
      {date !== today && date !== tomorrow && (
        <Link className="back" to="/week">
          ‹ Week
        </Link>
      )}
      <PageHeader eyebrow={date === today || date === tomorrow ? longDay(date) : 'What to wear'} title={title} />

      <div className="segmented" role="group" aria-label="Which day">
        <button type="button" aria-pressed={date === today} onClick={() => go({ date: today, occasion: occasionsOn(today, data)[0] ?? 'casual' })}>
          Today
        </button>
        <button type="button" aria-pressed={date === tomorrow} onClick={() => go({ date: tomorrow, occasion: occasionsOn(tomorrow, data)[0] ?? 'casual' })}>
          Tomorrow
        </button>
      </div>

      <div className="chips chips-scroll" role="group" aria-label="Occasion">
        {OCCASIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === occasion ? 'chip chip-on' : 'chip'}
            aria-pressed={o.value === occasion}
            aria-label={planned.includes(o.value) ? `${o.label} (planned)` : undefined}
            onClick={() => go({ occasion: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <Outfits
        // A new day, occasion or starting piece starts the choices over.
        key={`${date}|${occasion}|${around?.id ?? ''}`}
        data={data}
        forecast={forecast}
        date={date}
        today={today}
        occasion={occasion}
        planned={planned}
        around={around}
        onAround={(id) => go({ around: id })}
      />
    </>
  );
}

interface OutfitsProps {
  data: OutfitData;
  forecast: ForecastState;
  date: string;
  today: string;
  occasion: Occasion;
  planned: Occasion[];
  around: Piece | undefined;
  onAround: (id: string | null) => void;
}

function Outfits({ data, forecast, date, today, occasion, planned, around, onAround }: OutfitsProps) {
  const { profile, pieces, formulas, covers, log } = data;
  const [chosenKey, setChosenKey] = useState<string>();
  const [swap, setSwap] = useState<{ include: string[] }>();
  const [swapSlot, setSwapSlot] = useState<SwapSlot>();
  const [swapping, setSwapping] = useState(false);
  const [lastSkipId, setLastSkipId] = useState<string>();
  const [choosingPiece, setChoosingPiece] = useState(false);

  const weather = useMemo(() => weatherFor(data, forecast.hours, date, occasion), [data, forecast.hours, date, occasion]);
  const entries = log.filter((e) => e.date === date && e.occasion === occasion);
  const wore = entries.find((e) => e.action === 'wore');
  const lastSkip = entries.find((e) => e.id === lastSkipId);

  const base: EngineInput = useMemo(
    () => ({
      pieces,
      rules: profile.rules,
      palette: profile.palette,
      formulas,
      occasion,
      weather,
      date,
      log,
      skipKeys: log.filter((e) => e.action === 'not-today' && e.date === date && e.occasion === occasion).map((e) => e.outfitKey),
    }),
    [pieces, profile, formulas, occasion, date, log, weather],
  );
  const aroundId = around?.id;
  const result = useMemo(() => recommend({ ...base, include: swap?.include ?? (aroundId ? [aroundId] : undefined) }), [base, swap, aroundId]);

  const picks = [result.main, ...result.alternates].filter((p): p is OutfitPick => p !== undefined);
  const shown = picks.find((p) => p.candidate.key === chosenKey) ?? result.main;
  const others = picks.filter((p) => p !== shown);
  const owned = pieces.filter((p) => p.status === 'owned');
  const always = owned.filter((p) => p.slots.includes('glasses') || p.slots.includes('watch'));
  const future = date > today;

  function swapOptions(slot: SwapSlot, from: Candidate): Candidate[] {
    const keep = SWAP_SLOTS.map((s) => s.value)
      .filter((s) => s !== slot)
      .map((s) => from.outfit[s].id);
    const best = new Map<string, Candidate>();
    for (const candidate of evaluate({ ...base, include: keep, exclude: [from.outfit[slot].id] })) {
      const id = candidate.outfit[slot].id;
      // Offer a piece only when the outfit still passes as well as the one on show does.
      if (candidate.fails.length <= from.fails.length && !best.has(id)) best.set(id, candidate);
    }
    return [...best.values()];
  }

  return (
    <>
      <WeatherLine
        weather={weather}
        forecast={forecast}
        hasPoint={profile.home.point !== undefined}
        date={date}
        planned={planned}
        manual={data.plans.get(date)?.manualWeather}
        window={hoursFor(profile, occasion)}
      />

      {owned.length === 0 && (
        <p className="empty">
          Your wardrobe is empty, so there is nothing to pick from yet. <Link to="/wardrobe/new">Add your first piece.</Link>
        </p>
      )}

      {around && (
        <p className="notice">
          Built around: {around.name}.
          <button type="button" className="link-btn" onClick={() => onAround(null)}>
            Back to all outfits
          </button>
        </p>
      )}

      {wore ? (
        <WornCard entry={wore} pieces={pieces} covers={covers} date={date} today={today} />
      ) : (
        <>
          {lastSkip && <SkipNote entry={lastSkip} onUndo={() => setLastSkipId(undefined)} />}

          {owned.length > 0 && result.gap && (
            <Card title={`Nothing to wear ${forOccasion(occasion)}`}>
              <p>{result.gap.text}</p>
              {result.gap.hint && <p className="muted">{result.gap.hint}</p>}
            </Card>
          )}

          {shown && (
            <section className="card outfit" aria-label="Outfit">
              <header className="card-head">
                <h2>{swap ? 'Your swap' : 'Wear'}</h2>
                <SourceTag candidate={shown.candidate} />
              </header>
              <OutfitPieces outfit={shown.candidate.outfit} covers={covers} />
              {always.length > 0 && <p className="muted">Always with it: {always.map((p) => p.name).join(' · ')}</p>}

              {shown.compromises.length > 0 && (
                <div className="notice">
                  <p>
                    <strong>Not right for the weather:</strong>
                  </p>
                  <ReasonList reasons={shown.compromises} label="What this outfit gives up" />
                </div>
              )}

              <div>
                <h3>Why</h3>
                <ReasonList reasons={shown.reasons} label="Why this outfit" />
                {shown.reasons.length === 0 && <p className="muted">It passes your rules. No scoring rule singled it out.</p>}
              </div>

              {result.headsUp.length > 0 && (
                <div className="notice">
                  <p>
                    <strong>Heads up</strong>
                  </p>
                  <ReasonList reasons={result.headsUp} label="Heads up" />
                </div>
              )}

              <UncheckedNote outfit={shown} />

              <div className="row">
                {!future && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void logWore({ date, occasion, outfit: shown.candidate.outfit }, swap !== undefined)}
                  >
                    Wore it
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  aria-expanded={swapping}
                  onClick={() => {
                    setSwapping(!swapping);
                    setSwapSlot(undefined);
                  }}
                >
                  Swap a piece
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const entry = await logNotToday({ date, occasion, outfit: shown.candidate.outfit });
                    setLastSkipId(entry.id);
                    setChosenKey(undefined);
                    setSwap(undefined);
                    setSwapping(false);
                  }}
                >
                  {future ? 'Not this one' : 'Not today'}
                </button>
              </div>

              {swapping && (
                <div className="stack">
                  <div className="chips" role="group" aria-label="Which piece to swap">
                    {SWAP_SLOTS.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        className={swapSlot === s.value ? 'chip chip-on' : 'chip'}
                        aria-pressed={swapSlot === s.value}
                        onClick={() => setSwapSlot(s.value)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {swapSlot && (
                    <SwapChoices
                      slot={swapSlot}
                      options={swapOptions(swapSlot, shown.candidate)}
                      onPick={(c) => {
                        setSwap({ include: SWAP_SLOTS.map((s) => c.outfit[s.value].id) });
                        setChosenKey(c.key);
                        setSwapping(false);
                        setSwapSlot(undefined);
                      }}
                    />
                  )}
                </div>
              )}

              {swap && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setSwap(undefined);
                    setChosenKey(undefined);
                  }}
                >
                  Back to the picks
                </button>
              )}
            </section>
          )}

          {others.length > 0 && (
            <Card title={others.length === 1 ? 'Alternate' : 'Alternates'}>
              <ul className="alternates">
                {others.map((pick) => (
                  <li key={pick.candidate.key}>
                    <p>
                      <SourceTag candidate={pick.candidate} />
                    </p>
                    <OutfitLine outfit={pick.candidate.outfit} />
                    {pick.reasons[0] && <p className="muted">{pick.reasons[0].text}</p>}
                    {pick.compromises[0] && <p className="muted">Not right for the weather: {pick.compromises.map((c) => c.text).join(' ')}</p>}
                    <button type="button" className="link-btn" onClick={() => setChosenKey(pick.candidate.key)}>
                      Show this one
                    </button>
                  </li>
                ))}
              </ul>
              {!result.hasStretch && !swap && (
                <p className="muted">
                  No stretch pick: none of the looks from beyond your saved ones can be made from what you own {forOccasion(occasion)} on a day like this.
                </p>
              )}
            </Card>
          )}
        </>
      )}

      {owned.length > 0 && !wore && (
        <Card
          title="Build around a piece"
          action={
            <button type="button" className="link-btn" aria-expanded={choosingPiece} onClick={() => setChoosingPiece(!choosingPiece)}>
              {choosingPiece ? 'Close' : 'Choose'}
            </button>
          }
        >
          {choosingPiece ? (
            <div className="chips" role="group" aria-label="Piece to build around">
              {owned
                .filter((p) => p.slots.some((s) => (BUILD_SLOTS as readonly string[]).includes(s)))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={around?.id === p.id ? 'chip chip-on chip-wrap' : 'chip chip-wrap'}
                    aria-pressed={around?.id === p.id}
                    onClick={() => onAround(around?.id === p.id ? null : p.id)}
                  >
                    {p.name}
                  </button>
                ))}
            </div>
          ) : (
            <p className="hint">Pick one piece and the rules fill the other slots around it.</p>
          )}
        </Card>
      )}
    </>
  );
}

function SwapChoices({ slot, options, onPick }: { slot: SwapSlot; options: Candidate[]; onPick: (candidate: Candidate) => void }) {
  if (options.length === 0) return <p className="muted">Nothing else you own passes your rules in its place.</p>;
  return (
    <div className="chips" role="group" aria-label="Swap for">
      {options.map((c) => (
        <button key={c.outfit[slot].id} type="button" className="chip chip-wrap" onClick={() => onPick(c)}>
          {c.outfit[slot].name}
        </button>
      ))}
    </div>
  );
}

function UncheckedNote({ outfit }: { outfit: OutfitPick }) {
  const o = outfit.candidate.outfit;
  const unchecked = [o.mainTop, o.underLayer, o.thirdLayer, o.trousers, o.shoes].filter((p) => p && !p.detailsConfirmed).length;
  if (unchecked === 0) return null;
  return (
    <p className="muted">
      {unchecked === 1 ? 'One of these pieces still needs its' : `${unchecked} of these pieces still need their`} details checked. The pick gets better once
      they are. <Link to="/wardrobe">Open the wardrobe</Link>
    </p>
  );
}

function WornCard({
  entry,
  pieces,
  covers,
  date,
  today,
}: {
  entry: OutfitLogEntry;
  pieces: Piece[];
  covers: OutfitData['covers'];
  date: string;
  today: string;
}) {
  const outfit = outfitFromIds(entry.pieces, pieces);
  return (
    <section className="card outfit" aria-label="Outfit">
      <header className="card-head">
        <h2>{date === today ? 'You wore this today' : 'You wore this'}</h2>
        <span className="tag tag-your-choice">Logged</span>
      </header>
      {outfit ? <OutfitPieces outfit={outfit} covers={covers} /> : <p className="muted">Some pieces of this outfit are no longer in your wardrobe.</p>}
      <div className="chips" role="group" aria-label="How was it?">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            className={entry.rating === r.value ? 'chip chip-on' : 'chip'}
            aria-pressed={entry.rating === r.value}
            onClick={() => void setRating(entry.id, entry.rating === r.value ? undefined : r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <button type="button" className="link-btn" onClick={() => void undoEntry(entry.id)}>
        Undo
      </button>
    </section>
  );
}

function SkipNote({ entry, onUndo }: { entry: OutfitLogEntry; onUndo: () => void }) {
  return (
    <div className="notice" role="status">
      <p>Passed over. Tell the app why, if you like:</p>
      <div className="chips" role="group" aria-label="Why not">
        {SKIP_REASONS.map((r) => (
          <button
            key={r.value}
            type="button"
            className={entry.reason === r.value ? 'chip chip-on' : 'chip'}
            aria-pressed={entry.reason === r.value}
            onClick={() => void setReason(entry.id, entry.reason === r.value ? undefined : r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          void undoEntry(entry.id);
          onUndo();
        }}
      >
        Undo
      </button>
    </div>
  );
}

interface WeatherLineProps {
  weather: DayWeather | undefined;
  forecast: ForecastState;
  hasPoint: boolean;
  date: string;
  planned: Occasion[];
  manual: { band: TempBand; wet: boolean } | undefined;
  window: [number, number];
}

function WeatherLine({ weather, forecast, hasPoint, date, planned, manual, window }: WeatherLineProps) {
  if (weather?.source === 'forecast') {
    return (
      <p className="weather" aria-label="Weather">
        <strong>{weather.summary}</strong>
        <span className="muted">
          National Weather Service{forecast.fetchedAt ? `, read at ${timeOf(forecast.fetchedAt)}` : ''}
          {forecast.failed ? '. A newer forecast could not be loaded.' : ''}
        </span>
      </p>
    );
  }
  const why = !hasPoint
    ? 'No forecast yet: the app has no map point for your town.'
    : forecast.status === 'loading'
      ? 'Loading the forecast.'
      : forecast.status === 'unavailable'
        ? 'The forecast could not be loaded.'
        : `The forecast has nothing for ${window[0] === window[1] ? 'that hour' : 'those hours'}.`;
  const set = (band: TempBand, wet: boolean) => void setManualWeather(date, { band, wet }, planned);
  return (
    <div className="weather" aria-label="Weather">
      <p>
        {weather ? <strong>{weather.summary}</strong> : <strong>No weather set.</strong>} <span className="muted">{why}</span>{' '}
        {!hasPoint && <Link to="/settings">Set it up in Settings</Link>}
      </p>
      {forecast.status !== 'loading' && (
        <>
          <div className="chips chips-scroll" role="group" aria-label="Temperature">
            {TEMP_BANDS.map((b) => (
              <button
                key={b.value}
                type="button"
                className={manual?.band === b.value ? 'chip chip-on' : 'chip'}
                aria-pressed={manual?.band === b.value}
                onClick={() => set(b.value, manual?.wet ?? false)}
              >
                {b.label}
              </button>
            ))}
          </div>
          {manual && (
            <div className="chips" role="group" aria-label="Rain or snow">
              <button type="button" className={!manual.wet ? 'chip chip-on' : 'chip'} aria-pressed={!manual.wet} onClick={() => set(manual.band, false)}>
                Dry
              </button>
              <button type="button" className={manual.wet ? 'chip chip-on' : 'chip'} aria-pressed={manual.wet} onClick={() => set(manual.band, true)}>
                Wet
              </button>
              <button type="button" className="chip" onClick={() => void setManualWeather(date, undefined, planned)}>
                Clear
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { clearPlan, setOccasions } from '../data/planRepo';
import { now } from '../domain/clock';
import { addDays, dateKey, shortDay } from '../domain/dates';
import { NEUTRAL_F, coverage } from '../domain/outfits/coverage';
import { OCCASIONS, occasionLabel } from '../domain/outfits/occasions';
import type { Occasion } from '../domain/outfits/types';
import { planWeek, type PlannedDay, type PlannedOutfit } from '../domain/outfits/week';
import { typicalLow } from '../domain/weather';
import { Card, PageHeader } from '../ui/controls';
import { OutfitLine, SourceTag } from '../ui/OutfitCard';
import { useForecast } from '../ui/useForecast';
import { occasionsOn, outfitFromIds, useOutfitData, weatherFor, type OutfitData } from './outfitData';

const DAYS_AHEAD = 7;

/** One line for the top of the screen when a planned day has a problem. */
function trouble(item: PlannedOutfit): string | undefined {
  const rec = item.recommendation;
  if (!rec) return undefined;
  const text = rec.gap ? [rec.gap.text, rec.gap.hint].filter(Boolean).join(' ') : rec.passing === 0 ? rec.headsUp[0]?.text : undefined;
  return text ? `${shortDay(item.date)}, ${occasionLabel(item.occasion).toLowerCase()}: ${text}` : undefined;
}

export function WeekScreen() {
  const today = dateKey(now());
  const data = useOutfitData(today);
  const forecast = useForecast(data?.profile.home.point);
  const [editing, setEditing] = useState<string>();

  const dates = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i)), [today]);
  const hours = forecast.hours;

  const plan = useMemo(() => {
    if (!data) return undefined;
    const days: PlannedDay[] = dates.map((date) => {
      const occasions = occasionsOn(date, data);
      const weather: PlannedDay['weather'] = {};
      for (const occasion of occasions) weather[occasion] = weatherFor(data, hours, date, occasion);
      return { date, occasions, weather };
    });
    const base = { pieces: data.pieces, rules: data.profile.rules, palette: data.profile.palette, formulas: data.profile.formulas ?? [], log: data.log };
    const tempF = typicalLow(hours, dates);
    return { days, outfits: planWeek(days, base), tempF, grid: coverage({ ...base, date: today }, tempF ?? NEUTRAL_F) };
  }, [data, dates, hours, today]);

  if (!data || !plan) return <div aria-busy="true" />;

  const troubles = plan.outfits.map(trouble).filter((t): t is string => t !== undefined);
  const owned = data.pieces.filter((p) => p.status === 'owned').length;

  return (
    <>
      <PageHeader eyebrow="The next seven days" title="Week" />

      {owned === 0 && (
        <p className="empty">
          Your wardrobe is empty, so there is nothing to plan with yet. <Link to="/wardrobe/new">Add your first piece.</Link>
        </p>
      )}

      {troubles.length > 0 && (
        <div className="notice">
          <p>
            <strong>Heads up for the week</strong>
          </p>
          <ul className="reasons" aria-label="Heads up for the week">
            {troubles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="days">
        {plan.days.map((day) => (
          <li key={day.date} className="card day">
            <header className="card-head">
              <h3>
                {shortDay(day.date)}
                {day.date === today && <span className="tag day-tag">Today</span>}
              </h3>
              <button
                type="button"
                className="link-btn"
                aria-expanded={editing === day.date}
                onClick={() => setEditing(editing === day.date ? undefined : day.date)}
              >
                {editing === day.date ? 'Done' : day.occasions.length === 0 ? 'Add' : 'Change'}
              </button>
            </header>

            {editing === day.date && <DayEditor date={day.date} occasions={day.occasions} hasPlan={data.plans.has(day.date)} />}

            {day.occasions.length === 0 && editing !== day.date && <p className="muted">Nothing planned.</p>}

            {plan.outfits
              .filter((o) => o.date === day.date)
              .map((item) => (
                <DayOutfit key={item.occasion} item={item} data={data} />
              ))}
          </li>
        ))}
      </ul>

      <Card title="Are you covered?">
        <p className="hint">
          How many outfits pass every rule for each occasion.{' '}
          {plan.tempF === undefined
            ? 'Counted without a temperature, because there is no forecast.'
            : `Counted for about ${plan.tempF}°F, the usual low of the days ahead.`}
        </p>
        <table className="coverage">
          <thead>
            <tr>
              <th scope="col">Occasion</th>
              <th scope="col">Dry day</th>
              <th scope="col">Wet or snowy day</th>
            </tr>
          </thead>
          <tbody>
            {plan.grid.map((row) => (
              <tr key={row.occasion}>
                <th scope="row">{occasionLabel(row.occasion)}</th>
                <td className={row.dry === 0 ? 'cell-none' : row.dry < 3 ? 'cell-thin' : undefined}>{row.dry}</td>
                <td className={row.wet === 0 ? 'cell-none' : row.wet < 3 ? 'cell-thin' : undefined}>{row.wet}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {plan.grid.some((row) => row.hint) && (
          <ul className="reasons" aria-label="What would fill the gaps">
            {plan.grid
              .filter((row) => row.hint)
              .map((row) => (
                <li key={row.occasion}>
                  <strong>{occasionLabel(row.occasion)}:</strong> {row.hint}
                </li>
              ))}
          </ul>
        )}
        <p className="muted">The counts use working rules for dress levels and weather. A coat is not counted, since it goes over any outfit.</p>
      </Card>
    </>
  );
}

function DayEditor({ date, occasions, hasPlan }: { date: string; occasions: Occasion[]; hasPlan: boolean }) {
  return (
    <div className="stack">
      <div className="chips" role="group" aria-label={`Occasions on ${shortDay(date)}`}>
        {OCCASIONS.map((o) => {
          const on = occasions.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className={on ? 'chip chip-on' : 'chip'}
              aria-pressed={on}
              onClick={() =>
                void setOccasions(
                  date,
                  on ? occasions.filter((x) => x !== o.value) : OCCASIONS.map((x) => x.value).filter((x) => x === o.value || occasions.includes(x)),
                )
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {hasPlan && (
        <button type="button" className="link-btn" onClick={() => void clearPlan(date)}>
          Back to the usual for this day
        </button>
      )}
    </div>
  );
}

function DayOutfit({ item, data }: { item: PlannedOutfit; data: OutfitData }) {
  const rec = item.recommendation;
  const pick = rec?.main;
  const worn = item.worn ? outfitFromIds(item.worn.pieces, data.pieces) : undefined;
  return (
    <div className="day-outfit">
      <p className="day-occasion">
        <strong>{occasionLabel(item.occasion)}</strong>
        {item.weather && <span className="muted"> · {item.weather.summary}</span>}
      </p>
      {item.worn && (
        <>
          <p>
            <span className="tag tag-your-choice">Worn</span>
          </p>
          {worn ? <OutfitLine outfit={worn} /> : <p className="muted">Some pieces of this outfit are no longer in your wardrobe.</p>}
        </>
      )}
      {pick && (
        <>
          <p>
            <SourceTag candidate={pick.candidate} />
            {pick.compromises.length > 0 && <span className="tag tag-todo">Not right for the weather</span>}
            {item.repeatsTop && <span className="tag tag-todo">Repeats a top</span>}
          </p>
          <OutfitLine outfit={pick.candidate.outfit} />
          {pick.reasons[0] && <p className="muted">{pick.reasons[0].text}</p>}
        </>
      )}
      {rec?.gap && <p className="muted">{rec.gap.text}</p>}
      {!item.worn && (
        <Link className="link-btn" to={`/today?date=${item.date}&occasion=${item.occasion}`}>
          {pick ? 'See the reasons and alternates' : 'Open this day'}
        </Link>
      )}
    </div>
  );
}

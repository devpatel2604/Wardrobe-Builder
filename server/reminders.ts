import type { D1Database, Env, Fetch } from './env';
import { describeMorning, fetchForecast, toMapPoint, type MapPoint } from './forecast';
import { HttpError, json, readJson } from './http';
import { alertPayload, fromBase64Url, getVapidKeys, isPushEndpoint, sendPush, type PushOutcome, type PushSubscription } from './push';

/**
 * The evening reminder: on the evening before an office day the server sends
 * one alert with tomorrow morning's forecast.
 *
 * The server knows the office days, the hour, a time zone and a point on the
 * map. It does not know the wardrobe, so the alert names no outfit. Tapping
 * it opens the app, and the app picks the outfit on the phone.
 */

/** The forecast in the alert is for this hour the next morning. */
const MORNING_HOUR = 7;
/** If sending fails at the chosen hour, the next two hourly runs try again. */
const RETRY_HOURS = 2;
/** The push service keeps an undelivered alert until about the next morning. */
const ALERT_TTL_SECONDS = 12 * 60 * 60;

interface ReminderRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  app_url: string;
  time_zone: string;
  hour: number;
  office_days: string;
  lat: number | null;
  lon: number | null;
  last_sent_on: string | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The date, hour and weekday on the wall clock in a time zone. */
export function localClock(now: Date, timeZone: string): { date: string; hour: number; weekday: number; tomorrow: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const [year, month, day] = [Number(get('year')), Number(get('month')), Number(get('day'))];
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    weekday: WEEKDAYS.indexOf(get('weekday')),
    tomorrow: next.toISOString().slice(0, 10),
  };
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isAppUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function readSubscription(value: unknown): PushSubscription {
  const sub = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const keys = (typeof sub.keys === 'object' && sub.keys !== null ? sub.keys : {}) as Record<string, unknown>;
  if (!isPushEndpoint(sub.endpoint)) throw new HttpError(400, 'That alert address is not from a push service the server knows.');
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw new HttpError(400, 'The alert address is incomplete.');
  try {
    if (fromBase64Url(keys.p256dh).length !== 65 || fromBase64Url(keys.auth).length !== 16) throw new Error();
  } catch {
    throw new HttpError(400, 'The alert address is incomplete.');
  }
  return { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/** PUT /api/reminders: turn the reminder on for this device, or change it. */
export async function putReminder(db: D1Database, request: Request, now: Date): Promise<Response> {
  const body = await readJson(request, 10_000);
  const subscription = readSubscription(body.subscription);
  const days = body.officeDays;
  if (!Array.isArray(days) || days.length > 7 || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    throw new HttpError(400, 'The office days were not usable.');
  }
  const hour = body.hour;
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) throw new HttpError(400, 'The hour was not usable.');
  if (!isTimeZone(body.timeZone)) throw new HttpError(400, 'The time zone was not usable.');
  if (!isAppUrl(body.appUrl)) throw new HttpError(400, 'The app address was not usable.');
  const place = body.place as Record<string, unknown> | null | undefined;
  const point = place ? toMapPoint(place.lat, place.lon) : undefined;

  await db
    .prepare(
      `INSERT INTO reminders (endpoint, p256dh, auth, app_url, time_zone, hour, office_days, lat, lon, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, app_url = ?4, time_zone = ?5, hour = ?6,
         office_days = ?7, lat = ?8, lon = ?9, updated_at = ?10`,
    )
    .bind(
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      body.appUrl,
      body.timeZone,
      hour,
      JSON.stringify([...new Set(days as number[])].sort()),
      point?.lat ?? null,
      point?.lon ?? null,
      now.toISOString(),
    )
    .run();
  return json({ ok: true, forecast: Boolean(point) });
}

/** DELETE /api/reminders: forget one device's alert address, or all of them. */
export async function deleteReminder(db: D1Database, request: Request): Promise<Response> {
  const body = await readJson(request, 5_000).catch(() => ({}) as Record<string, unknown>);
  if (typeof body.endpoint === 'string') await db.prepare(`DELETE FROM reminders WHERE endpoint = ?`).bind(body.endpoint).run();
  else await db.prepare(`DELETE FROM reminders`).run();
  return json({ ok: true });
}

async function send(db: D1Database, fetcher: Fetch, row: ReminderRow, alert: { title: string; body: string; tag: string }, now: Date): Promise<PushOutcome> {
  const keys = await getVapidKeys(db);
  const origin = new URL(row.app_url).origin;
  return sendPush(fetcher, keys, {
    subscription: { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
    payload: alertPayload({ ...alert, navigate: row.app_url }),
    subject: origin,
    ttlSeconds: ALERT_TTL_SECONDS,
    now,
  });
}

/** POST /api/reminders/test: send one alert now, to check that alerts arrive. */
export async function testReminder(db: D1Database, fetcher: Fetch, request: Request, now: Date): Promise<Response> {
  const body = await readJson(request, 5_000);
  const row = await db.prepare(`SELECT * FROM reminders WHERE endpoint = ?`).bind(body.endpoint ?? '').first<ReminderRow>();
  if (!row) throw new HttpError(404, 'Reminders are not turned on for this device.');
  const outcome = await send(db, fetcher, row, { title: 'Test alert', body: 'Alerts from your wardrobe app are working.', tag: 'test' }, now);
  if (!outcome.ok) {
    console.warn('Test alert failed', outcome.status, outcome.detail);
    throw new HttpError(502, `The push service refused the alert (${outcome.status || 'no answer'}).`, { detail: outcome.detail });
  }
  return json({ ok: true });
}

async function morningLine(db: D1Database, fetcher: Fetch, point: MapPoint | undefined, date: string): Promise<string | undefined> {
  if (!point) return undefined;
  try {
    return describeMorning(await fetchForecast(db, fetcher, point), date, MORNING_HOUR);
  } catch (error) {
    // An alert without the weather is better than no alert.
    console.warn('Forecast for the alert failed', error);
    return undefined;
  }
}

/**
 * Runs every hour. Sends the reminder to each device whose own clock says it
 * is the chosen evening hour and tomorrow is an office day.
 */
export async function runReminders(env: Env, now: Date, fetcher: Fetch): Promise<{ sent: number; failed: number }> {
  const rows = await env.DB.prepare(`SELECT * FROM reminders`).all<ReminderRow>();
  let sent = 0;
  let failed = 0;
  for (const row of rows.results) {
    const clock = localClock(now, row.time_zone);
    const officeDays = JSON.parse(row.office_days) as number[];
    const dueHour = clock.hour >= row.hour && clock.hour <= Math.min(row.hour + RETRY_HOURS, 23);
    if (!dueHour || !officeDays.includes((clock.weekday + 1) % 7) || row.last_sent_on === clock.date) continue;

    const point = row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : undefined;
    const weather = await morningLine(env.DB, fetcher, point, clock.tomorrow);
    const alert = {
      title: 'Tomorrow is an office day',
      body: weather ? `${weather}. Tap for your outfit.` : 'Tap for your outfit.',
      tag: `evening-${clock.date}`,
    };
    const outcome = await send(env.DB, fetcher, row, alert, now);
    if (outcome.ok) {
      sent++;
      await env.DB.prepare(`UPDATE reminders SET last_sent_on = ?, last_result = 'sent' WHERE endpoint = ?`).bind(clock.date, row.endpoint).run();
    } else if (outcome.gone) {
      // The phone dropped this address (app deleted, or alerts turned off).
      await env.DB.prepare(`DELETE FROM reminders WHERE endpoint = ?`).bind(row.endpoint).run();
    } else {
      failed++;
      console.warn('Evening alert failed', outcome.status, outcome.detail);
      await env.DB.prepare(`UPDATE reminders SET last_result = ? WHERE endpoint = ?`).bind(`failed ${outcome.status}`, row.endpoint).run();
    }
  }
  return { sent, failed };
}

export async function reminderCount(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM reminders`).first<{ count: number }>();
  return row?.count ?? 0;
}

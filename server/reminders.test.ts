// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Fetch } from './env';
import { describeMorning, toMapPoint } from './forecast';
import { localClock, runReminders } from './reminders';
import { makePhone } from './testPhone';
import { startTestServer, type TestServer } from './testing';

let server: TestServer;
beforeAll(async () => {
  server = await startTestServer();
}, 30_000);
afterAll(() => server.close());
beforeEach(() => server.reset());

/** Made-up forecast in the weather service's own format. */
function weatherService(hours: { startTime: string; temperature: number; chance: number | null; shortForecast: string }[]) {
  return (url: string): Response | undefined => {
    if (url === 'https://api.weather.gov/points/40.01,-75.02') {
      return Response.json({ properties: { forecastHourly: 'https://api.weather.gov/gridpoints/XYZ/10,20/forecast/hourly' } });
    }
    if (url === 'https://api.weather.gov/gridpoints/XYZ/10,20/forecast/hourly') {
      return Response.json({
        properties: {
          periods: hours.map((h) => ({
            startTime: h.startTime,
            temperature: h.temperature,
            temperatureUnit: 'F',
            probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: h.chance },
            shortForecast: h.shortForecast,
          })),
        },
      });
    }
    return undefined;
  };
}

/** A fake network: the weather service above, plus a push service that records what it is sent. */
function network(options: { weather?: (url: string) => Response | undefined; pushStatus?: number } = {}) {
  const pushes: { url: string; init: RequestInit }[] = [];
  const calls: string[] = [];
  const fetcher: Fetch = async (url, init) => {
    calls.push(url);
    if (url.startsWith('https://web.push.apple.com/')) {
      pushes.push({ url, init: init! });
      return new Response(null, { status: options.pushStatus ?? 201 });
    }
    const answer = options.weather?.(url);
    if (answer) return answer;
    throw new Error(`no network for ${url}`);
  };
  return { fetcher, pushes, calls };
}

const phone = makePhone();
const settings = (extra: Record<string, unknown> = {}) => ({
  subscription: { endpoint: phone.subscription.endpoint, keys: { p256dh: phone.subscription.p256dh, auth: phone.subscription.auth } },
  // Office days on Monday and Wednesday, so the alert comes Sunday and Tuesday evening.
  officeDays: [1, 3],
  hour: 20,
  timeZone: 'America/New_York',
  appUrl: 'https://wardrobe.example/',
  place: { lat: 40.0123, lon: -75.0188 },
  ...extra,
});

// Sunday, January 4, 2026, 8 pm in New York (UTC-5 in winter).
const SUNDAY_8PM = new Date('2026-01-05T01:00:00Z');
const hoursLater = (n: number) => new Date(SUNDAY_8PM.getTime() + n * 60 * 60 * 1000);

describe('the wall clock in a time zone', () => {
  it('finds the local date, hour and weekday', () => {
    expect(localClock(SUNDAY_8PM, 'America/New_York')).toEqual({ date: '2026-01-04', hour: 20, weekday: 0, tomorrow: '2026-01-05' });
    expect(localClock(new Date('2026-01-05T05:00:00Z'), 'America/New_York')).toMatchObject({ date: '2026-01-05', hour: 0, weekday: 1 });
    // Summer time: 8 pm is four hours behind UTC, not five.
    expect(localClock(new Date('2026-07-06T00:00:00Z'), 'America/New_York')).toMatchObject({ date: '2026-07-05', hour: 20, weekday: 0 });
    // The end of a month and a year.
    expect(localClock(new Date('2026-12-31T23:30:00Z'), 'America/New_York')).toMatchObject({ date: '2026-12-31', tomorrow: '2027-01-01' });
  });
});

describe('the forecast line', () => {
  const hours = [
    { startTime: '2026-01-05T06:00:00-05:00', temperatureF: 30, precipChance: 0, shortForecast: 'Clear' },
    { startTime: '2026-01-05T07:00:00-05:00', temperatureF: 35, precipChance: 10, shortForecast: 'Mostly Sunny' },
    { startTime: '2026-01-06T07:00:00-05:00', temperatureF: 28, precipChance: 60, shortForecast: 'Light Snow Likely' },
  ];
  it('describes the chosen morning hour', () => {
    expect(describeMorning(hours, '2026-01-05', 7)).toBe('35°F at 7 am, dry');
    expect(describeMorning(hours, '2026-01-06', 7)).toBe('28°F at 7 am, light snow likely (60%)');
    expect(describeMorning(hours, '2026-01-07', 7)).toBeUndefined();
  });
  it('rounds a place to town level', () => {
    expect(toMapPoint(40.51873, -74.41213)).toEqual({ lat: 40.52, lon: -74.41 });
    expect(toMapPoint('40.5', '-74.4')).toEqual({ lat: 40.5, lon: -74.4 });
    expect(toMapPoint(91, 0)).toBeUndefined();
    expect(toMapPoint('', '')).toBeUndefined();
    expect(toMapPoint(undefined, 3)).toBeUndefined();
  });
});

describe('the evening reminder', () => {
  it('sends one alert with the forecast on the evening before an office day', async () => {
    const saved = await server.call('PUT', '/api/reminders', { body: settings() });
    expect(await saved.json()).toEqual({ ok: true, forecast: true });
    const net = network({
      weather: weatherService([
        { startTime: '2026-01-05T06:00:00-05:00', temperature: 33, chance: 0, shortForecast: 'Clear' },
        { startTime: '2026-01-05T07:00:00-05:00', temperature: 35, chance: 5, shortForecast: 'Sunny' },
      ]),
    });

    expect(await runReminders(server.env, SUNDAY_8PM, net.fetcher)).toEqual({ sent: 1, failed: 0 });
    expect(net.pushes).toHaveLength(1);
    expect(net.pushes[0]!.url).toBe(phone.subscription.endpoint);
    expect(JSON.parse(phone.open(net.pushes[0]!.init.body as Uint8Array))).toEqual({
      web_push: 8030,
      notification: {
        title: 'Tomorrow is an office day',
        body: '35°F at 7 am, dry. Tap for your outfit.',
        navigate: 'https://wardrobe.example/',
        tag: 'evening-2026-01-04',
      },
    });
    // Only a rounded point went to the weather service.
    expect(net.calls).toContain('https://api.weather.gov/points/40.01,-75.02');

    // The next hourly runs that evening send nothing more.
    expect(await runReminders(server.env, hoursLater(1), net.fetcher)).toEqual({ sent: 0, failed: 0 });
    expect(net.pushes).toHaveLength(1);
  });

  it('stays quiet at other hours and before days that are not office days', async () => {
    await server.call('PUT', '/api/reminders', { body: settings() });
    const net = network();
    for (const when of [hoursLater(-1), hoursLater(-8), hoursLater(4), hoursLater(24), hoursLater(24 * 3), hoursLater(24 * 5)]) {
      expect(await runReminders(server.env, when, net.fetcher), when.toISOString()).toEqual({ sent: 0, failed: 0 });
    }
    expect(net.calls).toEqual([]);
    // Tuesday evening, before the Wednesday office day, it does send.
    expect(await runReminders(server.env, hoursLater(48), net.fetcher)).toMatchObject({ sent: 1 });
  });

  it('still sends the alert when the weather service is down or no place is set', async () => {
    await server.call('PUT', '/api/reminders', { body: settings() });
    const net = network();
    expect(await runReminders(server.env, SUNDAY_8PM, net.fetcher)).toEqual({ sent: 1, failed: 0 });
    expect(JSON.parse(phone.open(net.pushes[0]!.init.body as Uint8Array)).notification.body).toBe('Tap for your outfit.');

    await server.reset();
    expect(await (await server.call('PUT', '/api/reminders', { body: settings({ place: null }) })).json()).toEqual({ ok: true, forecast: false });
    const quiet = network();
    expect(await runReminders(server.env, SUNDAY_8PM, quiet.fetcher)).toEqual({ sent: 1, failed: 0 });
    expect(quiet.calls).toEqual([phone.subscription.endpoint]);
  });

  it('tries again in the next hour when the push service fails, then gives up for the night', async () => {
    await server.call('PUT', '/api/reminders', { body: settings() });
    const down = network({ pushStatus: 503 });
    expect(await runReminders(server.env, SUNDAY_8PM, down.fetcher)).toEqual({ sent: 0, failed: 1 });
    const up = network();
    expect(await runReminders(server.env, hoursLater(1), up.fetcher)).toEqual({ sent: 1, failed: 0 });

    await server.reset();
    await server.call('PUT', '/api/reminders', { body: settings() });
    expect(await runReminders(server.env, hoursLater(3), up.fetcher)).toEqual({ sent: 0, failed: 0 });
  });

  it('forgets an alert address the phone has dropped', async () => {
    await server.call('PUT', '/api/reminders', { body: settings() });
    expect(await runReminders(server.env, SUNDAY_8PM, network({ pushStatus: 410 }).fetcher)).toEqual({ sent: 0, failed: 0 });
    expect(await server.env.DB.prepare(`SELECT COUNT(*) AS n FROM reminders`).first()).toEqual({ n: 0 });
  });

  it('updates the settings for a device without adding a second row', async () => {
    await server.call('PUT', '/api/reminders', { body: settings() });
    await server.call('PUT', '/api/reminders', { body: settings({ hour: 21, officeDays: [5, 2, 2] }) });
    const rows = await server.env.DB.prepare(`SELECT hour, office_days FROM reminders`).all();
    expect(rows.results).toEqual([{ hour: 21, office_days: '[2,5]' }]);
    expect(((await (await server.call('GET', '/api/status')).json()) as { reminders: number }).reminders).toBe(1);
  });

  it('sends a test alert on request', async () => {
    const net = network();
    const notOn = await server.call('POST', '/api/reminders/test', { body: { endpoint: phone.subscription.endpoint }, fetcher: net.fetcher });
    expect(notOn.status).toBe(404);
    await server.call('PUT', '/api/reminders', { body: settings() });
    const sent = await server.call('POST', '/api/reminders/test', { body: { endpoint: phone.subscription.endpoint }, fetcher: net.fetcher });
    expect(sent.status).toBe(200);
    expect(JSON.parse(phone.open(net.pushes[0]!.init.body as Uint8Array)).notification.title).toBe('Test alert');

    const refused = await server.call('POST', '/api/reminders/test', {
      body: { endpoint: phone.subscription.endpoint },
      fetcher: network({ pushStatus: 403 }).fetcher,
    });
    expect(refused.status).toBe(502);
  });

  it('turns the reminder off', async () => {
    await server.call('PUT', '/api/reminders', { body: settings() });
    expect((await server.call('DELETE', '/api/reminders', { body: { endpoint: phone.subscription.endpoint } })).status).toBe(200);
    const net = network();
    expect(await runReminders(server.env, SUNDAY_8PM, net.fetcher)).toEqual({ sent: 0, failed: 0 });
    expect(net.pushes).toHaveLength(0);
  });

  it('refuses settings it cannot use', async () => {
    const bad = [
      settings({ subscription: { endpoint: 'https://evil.example/x', keys: settings().subscription.keys } }),
      settings({ subscription: { endpoint: phone.subscription.endpoint, keys: { p256dh: 'short', auth: 'short' } } }),
      settings({ officeDays: [7] }),
      settings({ officeDays: 'monday' }),
      settings({ hour: 24 }),
      settings({ hour: 7.5 }),
      settings({ timeZone: 'Mars/Olympus' }),
      settings({ appUrl: 'http://wardrobe.example/' }),
      settings({ appUrl: 'javascript:alert(1)' }),
    ];
    for (const body of bad) expect((await server.call('PUT', '/api/reminders', { body })).status, JSON.stringify(body).slice(0, 120)).toBe(400);
    expect(await server.env.DB.prepare(`SELECT COUNT(*) AS n FROM reminders`).first()).toEqual({ n: 0 });
  });
});

describe('the forecast route', () => {
  it('returns the hours in the shape the app uses', async () => {
    const net = network({
      weather: weatherService([
        { startTime: '2026-01-05T07:00:00-05:00', temperature: 35, chance: null, shortForecast: 'Sunny' },
        { startTime: '2026-01-05T08:00:00-05:00', temperature: 37, chance: 40, shortForecast: 'Chance Rain' },
      ]),
    });
    const response = await server.call('GET', '/api/forecast?lat=40.0123&lon=-75.0188', { fetcher: net.fetcher });
    expect(await response.json()).toEqual({
      point: { lat: 40.01, lon: -75.02 },
      periods: [
        { startTime: '2026-01-05T07:00:00-05:00', temperatureF: 35, precipChance: 0, shortForecast: 'Sunny' },
        { startTime: '2026-01-05T08:00:00-05:00', temperatureF: 37, precipChance: 40, shortForecast: 'Chance Rain' },
      ],
    });
    // The second call reuses the remembered grid square.
    await server.call('GET', '/api/forecast?lat=40.0123&lon=-75.0188', { fetcher: net.fetcher });
    expect(net.calls.filter((url) => url.includes('/points/'))).toHaveLength(1);
  });

  it('says so when the place is missing or the weather service is down', async () => {
    expect((await server.call('GET', '/api/forecast')).status).toBe(400);
    expect((await server.call('GET', '/api/forecast?lat=40&lon=-75', { fetcher: network().fetcher })).status).toBe(502);
  });
});

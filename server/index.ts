import { backupSummary, getPhoto, getSnapshot, listBackup, postSnapshot, putPhoto } from './backup';
import type { Env, Fetch } from './env';
import { getForecast } from './forecast';
import { errorResponse, HttpError, json, requireAppKey, serverIsReady } from './http';
import { getVapidKeys } from './push';
import { deleteReminder, putReminder, reminderCount, runReminders, testReminder } from './reminders';
import { ensureSchema, eraseAll } from './schema';

/**
 * The small server. It does the few things the app cannot do alone on an
 * iPhone: hold an encrypted backup, and send the evening reminder.
 *
 * It never picks an outfit, never reads the backup and never visits a store.
 * If it is down, the app still opens and still works.
 *
 * Every route but /api/health needs the app key.
 */
export async function handleApi(request: Request, env: Env, fetcher: Fetch, now: Date = new Date()): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const route = `${method} ${path}`;

  // Says only that a server is here, so the app can tell this host from a
  // files-only one. Gives away nothing else.
  if (route === 'GET /api/health') return json({ app: 'wardrobe-builder', server: 1, ready: serverIsReady(env) });

  await requireAppKey(request, env);
  const db = env.DB;
  await ensureSchema(db);

  if (route === 'GET /api/status') {
    const [backups, reminders, keys] = await Promise.all([backupSummary(db), reminderCount(db), getVapidKeys(db)]);
    return json({ ok: true, backups, reminders, pushKey: keys.publicKey });
  }

  if (route === 'GET /api/backup') return listBackup(db);
  if (route === 'POST /api/backup/snapshots') return postSnapshot(db, request, now);
  const snapshot = /^\/api\/backup\/snapshots\/([^/]+)$/.exec(path);
  if (snapshot && method === 'GET') return getSnapshot(db, snapshot[1]!);
  const photo = /^\/api\/backup\/photos\/([^/]+)$/.exec(path);
  if (photo && method === 'PUT') return putPhoto(db, photo[1]!, request, now);
  if (photo && method === 'GET') return getPhoto(db, photo[1]!);

  if (route === 'PUT /api/reminders') return putReminder(db, request, now);
  if (route === 'DELETE /api/reminders') return deleteReminder(db, request);
  if (route === 'POST /api/reminders/test') return testReminder(db, fetcher, request, now);

  if (route === 'GET /api/forecast') return getForecast(db, fetcher, url);

  // Erase: backups, alert addresses and the server's own keys.
  if (route === 'DELETE /api/data') {
    await eraseAll(db);
    return json({ ok: true });
  }

  throw new HttpError(404, 'There is nothing at that address.');
}

const outside: Fetch = (input, init) => fetch(input, init);

/** The parts of Cloudflare's scheduled-run objects that the server uses. */
interface ScheduledRun {
  scheduledTime: number;
}
interface RunContext {
  waitUntil(work: Promise<unknown>): void;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, outside);
    } catch (error) {
      return errorResponse(error);
    }
  },

  async scheduled(controller: ScheduledRun, env: Env, ctx: RunContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        if (!serverIsReady(env)) return;
        await ensureSchema(env.DB);
        const result = await runReminders(env, new Date(controller.scheduledTime), outside);
        if (result.sent || result.failed) console.log('Evening reminders', result);
      })(),
    );
  },
};

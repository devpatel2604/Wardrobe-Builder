import type { D1Database } from './env';
/**
 * The server's tables. They are created on first use, so a new deploy needs
 * no separate database step.
 *
 * Everything in `chunks` is text the phone encrypted before sending. The
 * server stores it and hands it back, and cannot read it.
 *
 * Raise SCHEMA_VERSION whenever a table is added, so servers that are
 * already running create it.
 */
const SCHEMA_VERSION = '2';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // One stored item (a photo or a snapshot's contents), cut into rows because
  // a database row may hold at most 2 MB.
  `CREATE TABLE IF NOT EXISTS blobs (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, size INTEGER NOT NULL, chunks INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chunks (
     blob_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (blob_id, seq))`,
  // One backup. photo_ids is a JSON list of the photos it needs.
  `CREATE TABLE IF NOT EXISTS snapshots (
     id TEXT PRIMARY KEY, created_at TEXT NOT NULL, size INTEGER NOT NULL, photo_ids TEXT NOT NULL)`,
  // One row per device that asked for the evening reminder.
  `CREATE TABLE IF NOT EXISTS reminders (
     endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, app_url TEXT NOT NULL,
     time_zone TEXT NOT NULL, hour INTEGER NOT NULL, office_days TEXT NOT NULL, lat REAL, lon REAL,
     last_sent_on TEXT, last_result TEXT, updated_at TEXT NOT NULL)`,
  // Things shared from the iPhone's share menu, until the app collects them.
  `CREATE TABLE IF NOT EXISTS inbox (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, received_at TEXT NOT NULL, url TEXT, title TEXT, body TEXT,
     file_type TEXT, file_size INTEGER NOT NULL DEFAULT 0, file_chunks INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS inbox_chunks (
     item_id TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (item_id, seq))`,
  // How many AI calls were made each day, by kind. Numbers only.
  `CREATE TABLE IF NOT EXISTS ai_usage (
     day TEXT NOT NULL, kind TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
     input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))`,
];

const ready = new WeakMap<D1Database, Promise<void>>();

async function create(db: D1Database): Promise<void> {
  try {
    const row = await db.prepare(`SELECT value FROM config WHERE key = 'schema'`).first<{ value: string }>();
    if (row?.value === SCHEMA_VERSION) return;
  } catch {
    // The table is not there yet: this is the first request after a new deploy.
  }
  await db.batch([
    ...TABLES.map((sql) => db.prepare(sql)),
    db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('schema', ?)`).bind(SCHEMA_VERSION),
  ]);
}

/** Makes sure the tables exist. Costs one small query per server start. */
export function ensureSchema(db: D1Database): Promise<void> {
  let pending = ready.get(db);
  if (!pending) {
    pending = create(db).catch((error) => {
      ready.delete(db);
      throw error;
    });
    ready.set(db, pending);
  }
  return pending;
}

/**
 * Deletes everything the server holds. The empty tables stay.
 * The day's AI counts stay too: they hold no personal data, and clearing
 * them would reset the daily limit.
 */
export async function eraseAll(db: D1Database): Promise<void> {
  await db.batch([
    ...['chunks', 'blobs', 'snapshots', 'reminders', 'inbox', 'inbox_chunks'].map((table) => db.prepare(`DELETE FROM ${table}`)),
    db.prepare(`DELETE FROM config WHERE key <> 'schema'`),
  ]);
}

export async function getConfig(db: D1Database, key: string): Promise<string | undefined> {
  const row = await db.prepare(`SELECT value FROM config WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value;
}

/** Stores a value only if none is there yet, and returns the one that is kept. */
export async function keepConfig(db: D1Database, key: string, value: string): Promise<string> {
  await db.prepare(`INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)`).bind(key, value).run();
  return (await getConfig(db, key)) ?? value;
}

export async function setConfig(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).bind(key, value).run();
}

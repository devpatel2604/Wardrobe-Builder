import type { D1Database } from './env';
import { deleteBlob, getBlob, MAX_BLOB_CHARS, putBlob } from './blobs';
import { HttpError, isId, json, readJson, readText, text } from './http';

/**
 * Encrypted backup. The phone encrypts everything before it uploads, so all
 * the server sees is unreadable text plus a list of ids.
 *
 * A backup is a snapshot (profile, pieces and the rest, as one item) and the
 * photos it points to. Photos are stored once and shared between snapshots,
 * so a daily backup uploads only what is new.
 */

/** How many snapshots the server keeps. Older ones are deleted. */
export const SNAPSHOTS_KEPT = 7;
/** A photo no snapshot points to is deleted once it is this old. */
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_PHOTOS = 5000;

const photoKey = (id: string) => `photo-${id}`;
const snapshotKey = (id: string) => `snap-${id}`;

interface SnapshotRow {
  id: string;
  created_at: string;
  size: number;
  photo_ids: string;
}

async function listPhotoIds(db: D1Database): Promise<string[]> {
  const rows = await db.prepare(`SELECT id FROM blobs WHERE kind = 'photo'`).all<{ id: string }>();
  return rows.results.map((row) => row.id.slice('photo-'.length));
}

/** GET /api/backup: what the server holds. */
export async function listBackup(db: D1Database): Promise<Response> {
  const snapshots = await db
    .prepare(`SELECT id, created_at, size, json_array_length(photo_ids) AS photos FROM snapshots ORDER BY created_at DESC, id DESC`)
    .all<{ id: string; created_at: string; size: number; photos: number }>();
  return json({
    snapshots: snapshots.results.map((row) => ({ id: row.id, createdAt: row.created_at, size: row.size, photos: row.photos })),
    photoIds: await listPhotoIds(db),
  });
}

/** PUT /api/backup/photos/:id, with the encrypted photo as the body. */
export async function putPhoto(db: D1Database, id: string, request: Request, now: Date): Promise<Response> {
  if (!isId(id)) throw new HttpError(400, 'That photo id is not usable.');
  const body = await readText(request, MAX_BLOB_CHARS);
  if (!body) throw new HttpError(400, 'The photo was empty.');
  await putBlob(db, photoKey(id), 'photo', body, now.toISOString());
  return json({ ok: true });
}

/** GET /api/backup/photos/:id */
export async function getPhoto(db: D1Database, id: string): Promise<Response> {
  if (!isId(id)) throw new HttpError(400, 'That photo id is not usable.');
  const body = await getBlob(db, photoKey(id), 'photo');
  if (body === undefined) throw new HttpError(404, 'That photo is not in the backup.');
  return text(body);
}

/**
 * POST /api/backup/snapshots with { data, photoIds }.
 * Photos go up first, so a snapshot is accepted only when every photo it
 * names is already here. That way a stored snapshot can always be restored.
 */
export async function postSnapshot(db: D1Database, request: Request, now: Date): Promise<Response> {
  const body = await readJson(request, MAX_BLOB_CHARS + 500_000);
  const data = body.data;
  const photoIds = body.photoIds;
  if (typeof data !== 'string' || !data || data.length > MAX_BLOB_CHARS) throw new HttpError(400, 'The backup was empty or too large.');
  if (!Array.isArray(photoIds) || photoIds.length > MAX_PHOTOS || !photoIds.every(isId)) {
    throw new HttpError(400, 'The list of photos was not usable.');
  }
  const have = new Set(await listPhotoIds(db));
  const missing = photoIds.filter((id) => !have.has(id));
  if (missing.length) throw new HttpError(409, 'Some photos have not been uploaded yet.', { missing });

  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  await putBlob(db, snapshotKey(id), 'snapshot', data, createdAt);
  await db
    .prepare(`INSERT INTO snapshots (id, created_at, size, photo_ids) VALUES (?, ?, ?, ?)`)
    .bind(id, createdAt, data.length, JSON.stringify(photoIds))
    .run();
  const kept = await prune(db, now);
  return json({ id, createdAt, kept });
}

/** Keeps the newest snapshots, then drops photos nothing points to any more. */
async function prune(db: D1Database, now: Date): Promise<number> {
  const all = await db.prepare(`SELECT id FROM snapshots ORDER BY created_at DESC, id DESC`).all<{ id: string }>();
  const old = all.results.slice(SNAPSHOTS_KEPT);
  for (const row of old) {
    await db.prepare(`DELETE FROM snapshots WHERE id = ?`).bind(row.id).run();
    await deleteBlob(db, snapshotKey(row.id));
  }
  // A photo uploaded a moment ago may belong to a backup still in progress,
  // so only photos that have gone unclaimed for a day are removed.
  const cutoff = new Date(now.getTime() - ORPHAN_AGE_MS).toISOString();
  const orphaned = `kind = 'photo' AND created_at < ?1
    AND id NOT IN (SELECT 'photo-' || value FROM snapshots, json_each(snapshots.photo_ids))`;
  await db.batch([
    db.prepare(`DELETE FROM chunks WHERE blob_id IN (SELECT id FROM blobs WHERE ${orphaned})`).bind(cutoff),
    db.prepare(`DELETE FROM blobs WHERE ${orphaned}`).bind(cutoff),
  ]);
  return all.results.length - old.length;
}

/** GET /api/backup/snapshots/:id, where the id may be "latest". */
export async function getSnapshot(db: D1Database, id: string): Promise<Response> {
  let row: SnapshotRow | null;
  if (id === 'latest') {
    row = await db.prepare(`SELECT * FROM snapshots ORDER BY created_at DESC, id DESC LIMIT 1`).first<SnapshotRow>();
  } else {
    if (!isId(id)) throw new HttpError(400, 'That backup id is not usable.');
    row = await db.prepare(`SELECT * FROM snapshots WHERE id = ?`).bind(id).first<SnapshotRow>();
  }
  if (!row) throw new HttpError(404, 'There is no backup on the server yet.');
  const data = await getBlob(db, snapshotKey(row.id), 'snapshot');
  if (data === undefined) throw new HttpError(404, 'That backup is incomplete.');
  return json({ id: row.id, createdAt: row.created_at, data, photoIds: JSON.parse(row.photo_ids) as string[] });
}

export async function backupSummary(db: D1Database): Promise<{ count: number; latestAt: string | null }> {
  const row = await db.prepare(`SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM snapshots`).first<{ count: number; latest: string | null }>();
  return { count: row?.count ?? 0, latestAt: row?.latest ?? null };
}

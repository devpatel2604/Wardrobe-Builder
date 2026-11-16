import type { D1Database } from './env';
/**
 * Stores long pieces of text in the database, cut into rows.
 *
 * The text is base64 that the phone encrypted. It is kept as text on purpose:
 * the server never has to convert it, so even a large photo costs almost no
 * computing time, which the free plan limits to 10 ms a request.
 */
export type BlobKind = 'photo' | 'snapshot';

/** Under the database's 2 MB limit for one row, with room to spare. */
export const CHUNK_CHARS = 1_000_000;
/** About 9 MB of photo. The app shrinks photos to well under 1 MB. */
export const MAX_BLOB_CHARS = 12_000_000;

export async function putBlob(db: D1Database, id: string, kind: BlobKind, text: string, now: string): Promise<void> {
  // Remove the header row first. A blob counts as stored only once its
  // header row is back, so a half-written one is never handed out.
  await db.batch([db.prepare(`DELETE FROM blobs WHERE id = ?`).bind(id), db.prepare(`DELETE FROM chunks WHERE blob_id = ?`).bind(id)]);
  let seq = 0;
  for (let at = 0; at < text.length; at += CHUNK_CHARS, seq++) {
    await db.prepare(`INSERT INTO chunks (blob_id, seq, data) VALUES (?, ?, ?)`).bind(id, seq, text.slice(at, at + CHUNK_CHARS)).run();
  }
  await db
    .prepare(`INSERT INTO blobs (id, kind, size, chunks, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, kind, text.length, seq, now)
    .run();
}

export async function getBlob(db: D1Database, id: string, kind: BlobKind): Promise<string | undefined> {
  const header = await db.prepare(`SELECT chunks FROM blobs WHERE id = ? AND kind = ?`).bind(id, kind).first<{ chunks: number }>();
  if (!header) return undefined;
  const rows = await db.prepare(`SELECT data FROM chunks WHERE blob_id = ? ORDER BY seq`).bind(id).all<{ data: string }>();
  if (rows.results.length !== header.chunks) return undefined;
  return rows.results.map((row) => row.data).join('');
}

export async function deleteBlob(db: D1Database, id: string): Promise<void> {
  await db.batch([db.prepare(`DELETE FROM blobs WHERE id = ?`).bind(id), db.prepare(`DELETE FROM chunks WHERE blob_id = ?`).bind(id)]);
}

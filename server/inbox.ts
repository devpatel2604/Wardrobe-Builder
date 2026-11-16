import type { D1Database, Env } from './env';
import { HttpError, isId, json, requireAppKey, sameSecret, serverIsReady, text } from './http';
import { ensureSchema } from './schema';

/**
 * The inbox: a holding place for things shared from the iPhone's share menu.
 *
 * A web app cannot appear in the share menu on an iPhone, so a Shortcut posts
 * the link, the store page's text or the cut-out photo here. The app collects
 * everything the next time it opens and deletes it from the server.
 *
 * Unlike the backup, inbox items are not encrypted: a Shortcut has no good way
 * to do that. They are clothing photos, store pages and links, and they stay
 * here only until the app next opens.
 */

export type InboxKind = 'photo' | 'page' | 'link' | 'screenshot';

/** Enough for a long sitting at the closet. Past this, the app has to collect first. */
export const MAX_ITEMS = 40;
/** A cut-out resized by the Shortcut is 1 to 4 MB. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_CHARS = 40_000;
/** Under the database's 2 MB limit for one row. */
const CHUNK_BYTES = 1_000_000;

const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

interface Row {
  id: string;
  kind: InboxKind;
  received_at: string;
  url: string | null;
  title: string | null;
  body: string | null;
  file_type: string | null;
  file_size: number;
  file_chunks: number;
}

interface Incoming {
  kind?: string;
  key?: string;
  url?: string;
  title?: string;
  text?: string;
  file?: { type: string; bytes: ArrayBuffer };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** The Shortcut can send a form (with or without a file), JSON, or a bare picture. */
async function readIncoming(request: Request, url: URL): Promise<Incoming> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_FILE_BYTES + 200_000) throw new HttpError(413, 'That is too large to save.');
  const type = (request.headers.get('Content-Type') ?? '').toLowerCase();
  const fromQuery = { kind: str(url.searchParams.get('kind')), url: str(url.searchParams.get('url')), title: str(url.searchParams.get('title')) };

  if (type.startsWith('image/')) {
    return { ...fromQuery, file: { type: type.split(';')[0]!.trim(), bytes: await request.arrayBuffer() } };
  }
  if (type.includes('application/json')) {
    let data: unknown;
    try {
      data = await request.json();
    } catch {
      throw new HttpError(400, 'That could not be read.');
    }
    const fields = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    return { kind: str(fields.kind) ?? fromQuery.kind, key: str(fields.key), url: str(fields.url) ?? fromQuery.url, title: str(fields.title) ?? fromQuery.title, text: str(fields.text) };
  }
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'That could not be read.');
    }
    const incoming: Incoming = {
      kind: str(form.get('kind')) ?? fromQuery.kind,
      key: str(form.get('key')),
      url: str(form.get('url')) ?? fromQuery.url,
      title: str(form.get('title')) ?? fromQuery.title,
      text: str(form.get('text')),
    };
    const file = form.get('file');
    if (file && typeof file !== 'string') {
      const blob = file as Blob;
      if (blob.size > 0) incoming.file = { type: (blob.type || 'application/octet-stream').toLowerCase(), bytes: await blob.arrayBuffer() };
    }
    return incoming;
  }
  throw new HttpError(415, 'Send a form, JSON or a picture.');
}

/** The key normally comes in the Authorization header. A Shortcut may put it in the form instead. */
async function checkKey(request: Request, env: Env, incoming: Incoming): Promise<void> {
  if (request.headers.has('Authorization') || !incoming.key) return requireAppKey(request, env);
  if (!serverIsReady(env)) throw new HttpError(503, 'The server has no app key yet.');
  if (!(await sameSecret(incoming.key, env.APP_KEY!.trim()))) throw new HttpError(401, 'That app key is not right.');
}

function pickKind(incoming: Incoming): InboxKind {
  const asked = incoming.kind?.toLowerCase();
  // "look" is the Shortcut's word for inspiration: a screenshot when a picture came, a link otherwise.
  if (asked === 'look' || asked === 'screenshot' || asked === 'link') return incoming.file ? 'screenshot' : 'link';
  if (asked === 'photo') return 'photo';
  if (asked === 'page') return 'page';
  if (incoming.file) return 'photo';
  return incoming.text ? 'page' : 'link';
}

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

async function save(db: D1Database, incoming: Incoming, now: Date): Promise<{ id: string; kind: InboxKind; waiting: number }> {
  // A link shared as plain text arrives in `text`.
  if (!incoming.url && incoming.text && /^https?:\/\/\S+$/i.test(incoming.text)) {
    incoming.url = incoming.text;
    incoming.text = undefined;
  }
  const kind = pickKind(incoming);
  const { file, url } = incoming;
  if (url && (url.length > 2000 || !/^https?:\/\//i.test(url))) throw new HttpError(400, 'That link is not usable.');
  if (incoming.title && incoming.title.length > 300) incoming.title = incoming.title.slice(0, 300);
  if (incoming.text && incoming.text.length > MAX_TEXT_CHARS) throw new HttpError(413, 'That page is too long to save.');

  if (kind === 'photo' || kind === 'screenshot') {
    if (!file) throw new HttpError(400, 'No picture arrived.');
  } else if (kind === 'page') {
    if (!incoming.text && !url) throw new HttpError(400, 'No page arrived.');
  } else if (!url) {
    throw new HttpError(400, 'No link arrived.');
  }
  if (file) {
    if (!FILE_TYPES.includes(file.type)) throw new HttpError(415, 'Only pictures can be saved.');
    if (file.bytes.byteLength === 0) throw new HttpError(400, 'The picture was empty.');
    if (file.bytes.byteLength > MAX_FILE_BYTES) throw new HttpError(413, 'That picture is too large to save.');
  }

  const count = await db.prepare(`SELECT COUNT(*) AS n FROM inbox`).first<{ n: number }>();
  const waiting = count?.n ?? 0;
  if (waiting >= MAX_ITEMS) throw new HttpError(409, 'The inbox is full. Open the Wardrobe app to collect what is waiting, then share again.');

  const id = newId();
  let chunks = 0;
  if (file) {
    for (let at = 0; at < file.bytes.byteLength; at += CHUNK_BYTES, chunks++) {
      await db.prepare(`INSERT INTO inbox_chunks (item_id, seq, data) VALUES (?, ?, ?)`).bind(id, chunks, file.bytes.slice(at, at + CHUNK_BYTES)).run();
    }
  }
  // The item's own row goes in last, so a half-written picture is never listed.
  await db
    .prepare(`INSERT INTO inbox (id, kind, received_at, url, title, body, file_type, file_size, file_chunks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, kind, now.toISOString(), url ?? null, incoming.title ?? null, kind === 'link' ? null : (incoming.text ?? null), file?.type ?? null, file?.bytes.byteLength ?? 0, chunks)
    .run();
  return { id, kind, waiting: waiting + 1 };
}

const SAVED: Record<InboxKind, string> = {
  photo: 'Photo saved. Open Wardrobe to add the piece.',
  page: 'Page saved. Open Wardrobe to add the piece.',
  link: 'Link saved. Open Wardrobe to finish.',
  screenshot: 'Screenshot saved. Open Wardrobe to finish.',
};

/**
 * POST /api/inbox. Answers in plain words, because the Shortcut shows the
 * answer as its notification: "Photo saved", or what went wrong.
 * Add ?reply=json for a JSON answer.
 */
export async function postInbox(env: Env, request: Request, now: Date): Promise<Response> {
  const url = new URL(request.url);
  const wantsJson = url.searchParams.get('reply') === 'json';
  try {
    const incoming = await readIncoming(request, url);
    await checkKey(request, env, incoming);
    await ensureSchema(env.DB);
    const saved = await save(env.DB, incoming, now);
    return wantsJson ? json({ ok: true, ...saved }, 201) : text(SAVED[saved.kind], 201);
  } catch (error) {
    if (wantsJson || !(error instanceof HttpError)) throw error;
    return text(`Not saved. ${error.message}`, error.status);
  }
}

function describe(row: Row) {
  return {
    id: row.id,
    kind: row.kind,
    receivedAt: row.received_at,
    url: row.url ?? undefined,
    title: row.title ?? undefined,
    text: row.body ?? undefined,
    file: row.file_type ? { type: row.file_type, size: row.file_size } : undefined,
  };
}

/** GET /api/inbox: everything waiting, oldest first. Pictures are fetched one by one. */
export async function listInbox(db: D1Database): Promise<Response> {
  const rows = await db.prepare(`SELECT * FROM inbox ORDER BY received_at, id`).all<Row>();
  return json({ items: rows.results.map(describe) });
}

/** The database hands a stored picture back as bytes or as a list of numbers, depending on where it runs. */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error('unexpected picture data');
}

/** GET /api/inbox/:id/file: the picture of one item. */
export async function getInboxFile(db: D1Database, id: string): Promise<Response> {
  if (!isId(id)) throw new HttpError(400, 'That id is not usable.');
  const row = await db.prepare(`SELECT file_type, file_size, file_chunks FROM inbox WHERE id = ?`).bind(id).first<Pick<Row, 'file_type' | 'file_size' | 'file_chunks'>>();
  if (!row?.file_type) throw new HttpError(404, 'That item has no picture.');
  const chunks = await db.prepare(`SELECT data FROM inbox_chunks WHERE item_id = ? ORDER BY seq`).bind(id).all<{ data: unknown }>();
  if (chunks.results.length !== row.file_chunks) throw new HttpError(404, 'That picture is incomplete.');
  const bytes = new Uint8Array(row.file_size);
  let at = 0;
  for (const chunk of chunks.results) {
    const part = toBytes(chunk.data);
    bytes.set(part, at);
    at += part.byteLength;
  }
  return new Response(bytes, {
    headers: { 'Content-Type': row.file_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}

/** DELETE /api/inbox/:id: the app has collected the item. */
export async function deleteInboxItem(db: D1Database, id: string): Promise<Response> {
  if (!isId(id)) throw new HttpError(400, 'That id is not usable.');
  await db.batch([db.prepare(`DELETE FROM inbox WHERE id = ?`).bind(id), db.prepare(`DELETE FROM inbox_chunks WHERE item_id = ?`).bind(id)]);
  return json({ ok: true });
}

export async function inboxCount(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM inbox`).first<{ n: number }>();
  return row?.n ?? 0;
}

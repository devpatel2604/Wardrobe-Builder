import { db, newId, nowIso } from './db';
import { processIncoming } from './images';
import { callServer, getAppKey } from './server';
import type { InboxDoor, InboxImage, InboxItem, InboxKind } from '../domain/inbox';
import type { PieceProposal } from '../domain/tagging';

/**
 * The inbox on the phone: things waiting to be added.
 *
 * Everything that comes in lands here first, whichever door it used, so a
 * half-finished piece survives the app being closed. Switching to Photos to
 * copy a cut-out often makes an iPhone reload a web app, and nothing typed or
 * picked before that may be lost.
 *
 * The inbox is not part of a backup. It holds work in progress, and each item
 * leaves it as soon as it becomes a piece or a look.
 */

/** Oldest first, so the list reads in the order things were shared. */
export async function listInbox(): Promise<InboxItem[]> {
  return db.inbox.orderBy('receivedAt').toArray();
}

export async function getInboxItem(id: string): Promise<InboxItem | undefined> {
  return db.inbox.get(id);
}

export async function removeInboxItem(id: string): Promise<void> {
  await db.inbox.delete(id);
}

export interface NewInboxItem {
  kind: InboxKind;
  door: InboxDoor;
  url?: string;
  title?: string;
  text?: string;
  image?: InboxImage;
  extraImage?: InboxImage;
}

/** Adds something that came in inside the app: pasted, taken or picked. */
export async function addInboxItem(item: NewInboxItem): Promise<InboxItem> {
  const row: InboxItem = { ...item, id: newId(), receivedAt: nowIso() };
  await db.inbox.add(row);
  return row;
}

export async function updateInboxItem(id: string, changes: Partial<Omit<InboxItem, 'id'>>): Promise<void> {
  await db.inbox.update(id, changes);
}

/** Keeps the tags a model proposed with the item, so they are still there after a reload. */
export async function saveProposal(id: string, proposal: PieceProposal, model: string): Promise<void> {
  await db.inbox.update(id, { proposal, proposalModel: model, proposedAt: nowIso() });
}

interface ServerItem {
  id: string;
  kind: InboxKind;
  receivedAt: string;
  url?: string;
  title?: string;
  text?: string;
  file?: { type: string; size: number };
}

/**
 * The Shortcut sends a store page as one piece of JSON text. Its link and
 * title are lifted out for the list. The text itself is kept whole, for the
 * AI model to read.
 */
function pageDetails(text: string | undefined): { url?: string; title?: string } {
  if (!text || !text.startsWith('{')) return {};
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const url = typeof data.url === 'string' && /^https?:\/\//i.test(data.url) ? data.url : undefined;
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim().slice(0, 300) : undefined;
    return { url, title };
  } catch {
    return {};
  }
}

let collecting: Promise<number> | undefined;

async function collect(): Promise<number> {
  if (!(await getAppKey())) return 0;
  const listed = (await (await callServer('/inbox')).json()) as { items: ServerItem[] };
  let added = 0;
  for (const item of listed.items) {
    // Already here: the app closed last time before it could tell the server.
    if (await db.inbox.get(item.id)) {
      await callServer(`/inbox/${item.id}`, { method: 'DELETE' });
      continue;
    }
    const row: InboxItem = {
      id: item.id,
      kind: item.kind,
      door: 'shortcut',
      receivedAt: item.receivedAt,
      url: item.url,
      title: item.title,
      text: item.text,
    };
    if (item.kind === 'page') {
      const details = pageDetails(item.text);
      row.url ??= details.url;
      row.title ??= details.title;
    }
    if (item.file) {
      const bytes = await (await callServer(`/inbox/${item.id}/file`)).arrayBuffer();
      try {
        row.image = await processIncoming(new Blob([bytes], { type: item.file.type }));
      } catch {
        row.problem = 'This picture could not be opened on this phone. Share it again, or add it from inside the app.';
      }
    }
    // Saved on the phone first, then deleted from the server. If the app
    // closes in between, the next run finds it here and only deletes it there.
    await db.inbox.put(row);
    await callServer(`/inbox/${item.id}`, { method: 'DELETE' });
    added++;
  }
  return added;
}

/**
 * Fetches what the share menu sent to the server, keeps it on the phone and
 * deletes it from the server. Returns how many items came in. Does nothing
 * when the phone is not connected to the server.
 */
export function collectInbox(): Promise<number> {
  collecting ??= collect().finally(() => {
    collecting = undefined;
  });
  return collecting;
}

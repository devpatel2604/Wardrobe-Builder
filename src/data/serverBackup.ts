import { exportBackup, importBackup, parseBackup, type BackupFile } from './backup';
import { db, nowIso } from './db';
import { callServer, deleteMeta, getAppKey, getMeta, ServerError, setMeta } from './server';
import { startEmpty } from './setup';
import { keyFromRecoveryCode, newRecoveryCode, normalizeRecoveryCode, open, seal, sha256Hex } from './vault';
import type { Photo } from '../domain/types';

/**
 * The automatic backup. About once a day, when the app is opened, it
 * encrypts a copy of the data on the phone and uploads it to the small
 * server, which cannot read it.
 *
 * A backup has two parts. The snapshot is everything except photo bytes:
 * the same file an export makes, plus a list of the photos. Each photo is
 * encrypted and uploaded on its own, once, and shared by later snapshots.
 *
 * Photos of the owner ("of-me") are never uploaded.
 */
const RECOVERY_CODE = 'backup.recoveryCode';
const ON = 'backup.on';
const LAST_AT = 'backup.lastAt';
const LAST_HASH = 'backup.lastHash';
const LAST_CHECKED_AT = 'backup.lastCheckedAt';
const LAST_TRIED_AT = 'backup.lastTriedAt';
const LAST_ERROR = 'backup.lastError';

/** A day, less a little, so opening the app each morning backs up each morning. */
const AUTO_EVERY_MS = 20 * 60 * 60 * 1000;
/** After a failed automatic backup, wait this long before trying again. */
const RETRY_AFTER_MS = 60 * 60 * 1000;

type PhotoInfo = Omit<Photo, 'data' | 'thumb'>;

interface SnapshotContents {
  v: 1;
  file: BackupFile;
  photos: PhotoInfo[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface BackupState {
  on: boolean;
  /** The recovery code, once one has been made on or entered into this phone. */
  recoveryCode?: string;
  lastAt?: string;
  lastError?: string;
}

export async function getBackupState(): Promise<BackupState> {
  const [on, recoveryCode, lastAt, lastError] = await Promise.all([getMeta(ON), getMeta(RECOVERY_CODE), getMeta(LAST_AT), getMeta(LAST_ERROR)]);
  return { on: on === '1', recoveryCode, lastAt, lastError };
}

/** Makes the recovery code, or returns the one this phone already has. */
export async function prepareRecoveryCode(): Promise<string> {
  const existing = await getMeta(RECOVERY_CODE);
  if (existing) return existing;
  const code = newRecoveryCode();
  await setMeta(RECOVERY_CODE, code);
  return code;
}

/** Called once the owner says the recovery code is saved somewhere safe. */
export async function turnOnBackup(): Promise<void> {
  await prepareRecoveryCode();
  await setMeta(ON, '1');
}

export async function turnOffBackup(): Promise<void> {
  await deleteMeta(ON, LAST_ERROR);
}

/** Forgets everything about the backup on this phone, the recovery code included. */
export async function forgetBackup(): Promise<void> {
  await deleteMeta(ON, RECOVERY_CODE, LAST_AT, LAST_HASH, LAST_CHECKED_AT, LAST_TRIED_AT, LAST_ERROR);
}

/** Thumbnail and full photo in one item: a 4-byte length, the thumbnail, then the photo. */
function packPhoto(photo: Photo): Uint8Array<ArrayBuffer> {
  const thumb = new Uint8Array(photo.thumb);
  const data = new Uint8Array(photo.data);
  const out = new Uint8Array(4 + thumb.length + data.length);
  new DataView(out.buffer).setUint32(0, thumb.length);
  out.set(thumb, 4);
  out.set(data, 4 + thumb.length);
  return out;
}

function unpackPhoto(info: PhotoInfo, packed: ArrayBuffer): Photo {
  const thumbLength = new DataView(packed).getUint32(0);
  if (4 + thumbLength > packed.byteLength) throw new Error('A photo in the backup is damaged.');
  return { ...info, thumb: packed.slice(4, 4 + thumbLength), data: packed.slice(4 + thumbLength) };
}

const photoLabel = (id: string) => `photo:${id}`;

/** What would go into a backup right now, without any photo bytes. */
async function gather(): Promise<{ contents: SnapshotContents; hash: string }> {
  const file = await exportBackup({ withoutPhotos: true });
  const photos: PhotoInfo[] = [];
  await db.photos
    .where('kind')
    .notEqual('of-me')
    .each((photo) => {
      const info: PhotoInfo & { data?: unknown; thumb?: unknown } = { ...photo };
      delete info.data;
      delete info.thumb;
      photos.push(info);
    });
  photos.sort((a, b) => a.id.localeCompare(b.id));
  // The hash ignores the time the copy was made, so two copies of unchanged
  // data come out the same.
  const hash = await sha256Hex(JSON.stringify({ ...file, exportedAt: '' }) + JSON.stringify(photos));
  return { contents: { v: 1, file, photos }, hash };
}

export interface BackupResult {
  /** False when nothing had changed since the last backup, so nothing was sent. */
  uploaded: boolean;
  photosUploaded: number;
  at: string;
}

let running: Promise<BackupResult> | undefined;

/**
 * Backs up now. Skips the upload when nothing has changed since the last
 * backup, unless force is set.
 */
export function backupNow(options: { force?: boolean } = {}): Promise<BackupResult> {
  running ??= runBackup(options.force ?? false).finally(() => {
    running = undefined;
  });
  return running;
}

async function runBackup(force: boolean): Promise<BackupResult> {
  const code = await getMeta(RECOVERY_CODE);
  if (!code) throw new Error('Automatic backup is not set up on this phone.');
  await setMeta(LAST_TRIED_AT, nowIso());
  try {
    const { contents, hash } = await gather();
    if (!force && hash === (await getMeta(LAST_HASH))) {
      const at = nowIso();
      await setMeta(LAST_CHECKED_AT, at);
      await deleteMeta(LAST_ERROR);
      return { uploaded: false, photosUploaded: 0, at: (await getMeta(LAST_AT)) ?? at };
    }

    const key = await keyFromRecoveryCode(code);
    const remote = (await (await callServer('/backup')).json()) as { photoIds: string[] };
    const onServer = new Set(remote.photoIds);
    const photoIds = contents.photos.map((photo) => photo.id);

    const upload = async (id: string) => {
      const photo = await db.photos.get(id);
      // Never upload a photo of the owner, whatever asked for it.
      if (!photo || photo.kind === 'of-me') return;
      await callServer(`/backup/photos/${encodeURIComponent(id)}`, { method: 'PUT', body: await seal(key, photoLabel(id), packPhoto(photo)) });
    };
    let photosUploaded = 0;
    for (const id of photoIds) {
      if (onServer.has(id)) continue;
      await upload(id);
      photosUploaded++;
    }

    const body = { data: await seal(key, 'snapshot', encoder.encode(JSON.stringify(contents))), photoIds };
    let saved: Response;
    try {
      saved = await callServer('/backup/snapshots', { method: 'POST', body });
    } catch (error) {
      // The server says which photos it lacks (it may have cleaned some up).
      // Send those and try once more.
      const missing = error instanceof ServerError && error.status === 409 ? error.body.missing : undefined;
      if (!Array.isArray(missing)) throw error;
      for (const id of missing) {
        if (typeof id === 'string' && photoIds.includes(id)) {
          await upload(id);
          photosUploaded++;
        }
      }
      saved = await callServer('/backup/snapshots', { method: 'POST', body });
    }
    const { createdAt } = (await saved.json()) as { createdAt: string };
    await db.meta.bulkPut([
      { key: LAST_AT, value: createdAt },
      { key: LAST_HASH, value: hash },
      { key: LAST_CHECKED_AT, value: nowIso() },
    ]);
    await deleteMeta(LAST_ERROR);
    return { uploaded: true, photosUploaded, at: createdAt };
  } catch (error) {
    await setMeta(LAST_ERROR, error instanceof Error ? error.message : 'The backup failed.');
    throw error;
  }
}

function longerAgoThan(iso: string | undefined, ms: number, now: number): boolean {
  if (!iso) return true;
  const then = Date.parse(iso);
  return Number.isNaN(then) || now - then >= ms;
}

/**
 * Runs the daily backup if one is due. Called when the app opens or comes
 * back to the front. A web app on an iPhone cannot work in the background,
 * so this is the only time a backup can happen. Never throws.
 */
export async function backupIfDue(now: number = Date.now()): Promise<BackupResult | undefined> {
  try {
    const [on, key, checkedAt, triedAt] = await Promise.all([getMeta(ON), getAppKey(), getMeta(LAST_CHECKED_AT), getMeta(LAST_TRIED_AT)]);
    if (on !== '1' || !key) return undefined;
    if (!longerAgoThan(checkedAt, AUTO_EVERY_MS, now) || !longerAgoThan(triedAt, RETRY_AFTER_MS, now)) return undefined;
    if (!(await db.profile.get('me'))) return undefined;
    return await backupNow();
  } catch {
    // The reason is saved for Settings to show. Opening the app must not fail.
    return undefined;
  }
}

export interface RestoreResult {
  pieces: number;
  photos: number;
  /** When the restored backup was made. */
  madeAt: string;
}

/**
 * Brings back the newest backup from the server and replaces what is on this
 * phone with it. Photos of the owner on this phone are left alone.
 * Everything is fetched and opened first, so a wrong code or a dropped
 * connection changes nothing.
 */
export async function restoreFromServer(input: {
  /** Needed on a new phone. Defaults to the key this phone already has. */
  appKey?: string;
  recoveryCode: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<RestoreResult> {
  const code = normalizeRecoveryCode(input.recoveryCode);
  if (!code) throw new Error('That recovery code is not complete. It has 52 letters and numbers.');
  const appKey = input.appKey?.trim() || (await getAppKey());
  if (!appKey) throw new Error('Enter your app key.');

  const snapshot = (await (await callServer('/backup/snapshots/latest', { key: appKey })).json()) as { createdAt: string; data: string };
  const key = await keyFromRecoveryCode(code);
  const contents = JSON.parse(decoder.decode(await open(key, 'snapshot', snapshot.data))) as SnapshotContents;
  if (contents.v !== 1 || !Array.isArray(contents.photos)) throw new Error('That backup was made by a newer version of the app.');
  const file = parseBackup(JSON.stringify(contents.file));

  const wanted = contents.photos.filter((info) => info.kind !== 'of-me');
  const photos: Photo[] = [];
  input.onProgress?.(0, wanted.length);
  for (const info of wanted) {
    const sealed = await (await callServer(`/backup/photos/${encodeURIComponent(info.id)}`, { key: appKey })).text();
    photos.push(unpackPhoto(info, await open(key, photoLabel(info.id), sealed)));
    input.onProgress?.(photos.length, wanted.length);
  }

  await importBackup({ ...file, kind: 'backup', includesPrivatePhotos: false, photos: [] });
  await db.photos.bulkPut(photos);
  await startEmpty();

  // This phone now carries on the same backup, with the same code.
  const { hash } = await gather();
  await db.meta.bulkPut([
    { key: 'server.appKey', value: appKey },
    { key: RECOVERY_CODE, value: code },
    { key: ON, value: '1' },
    { key: LAST_AT, value: snapshot.createdAt },
    { key: LAST_HASH, value: hash },
    { key: LAST_CHECKED_AT, value: nowIso() },
  ]);
  await deleteMeta(LAST_ERROR);
  return { pieces: file.pieces.length, photos: photos.length, madeAt: snapshot.createdAt };
}

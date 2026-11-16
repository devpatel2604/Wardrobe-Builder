import { useState } from 'react';
import { importBackup, parseBackup, type BackupFile, type ImportResult } from '../data/backup';

/** Reads a wardrobe file picked by the user, then imports it on request. */
export function useFileImport() {
  const [pending, setPending] = useState<BackupFile>();
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function read(file: File | undefined): Promise<BackupFile | undefined> {
    setError(undefined);
    setResult(undefined);
    setPending(undefined);
    if (!file) return undefined;
    try {
      const parsed = parseBackup(await file.text());
      setPending(parsed);
      return parsed;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
      return undefined;
    }
  }

  /** Resolves to true when the file was loaded. */
  async function confirm(file: BackupFile | undefined = pending): Promise<boolean> {
    if (!file) return false;
    setBusy(true);
    try {
      setResult(await importBackup(file));
      setPending(undefined);
      return true;
    } catch {
      setError('The file could not be loaded. Nothing was changed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setPending(undefined);
  }

  return { pending, result, error, busy, read, confirm, cancel };
}

export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function describeFile(file: BackupFile): string {
  const date = new Date(file.exportedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const pieces = count(file.pieces.length, 'piece');
  if (file.kind === 'setup') {
    return `Setup file from ${date} with ${pieces}. Loading it replaces your profile and adds any of these pieces you don't have yet. Your photos and the pieces already here are kept.`;
  }
  const photos = count(file.photos.length, 'photo');
  return `Backup from ${date} with ${pieces} and ${photos}. Restoring it replaces everything on this phone.`;
}

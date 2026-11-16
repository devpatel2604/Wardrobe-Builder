import { aiErrorCode, getAiStatus, readWithAi } from './ai';
import { newId, nowIso } from './db';
import { imageForAi } from './images';
import { applyReading, listLookPhotos } from './looksRepo';
import { getAppKey, ServerError } from './server';
import { normalizeReading, type SavedLook } from '../domain/looks';

/**
 * Has the cloud model read a look's screenshots and propose its pieces by
 * slot. The screenshots go to the owner's own server and on to the AI
 * provider. They show a creator's public post, never the owner.
 *
 * The answer is only a proposal. It is checked against the app's own lists
 * here, and the owner confirms it on the look's screen.
 */

/** Two screenshots are enough for one outfit, and each one costs. */
export const MAX_SCREENSHOTS_READ = 2;
/** Long edge of a screenshot sent for reading. Enough to see a pleat or a knit, and well inside the server's size limit. */
export const AI_LOOK_EDGE = 1280;

export interface LookReadResult {
  look: SavedLook;
  /** How many pieces the model proposed. */
  proposed: number;
}

export type ReadingState =
  | 'ready'
  | 'no-key' // the server is there, but has no AI key yet
  | 'no-server' // this phone is not connected to the server
  | 'unknown'; // could not ask just now, so the button stays and a tap explains

let lastState: { value: ReadingState; at: number } | undefined;
const STATE_KEPT_MS = 5 * 60 * 1000;

/** Whether the reading can be used, so the screen can say plainly when it is switched off. */
export async function readingState(): Promise<ReadingState> {
  if (!(await getAppKey())) return 'no-server';
  if (lastState && Date.now() - lastState.at < STATE_KEPT_MS) return lastState.value;
  let value: ReadingState;
  try {
    const status = await getAiStatus();
    value = !status.ready ? 'no-key' : 'ready';
  } catch {
    return 'unknown';
  }
  lastState = { value, at: Date.now() };
  return value;
}

/** For tests, and for after the owner changes the server's setup. */
export function forgetReadingState(): void {
  lastState = undefined;
}

/** A failed reading in words for the owner. The look can always be filled in by hand. */
function readingError(error: unknown): Error {
  if (!(error instanceof ServerError)) return error instanceof Error ? error : new Error('The reading did not work. Try again, or add the pieces by hand.');
  if (error.status === 0) return new Error(`${error.message} You can add the pieces by hand.`);
  switch (aiErrorCode(error)) {
    case 'no-ai-key':
      lastState = { value: 'no-key', at: Date.now() };
      return new Error('Reading screenshots is switched off, because your server has no AI key yet. Add the pieces by hand for now.');
    case 'daily-limit':
      return new Error("Today's limit for AI requests is used up. Add the pieces by hand, or read the screenshots tomorrow.");
    case 'refused':
      return new Error('The AI model declined to read these screenshots. Add the pieces by hand.');
    default:
      // A server from before the AI route, or one that does not know this kind yet.
      if (error.status === 404) return new Error('Your server cannot read looks yet. That arrives with its next update. Add the pieces by hand for now.');
      return new Error(`${error.message} You can add the pieces by hand.`);
  }
}

export async function readLook(lookId: string): Promise<LookReadResult> {
  const photos = (await listLookPhotos(lookId)).slice(0, MAX_SCREENSHOTS_READ);
  if (photos.length === 0) throw new Error('Add a screenshot of the outfit first.');
  let answer;
  try {
    const images = await Promise.all(photos.map((photo) => imageForAi(photo, AI_LOOK_EDGE)));
    answer = await readWithAi<unknown>('look', { images });
  } catch (error) {
    throw readingError(error);
  }
  const reading = normalizeReading(answer.result, newId);
  if (reading.pieces.length === 0) {
    throw new Error(
      reading.notes
        ? `No outfit could be read from the screenshots. ${reading.notes}`
        : 'No outfit could be read from the screenshots. Try a clearer one, or add the pieces by hand.',
    );
  }
  const look = await applyReading(lookId, reading, { at: nowIso(), model: answer.model, notes: reading.notes });
  return { look, proposed: reading.pieces.length };
}

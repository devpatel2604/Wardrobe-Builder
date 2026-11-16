import { db, newId, nowIso } from './db';
import type { ProcessedImage } from './images';
import {
  applyResultsToPalette,
  COLOR_TEST_PHOTO_PREFIX,
  colorTestPhotoOwner,
  localDate,
  type ColorTest,
  type TestColor,
  type TestedColor,
} from '../domain/colorTest';
import type { Photo, Profile, Rule } from '../domain/types';

/**
 * Storage for the color photo test. There is one test at a time, kept as a
 * single row. Its photos are rows in the photos table with the privacy class
 * "of-me", so they follow the same rule as every photo of the owner: they stay
 * on the phone and are left out of a backup.
 */

export async function getColorTest(): Promise<ColorTest | undefined> {
  return db.colorTests.get('current');
}

const PROMPT_DISMISSED = 'colorTestPromptDismissed';

/** True once the owner has waved off the nudge to take the test. */
export async function colorTestPromptDismissed(): Promise<boolean> {
  return (await db.meta.get(PROMPT_DISMISSED))?.value === 'yes';
}

export async function dismissColorTestPrompt(): Promise<void> {
  await db.meta.put({ key: PROMPT_DISMISSED, value: 'yes' });
}

/** Runs a change on the test inside one transaction and saves the result. */
async function change(mutate: (test: ColorTest) => void | Promise<void>): Promise<ColorTest> {
  return db.transaction('rw', db.colorTests, db.photos, db.profile, async () => {
    const test = await db.colorTests.get('current');
    if (!test) throw new Error('The color test has not been started.');
    await mutate(test);
    test.updatedAt = nowIso();
    await db.colorTests.put(test);
    return test;
  });
}

function unique(colors: TestColor[]): TestColor[] {
  return [...new Set(colors)];
}

/** Starts the test, or changes which colors are in it. Photos and picks of colors that stay are kept. */
export async function setTestColors(colors: TestColor[]): Promise<ColorTest> {
  const wanted = unique(colors);
  if (wanted.length < 2) throw new Error('Pick at least two colors to compare.');
  return db.transaction('rw', db.colorTests, db.photos, async () => {
    const now = nowIso();
    const current = await db.colorTests.get('current');
    const test: ColorTest = current ?? { id: 'current', startedAt: now, updatedAt: now, colors: [], shots: [], picks: [] };
    const dropped = test.shots.filter((s) => !wanted.includes(s.color));
    await db.photos.bulkDelete(dropped.map((s) => s.photoId));
    test.colors = wanted;
    test.shots = test.shots.filter((s) => wanted.includes(s.color));
    test.picks = test.picks.filter((p) => wanted.includes(p.a) && wanted.includes(p.b));
    test.updatedAt = now;
    await db.colorTests.put(test);
    return test;
  });
}

/**
 * Saves the photo for a color. A retake replaces the earlier photo and drops
 * the picks that were made with it, because they judged a different picture.
 */
export async function saveShot(color: TestColor, image: ProcessedImage): Promise<ColorTest> {
  return change(async (test) => {
    if (!test.colors.includes(color)) throw new Error('That color is not in this test.');
    const earlier = test.shots.find((s) => s.color === color);
    if (earlier) await db.photos.delete(earlier.photoId);
    const now = nowIso();
    const photo: Photo = { id: newId(), pieceId: colorTestPhotoOwner(color), kind: 'of-me', order: 0, createdAt: now, ...image };
    await db.photos.add(photo);
    test.shots = [...test.shots.filter((s) => s.color !== color), { color, photoId: photo.id, takenAt: now }];
    if (earlier) test.picks = test.picks.filter((p) => p.a !== color && p.b !== color);
  });
}

/** The photo of each color that still has one on this phone. */
export async function shotPhotos(test: ColorTest | undefined): Promise<Map<TestColor, Photo>> {
  const found = new Map<TestColor, Photo>();
  if (!test) return found;
  const photos = await db.photos.bulkGet(test.shots.map((s) => s.photoId));
  test.shots.forEach((shot, i) => {
    const photo = photos[i];
    if (photo) found.set(shot.color, photo);
  });
  return found;
}

export async function addPick(a: TestColor, b: TestColor, winner: TestColor | 'same'): Promise<ColorTest> {
  if (winner !== 'same' && winner !== a && winner !== b) throw new Error('The pick must be one of the two colors.');
  return change((test) => {
    test.picks = [...test.picks, { a, b, winner, at: nowIso() }];
  });
}

export async function undoLastPick(): Promise<ColorTest> {
  return change((test) => {
    test.picks = test.picks.slice(0, -1);
  });
}

function withoutRules(profile: Profile, ids: Set<string>): Rule[] {
  return profile.rules.filter((r) => !ids.has(r.id));
}

/**
 * Writes the results to the palette in the profile. The palette from before
 * is kept, so the change can be undone. Open tests the owner ticked as
 * answered are taken out of the profile's rules and kept for undo too.
 */
export async function applyColorTest(results: TestedColor[], answeredRuleIds: string[] = []): Promise<ColorTest> {
  return change(async (test) => {
    const profile = await db.profile.get('me');
    if (!profile) throw new Error('There is no profile to update.');
    // Applying a second time builds on the palette from before the first time.
    const previousPalette = test.applied?.previousPalette ?? profile.palette;
    const earlierAnswered = test.applied?.answeredRules ?? [];
    const ids = new Set(answeredRuleIds);
    const answeredRules = [...earlierAnswered, ...profile.rules.filter((r) => ids.has(r.id) && r.kind === 'open-test')];
    const now = nowIso();
    await db.profile.put({
      ...profile,
      palette: applyResultsToPalette(previousPalette, results, localDate()),
      rules: withoutRules(profile, ids),
      updatedAt: now,
    });
    test.applied = { appliedAt: now, results, previousPalette, answeredRules };
  });
}

/** Puts back the palette and the open tests from before the results were saved. */
export async function undoApplyColorTest(): Promise<ColorTest> {
  return change(async (test) => {
    const applied = test.applied;
    if (!applied) return;
    const profile = await db.profile.get('me');
    if (profile) {
      const present = new Set(profile.rules.map((r) => r.id));
      await db.profile.put({
        ...profile,
        palette: applied.previousPalette,
        rules: [...profile.rules, ...applied.answeredRules.filter((r) => !present.has(r.id))],
        updatedAt: nowIso(),
      });
    }
    delete test.applied;
  });
}

/**
 * Called after a setup file has replaced the profile. The file's palette is
 * stylists' advice, so results the owner already saved are written over it
 * again, and the open tests they answered are taken out again.
 */
export async function reapplyColorTestAfterSetup(): Promise<void> {
  await db.transaction('rw', db.colorTests, db.profile, async () => {
    const test = await db.colorTests.get('current');
    const profile = await db.profile.get('me');
    if (!test?.applied || !profile) return;
    const answered = new Set(test.applied.answeredRules.map((r) => r.id));
    await db.profile.put({
      ...profile,
      palette: applyResultsToPalette(profile.palette, test.applied.results, localDate(new Date(test.applied.appliedAt))),
      rules: withoutRules(profile, answered),
    });
    await db.colorTests.put({ ...test, applied: { ...test.applied, previousPalette: profile.palette } });
  });
}

/** Deletes the photos and keeps the picks, the ranking and the palette. */
export async function deleteColorTestPhotos(): Promise<void> {
  await db.transaction('rw', db.colorTests, db.photos, async () => {
    await db.photos.where('pieceId').startsWith(COLOR_TEST_PHOTO_PREFIX).delete();
  });
}

/** Deletes the test and its photos. A palette that was already saved stays as it is. */
export async function resetColorTest(): Promise<void> {
  await db.transaction('rw', db.colorTests, db.photos, async () => {
    await db.photos.where('pieceId').startsWith(COLOR_TEST_PHOTO_PREFIX).delete();
    await db.colorTests.clear();
  });
}

/**
 * Removes color-test photos that no test row points to. A restore can leave
 * some behind, because photos of the owner are not touched by a restore.
 */
export async function removeOrphanColorTestPhotos(): Promise<void> {
  await db.transaction('rw', db.colorTests, db.photos, async () => {
    const test = await db.colorTests.get('current');
    const wanted = new Set(test?.shots.map((s) => s.photoId) ?? []);
    const ids = await db.photos.where('pieceId').startsWith(COLOR_TEST_PHOTO_PREFIX).primaryKeys();
    await db.photos.bulkDelete(ids.filter((id) => !wanted.has(id)));
  });
}

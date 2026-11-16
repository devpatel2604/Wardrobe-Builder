import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, parseBackup } from './backup';
import {
  addPick,
  applyColorTest,
  deleteColorTestPhotos,
  getColorTest,
  resetColorTest,
  saveShot,
  setTestColors,
  shotPhotos,
  undoApplyColorTest,
  undoLastPick,
} from './colorTestRepo';
import { db } from './db';
import { getProfile } from './profileRepo';
import { eraseEverything } from './setup';
import { rankColors, testedColors } from '../domain/colorTest';
import { fakeImage, sampleSetupFile } from '../test/fixtures';

/** A test with three photos and two picks: navy beats white, white beats black. */
async function startedTest() {
  await importBackup(sampleSetupFile());
  await setTestColors(['white', 'navy', 'black']);
  await saveShot('white', fakeImage([1, 1, 1, 1]));
  await saveShot('navy', fakeImage([2, 2, 2, 2]));
  await saveShot('black', fakeImage([3, 3, 3, 3]));
  await addPick('white', 'navy', 'navy');
  return addPick('white', 'black', 'white');
}

function resultsOf(test: { colors: Parameters<typeof rankColors>[0]; picks: Parameters<typeof rankColors>[1] }) {
  return testedColors(rankColors(test.colors, test.picks));
}

describe('taking photos', () => {
  it('needs at least two colors', async () => {
    await expect(setTestColors(['white'])).rejects.toThrow('at least two');
    expect(await getColorTest()).toBeUndefined();
  });

  it('stores each photo as a photo of the owner', async () => {
    const test = await startedTest();
    expect(test.shots.map((s) => s.color)).toEqual(['white', 'navy', 'black']);
    const photos = await db.photos.toArray();
    expect(photos).toHaveLength(3);
    expect(photos.every((p) => p.kind === 'of-me' && p.pieceId.startsWith('color-test:'))).toBe(true);
    expect((await shotPhotos(test)).size).toBe(3);
  });

  it('replaces the photo on a retake and drops the picks made with the old one', async () => {
    const before = await startedTest();
    const oldPhoto = before.shots.find((s) => s.color === 'black')!.photoId;
    const after = await saveShot('black', fakeImage([9, 9, 9, 9]));
    expect(await db.photos.get(oldPhoto)).toBeUndefined();
    expect(await db.photos.count()).toBe(3);
    expect(after.picks).toEqual([expect.objectContaining({ a: 'white', b: 'navy' })]);
  });

  it('refuses a photo for a color that is not in the test', async () => {
    await startedTest();
    await expect(saveShot('mustard', fakeImage())).rejects.toThrow('not in this test');
  });

  it('drops the photo and picks of a color that is taken out of the test', async () => {
    await startedTest();
    const test = await setTestColors(['white', 'navy', 'olive']);
    expect(test.shots.map((s) => s.color)).toEqual(['white', 'navy']);
    expect(test.picks).toHaveLength(1);
    expect(await db.photos.count()).toBe(2);
  });

  it('undoes the last pick', async () => {
    await startedTest();
    expect((await undoLastPick()).picks).toHaveLength(1);
  });
});

describe('saving results to the palette', () => {
  it('writes tested colors into the profile and takes answered open tests out', async () => {
    const test = await startedTest();
    await applyColorTest(resultsOf(test), ['r-black']);
    const profile = (await getProfile())!;
    expect(profile.palette.map((e) => e.color)).toEqual(['Navy', 'White', 'Black']);
    expect(profile.palette.every((e) => e.evidence === 'your-test')).toBe(true);
    expect(profile.palette[2]).toMatchObject({ family: 'black', nearFace: 'Not next to the face', awayFromFace: 'Yes' });
    expect(profile.rules.some((r) => r.id === 'r-black')).toBe(false);
    expect(profile.rules).toHaveLength(6);
    expect((await getColorTest())!.applied!.answeredRules.map((r) => r.id)).toEqual(['r-black']);
  });

  it('puts the old palette and the open tests back on undo', async () => {
    const test = await startedTest();
    const before = (await getProfile())!;
    await applyColorTest(resultsOf(test), ['r-black']);
    await undoApplyColorTest();
    const after = (await getProfile())!;
    expect(after.palette).toEqual(before.palette);
    expect(after.rules.map((r) => r.id).sort()).toEqual(before.rules.map((r) => r.id).sort());
    expect((await getColorTest())!.applied).toBeUndefined();
  });

  it('builds on the original palette when saved a second time', async () => {
    const test = await startedTest();
    const before = (await getProfile())!.palette;
    await applyColorTest(resultsOf(test), ['r-black']);
    await applyColorTest(resultsOf(test).map((r) => ({ ...r, verdict: 'fine' as const })));
    const applied = (await getColorTest())!.applied!;
    expect(applied.previousPalette).toEqual(before);
    expect(applied.answeredRules.map((r) => r.id)).toEqual(['r-black']);
    expect((await getProfile())!.palette.every((e) => e.test?.verdict === 'fine')).toBe(true);
  });

  it('keeps saved results when a new setup file replaces the profile', async () => {
    const test = await startedTest();
    await applyColorTest(resultsOf(test), ['r-black']);
    await importBackup(sampleSetupFile());
    const profile = (await getProfile())!;
    expect(profile.palette.map((e) => e.color)).toEqual(['Navy', 'White', 'Black']);
    expect(profile.palette[0]!.test?.rank).toBe(1);
    expect(profile.rules.some((r) => r.id === 'r-black')).toBe(false);
    // Undo still leads back to the setup file's own palette.
    await undoApplyColorTest();
    expect((await getProfile())!.palette.map((e) => e.id)).toEqual(['p-navy', 'p-black']);
  });
});

describe('privacy and backup', () => {
  it('leaves the photos out of a backup and keeps the picks and results in', async () => {
    const test = await startedTest();
    await applyColorTest(resultsOf(test));
    const backup = await exportBackup();
    expect(backup.photos).toEqual([]);
    expect(backup.formatVersion).toBe(2);
    expect(backup.colorTest?.picks).toHaveLength(2);
    expect(backup.colorTest?.applied?.results).toHaveLength(3);
    expect(JSON.stringify(backup)).not.toContain('"data"');
  });

  it('leaves the photos out even when photos of the owner are asked for', async () => {
    await startedTest();
    await db.photos.add({ id: 'ph-mirror', pieceId: 'pc-knit', kind: 'of-me', order: 0, createdAt: 'x', ...fakeImage() });
    const backup = await exportBackup({ includePrivatePhotos: true });
    expect(backup.photos.map((p) => p.id)).toEqual(['ph-mirror']);
    // Restoring that file on the same phone keeps the color-test photos too.
    await importBackup(backup);
    expect(await db.photos.count()).toBe(4);
    expect((await shotPhotos(await getColorTest())).size).toBe(3);
  });

  it('restores the test on a phone that has no photos, with the ranking intact', async () => {
    const test = await startedTest();
    await applyColorTest(resultsOf(test));
    const file = parseBackup(JSON.stringify(await exportBackup()));
    await eraseEverything();
    await importBackup(file);
    const restored = (await getColorTest())!;
    expect(restored.picks).toHaveLength(2);
    expect((await shotPhotos(restored)).size).toBe(0);
    expect(rankColors(restored.colors, restored.picks)[0]!.color).toBe('navy');
    expect((await getProfile())!.palette[0]!.evidence).toBe('your-test');
  });

  it('keeps the photos on the same phone through a restore and clears strays', async () => {
    await startedTest();
    const file = await exportBackup();
    // A retake after the backup: the backup no longer knows this photo.
    await saveShot('black', fakeImage([7, 7, 7, 7]));
    await importBackup(file);
    const restored = (await getColorTest())!;
    expect((await shotPhotos(restored)).size).toBe(2);
    expect(await db.photos.count()).toBe(2);
  });

  it('still loads a backup made before the color test existed', async () => {
    await startedTest();
    const old = { ...(await exportBackup()), formatVersion: 1 } as Record<string, unknown>;
    delete old.colorTest;
    await importBackup(parseBackup(JSON.stringify(old)));
    expect(await getColorTest()).toBeUndefined();
    expect(await db.photos.count()).toBe(0);
  });

  it('rejects a file whose color test is malformed', () => {
    const file = { ...sampleSetupFile(), colorTest: { id: 'current', colors: 'navy' } };
    expect(() => parseBackup(JSON.stringify(file))).toThrow('color test the app cannot read');
  });

  it('can delete the photos and keep the results', async () => {
    await startedTest();
    await deleteColorTestPhotos();
    expect(await db.photos.count()).toBe(0);
    expect((await getColorTest())!.picks).toHaveLength(2);
  });

  it('leaves clothing photos alone when the test photos are deleted', async () => {
    await startedTest();
    await db.photos.add({ id: 'ph-1', pieceId: 'pc-knit', kind: 'clothing', order: 0, createdAt: 'x', ...fakeImage() });
    await resetColorTest();
    expect((await db.photos.toArray()).map((p) => p.id)).toEqual(['ph-1']);
    expect(await getColorTest()).toBeUndefined();
  });

  it('is wiped by "erase everything"', async () => {
    await startedTest();
    await eraseEverything();
    expect(await db.colorTests.count()).toBe(0);
    expect(await db.photos.count()).toBe(0);
  });
});

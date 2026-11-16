import { useLiveQuery } from 'dexie-react-hooks';
import { getColorTest, shotPhotos } from '../../data/colorTestRepo';
import { ALL_TEST_COLORS, testColorLabel, testColorSwatch, type ColorTest, type TestColor } from '../../domain/colorTest';
import type { Photo } from '../../domain/types';
import { StoredImage } from '../../ui/controls';

export interface ColorTestData {
  test: ColorTest | undefined;
  /** The photo of each color that is still on this phone. */
  photos: Map<TestColor, Photo>;
}

/** The test and its photos, kept up to date as they change. Undefined while loading. */
export function useColorTestData(): ColorTestData | undefined {
  return useLiveQuery(async () => {
    const test = await getColorTest();
    return { test, photos: await shotPhotos(test) };
  }, []);
}

export function isTestColor(value: string | undefined): value is TestColor {
  return value !== undefined && (ALL_TEST_COLORS as string[]).includes(value);
}

/** Colors that have been photographed, in test order. They are the ones that get ranked. */
export function shotColors(test: ColorTest): TestColor[] {
  const taken = new Set(test.shots.map((s) => s.color));
  return test.colors.filter((c) => taken.has(c));
}

export function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function Swatch({ color, className = 'dot' }: { color: TestColor; className?: string }) {
  return <span className={className} style={{ background: testColorSwatch(color) }} aria-hidden="true" />;
}

/** The photo of a color, or a block of the color when there is no photo on this phone. */
export function ShotImage({ color, photo, full, className }: { color: TestColor; photo: Photo | undefined; full?: boolean; className: string }) {
  if (!photo) return <span className={`${className} shot-blank`} style={{ background: testColorSwatch(color) }} aria-hidden="true" />;
  return <StoredImage bytes={full ? photo.data : photo.thumb} mimeType={photo.mimeType} alt={`You with ${testColorLabel(color).toLowerCase()}`} className={className} />;
}

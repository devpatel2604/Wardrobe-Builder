/**
 * Shrinks a photo on the phone before it is stored. A full camera photo is
 * several megabytes, and browser storage is limited, so the app keeps a
 * 1600-pixel copy and a small thumbnail.
 */
export interface ProcessedImage {
  mimeType: string;
  width: number;
  height: number;
  data: ArrayBuffer;
  thumb: ArrayBuffer;
}

export const MAX_EDGE = 1600;
export const THUMB_EDGE = 480;
const QUALITY = 0.85;

/** The size that fits inside maxEdge on the long side, never scaling up. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall through to the <img> route, which handles a few formats this one does not.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A part of a picture, in the picture's own pixels. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function render(source: CanvasImageSource, width: number, height: number, from?: PixelRect, quality = QUALITY): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not prepare the photo.');
  // JPEG has no transparency, so a cut-out lands on white, not black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  if (from) ctx.drawImage(source, from.x, from.y, from.width, from.height, 0, 0, width, height);
  else ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('This browser could not save the photo.'));
        else blob.arrayBuffer().then(resolve, reject);
      },
      'image/jpeg',
      quality,
    );
  });
}

export async function processImage(file: Blob): Promise<ProcessedImage> {
  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new Error('That file could not be read as a photo.');
  }
  try {
    const full = fitWithin(decoded.width, decoded.height, MAX_EDGE);
    const small = fitWithin(decoded.width, decoded.height, THUMB_EDGE);
    const data = await render(decoded.source, full.width, full.height);
    const thumb = await render(decoded.source, small.width, small.height);
    return { mimeType: 'image/jpeg', width: full.width, height: full.height, data, thumb };
  } finally {
    decoded.close();
  }
}

/** A cut-out has at least this share of see-through pixels. A normal photo has none. */
const CUTOUT_SHARE = 0.03;

/**
 * True when the picture's background has been removed, as Apple's cut-out
 * does: a real share of its pixels are see-through. Checked on a small copy.
 */
function hasClearBackground(source: CanvasImageSource, width: number, height: number): boolean {
  const size = fitWithin(width, height, 64);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, size.width, size.height);
  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, size.width, size.height).data;
  } catch {
    return false;
  }
  let clear = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! < 128) clear++;
  return clear / (pixels.length / 4) >= CUTOUT_SHARE;
}

/** Like processImage, and also says whether the picture arrived as a cut-out. */
export async function processIncoming(file: Blob): Promise<ProcessedImage & { cutout: boolean }> {
  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new Error('That file could not be read as a photo.');
  }
  try {
    const cutout = hasClearBackground(decoded.source, decoded.width, decoded.height);
    const full = fitWithin(decoded.width, decoded.height, MAX_EDGE);
    const small = fitWithin(decoded.width, decoded.height, THUMB_EDGE);
    const data = await render(decoded.source, full.width, full.height);
    const thumb = await render(decoded.source, small.width, small.height);
    return { mimeType: 'image/jpeg', width: full.width, height: full.height, data, thumb, cutout };
  } finally {
    decoded.close();
  }
}

type Stored = Pick<ProcessedImage, 'mimeType' | 'data' | 'width' | 'height'>;

/** Keeps only one part of a stored photo, such as the garment without the room around it. */
export async function cropImage(image: Stored, rect: PixelRect): Promise<ProcessedImage> {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(rect.y)));
  const from = {
    x,
    y,
    width: Math.max(1, Math.min(image.width - x, Math.round(rect.width))),
    height: Math.max(1, Math.min(image.height - y, Math.round(rect.height))),
  };
  const decoded = await decode(new Blob([image.data], { type: image.mimeType }));
  try {
    const small = fitWithin(from.width, from.height, THUMB_EDGE);
    const data = await render(decoded.source, from.width, from.height, from);
    const thumb = await render(decoded.source, small.width, small.height, from);
    return { mimeType: 'image/jpeg', width: from.width, height: from.height, data, thumb };
  } finally {
    decoded.close();
  }
}

/** A picture ready to send to the AI route: a JPEG as base64 text. */
export interface AiImage {
  mediaType: 'image/jpeg';
  data: string;
}

/** Long edge for a garment photo sent for tagging. Enough to see a knit, small enough to cost about a cent. */
export const AI_PHOTO_EDGE = 1024;
/** A screenshot of a store page needs its small print to stay readable. */
export const AI_SCREENSHOT_EDGE = 1568;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Shrinks a stored photo to what the AI model needs and no more. */
export async function imageForAi(image: Stored, maxEdge: number): Promise<AiImage> {
  if (image.mimeType === 'image/jpeg' && Math.max(image.width, image.height) <= maxEdge) {
    return { mediaType: 'image/jpeg', data: toBase64(image.data) };
  }
  const decoded = await decode(new Blob([image.data], { type: image.mimeType }));
  try {
    const size = fitWithin(decoded.width, decoded.height, maxEdge);
    return { mediaType: 'image/jpeg', data: toBase64(await render(decoded.source, size.width, size.height, undefined, 0.82)) };
  } finally {
    decoded.close();
  }
}

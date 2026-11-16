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

function render(source: CanvasImageSource, width: number, height: number): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not prepare the photo.');
  // JPEG has no transparency, so a cut-out lands on white, not black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('This browser could not save the photo.'));
        else blob.arrayBuffer().then(resolve, reject);
      },
      'image/jpeg',
      QUALITY,
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

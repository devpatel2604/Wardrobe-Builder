/**
 * Reading the clipboard. On an iPhone each read shows a small "Paste" button
 * the owner has to tap, so these are only ever called from a tap.
 */

/** The picture on the clipboard, or undefined when there is none. */
export async function readClipboardImage(): Promise<Blob | undefined> {
  if (!navigator.clipboard?.read) {
    throw new Error('Pasting a picture is not available here. Use "Take or choose a photo".');
  }
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error('Nothing was pasted. Copy the cut-out first, then tap Paste and allow it.');
  }
  for (const item of items) {
    // A cut-out is a PNG, which keeps its clear background.
    const type = item.types.find((t) => t === 'image/png') ?? item.types.find((t) => t.startsWith('image/'));
    if (type) return item.getType(type);
  }
  return undefined;
}

/** The text on the clipboard, or undefined when it cannot be read. */
export async function readClipboardText(): Promise<string | undefined> {
  if (!navigator.clipboard?.readText) return undefined;
  try {
    return (await navigator.clipboard.readText()).trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A web link, tidied, or undefined when the text is not one. */
export function asLink(text: string | undefined): string | undefined {
  const value = text?.trim();
  if (!value || /\s/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

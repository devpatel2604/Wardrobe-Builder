import { readWithAi } from './ai';
import { AI_PHOTO_EDGE, AI_SCREENSHOT_EDGE, imageForAi } from './images';
import { saveProposal } from './inboxRepo';
import type { InboxItem } from '../domain/inbox';
import { cleanProposal, type PieceProposal } from '../domain/tagging';

/**
 * Asks an AI model to propose tags for something in the inbox, and keeps the
 * answer with the item. The owner confirms every tag on the form.
 *
 * Only what is listed in whatIsSent leaves the phone: the picture or page of
 * this one item. Nothing about the owner, and never a photo of them.
 */

/** True when the item has something a model can read. */
export function canSuggest(item: InboxItem): boolean {
  if (item.kind === 'photo') return item.image !== undefined;
  return Boolean(item.text) || item.extraImage !== undefined;
}

/** What tapping "Suggest tags" sends, in words for the owner. */
export function whatIsSent(item: InboxItem): string {
  if (item.kind === 'photo') {
    const photo = item.image?.cutout ? 'This cut-out' : 'This photo, with whatever is behind the piece,';
    return `${photo}${item.extraImage ? ' and the label photo go' : ' goes'} to your server and on to the AI provider. Nothing else is sent.`;
  }
  const parts = [item.text ? "the page's text" : undefined, item.extraImage ? 'your screenshot' : undefined].filter(Boolean).join(' and ');
  return `The link and ${parts} go to your server and on to the AI provider. Nobody loads the store's site.`;
}

export async function suggestTags(item: InboxItem): Promise<{ proposal: PieceProposal; model: string }> {
  let answer;
  if (item.kind === 'photo') {
    if (!item.image) throw new Error('There is no photo to read.');
    const images = [await imageForAi(item.image, AI_PHOTO_EDGE)];
    // A label is small print, so it goes at a larger size than the garment.
    if (item.extraImage) images.push(await imageForAi(item.extraImage, AI_SCREENSHOT_EDGE));
    answer = await readWithAi('piece-photo', { images });
  } else {
    const images = item.extraImage ? [await imageForAi(item.extraImage, AI_SCREENSHOT_EDGE)] : [];
    if (!item.text && images.length === 0) throw new Error("Add a screenshot of the page or paste its details first.");
    answer = await readWithAi('piece-page', { url: item.url, title: item.title, text: item.text, images });
  }
  const proposal = cleanProposal(answer.result);
  await saveProposal(item.id, proposal, answer.model);
  return { proposal, model: answer.model };
}

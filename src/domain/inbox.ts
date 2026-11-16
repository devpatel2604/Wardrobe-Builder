import type { PieceProposal } from './tagging';

/**
 * Something waiting to be added to the app: a photo of a piece, a store page,
 * a link, or a screenshot of a look.
 *
 * Items arrive through three doors and end the same way. A photo or a page
 * becomes a piece once the owner has confirmed its tags. A link or a
 * screenshot can become a saved look.
 */
export type InboxKind = 'photo' | 'page' | 'link' | 'screenshot';

/** How the item got here. */
export type InboxDoor =
  | 'shortcut' // the share menu, through the small server
  | 'paste' // pasted inside the app
  | 'picker'; // taken or chosen inside the app

export interface InboxImage {
  mimeType: string;
  width: number;
  height: number;
  /** Stored as bytes, like every photo in the app. */
  data: ArrayBuffer;
  thumb: ArrayBuffer;
  /**
   * True when the background was already removed (by Apple's tool in the
   * Shortcut or in Photos), so only the garment is in the picture.
   */
  cutout: boolean;
}

export interface InboxItem {
  id: string;
  kind: InboxKind;
  door: InboxDoor;
  /** ISO time. */
  receivedAt: string;
  url?: string;
  title?: string;
  /** For a page: what the phone copied from the store's page. */
  text?: string;
  image?: InboxImage;
  /** A second picture: the label of a piece, or a screenshot of the store page. */
  extraImage?: InboxImage;
  /** Tags an AI model proposed, once asked. The owner confirms them on the form. */
  proposal?: PieceProposal;
  /** The model that made the proposal. */
  proposalModel?: string;
  /** ISO time of the proposal. */
  proposedAt?: string;
  /** Set when a shared picture arrived but could not be opened on this phone. */
  problem?: string;
}

/** Kinds that end as a piece in the wardrobe. A plain link can go either way. */
export function canBecomePiece(item: InboxItem): boolean {
  return item.kind === 'photo' || item.kind === 'page' || (item.kind === 'link' && !isInstagramLink(item.url));
}

/** Kinds that the inspiration screens can take. */
export function canBecomeLook(item: InboxItem): boolean {
  return item.kind === 'link' || item.kind === 'screenshot';
}

export function isInstagramLink(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return /(^|\.)instagram\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** A short name for a web address: the store's site without "www". */
export function siteOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return undefined;
  }
}

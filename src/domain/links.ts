/**
 * Reading a link the owner shared or pasted. Nothing here loads the link.
 * The app keeps the address, shows an Instagram post in Instagram's own
 * player, and never pulls anything out of the post.
 */

export interface InstagramLink {
  kind: 'reel' | 'post';
  /** The post's own id in the address, such as "DejRSdeNUwe". */
  code: string;
  /** The account, when the address names it. Share links from the Instagram app usually do not. */
  handle?: string;
  /** The address without tracking parts. This is what gets stored. */
  canonical: string;
  /** The address of Instagram's own player for this post. */
  embed: string;
}

export interface SharedLink {
  /** The cleaned address to store. */
  url: string;
  /** The site's name without "www.", for display. */
  host: string;
  /** Set when the link is an Instagram post or reel that the player can show. */
  instagram?: InstagramLink;
}

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am']);
const POST_PATH = /^\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})(?:\/|$)/;
/** Parts of an address that only track who shared it. */
const TRACKING = /^(utm_|igsh|igshid|ig_|fbclid|gclid|si$|share_id|img_index)/i;

/** The first web address in a piece of text, or nothing. */
export function firstUrl(text: string): string | undefined {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (match) return match[0].replace(/[),.;!?]+$/, '');
  // Links are often pasted without "https://".
  const bare = /(?:^|\s)((?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s<>"']+)/i.exec(text);
  return bare ? `https://${bare[1]!.replace(/[),.;!?]+$/, '')}` : undefined;
}

export function parseInstagramLink(text: string): InstagramLink | undefined {
  const raw = firstUrl(text);
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  const match = POST_PATH.exec(url.pathname);
  if (!match) return undefined;
  const [, first, type, code] = match;
  // "/share/reel/..." is a forwarding address. Its last part is not the post's id.
  if (first?.toLowerCase() === 'share') return undefined;
  const kind = type === 'p' ? 'post' : 'reel';
  const segment = kind === 'post' ? 'p' : 'reel';
  const handle = first ? first.toLowerCase() : undefined;
  return {
    kind,
    code: code!,
    handle,
    canonical: `https://www.instagram.com/${handle ? `${handle}/` : ''}${segment}/${code}/`,
    embed: `https://www.instagram.com/${segment}/${code}/embed/`,
  };
}

/** Cleans a pasted or shared link. Returns nothing when the text holds no usable web address. */
export function parseSharedLink(text: string): SharedLink | undefined {
  const raw = firstUrl(text);
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (!url.hostname.includes('.')) return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const instagram = parseInstagramLink(raw);
  if (instagram) return { url: instagram.canonical, host: 'instagram.com', instagram };
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  url.protocol = 'https:';
  return { url: url.toString(), host };
}

/** True when two stored links point at the same post or page. */
export function sameLink(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ia = parseInstagramLink(a);
  const ib = parseInstagramLink(b);
  if (ia || ib) return ia !== undefined && ib !== undefined && ia.code === ib.code;
  const strip = (value: string) => value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase();
  return strip(a) === strip(b);
}

/** Tidies a creator's name as typed: "some.creator" stays a name, "@Some.Creator " becomes "@some.creator". */
export function cleanCreator(text: string | undefined): string | undefined {
  const value = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!value) return undefined;
  return value.startsWith('@') ? `@${value.slice(1).replace(/\s/g, '').toLowerCase()}` : value;
}

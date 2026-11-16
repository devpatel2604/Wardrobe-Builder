import { describe, expect, it } from 'vitest';
import { cleanCreator, firstUrl, parseInstagramLink, parseSharedLink, sameLink } from './links';

describe('reading an Instagram link', () => {
  it('reads a reel shared from the app and drops the tracking part', () => {
    const link = parseInstagramLink('https://www.instagram.com/reel/Abc123_xY-z/?igsh=MWQ1ZGUxMzBkMA==');
    expect(link).toEqual({
      kind: 'reel',
      code: 'Abc123_xY-z',
      handle: undefined,
      canonical: 'https://www.instagram.com/reel/Abc123_xY-z/',
      embed: 'https://www.instagram.com/reel/Abc123_xY-z/embed/',
    });
  });

  it('keeps the account when the address names it', () => {
    const link = parseInstagramLink('https://www.instagram.com/A_Creator/reel/Abc123xyz/');
    expect(link?.handle).toBe('a_creator');
    expect(link?.canonical).toBe('https://www.instagram.com/a_creator/reel/Abc123xyz/');
    // The player's address never carries the account.
    expect(link?.embed).toBe('https://www.instagram.com/reel/Abc123xyz/embed/');
  });

  it('reads posts, the older "reels" and "tv" forms, and a link with no https', () => {
    expect(parseInstagramLink('https://instagram.com/p/Cxyz12345/')?.kind).toBe('post');
    expect(parseInstagramLink('https://instagram.com/p/Cxyz12345/')?.embed).toBe('https://www.instagram.com/p/Cxyz12345/embed/');
    expect(parseInstagramLink('https://www.instagram.com/reels/Cxyz12345')?.canonical).toBe('https://www.instagram.com/reel/Cxyz12345/');
    expect(parseInstagramLink('https://m.instagram.com/tv/Cxyz12345/')?.kind).toBe('reel');
    expect(parseInstagramLink('instagram.com/reel/Cxyz12345')?.code).toBe('Cxyz12345');
  });

  it('finds the link inside other words', () => {
    expect(firstUrl('Look at this https://www.instagram.com/reel/Cxyz12345/. Nice!')).toBe('https://www.instagram.com/reel/Cxyz12345/');
    expect(parseInstagramLink('Look at this https://www.instagram.com/reel/Cxyz12345/?utm_source=x. Nice!')?.code).toBe('Cxyz12345');
  });

  it('does not take a profile, a forwarding address or another site for a post', () => {
    expect(parseInstagramLink('https://www.instagram.com/a_creator/')).toBeUndefined();
    expect(parseInstagramLink('https://www.instagram.com/share/reel/BAxyz12345')).toBeUndefined();
    expect(parseInstagramLink('https://example.com/reel/Cxyz12345/')).toBeUndefined();
    expect(parseInstagramLink('https://instagram.com.example.com/reel/Cxyz12345/')).toBeUndefined();
    expect(parseInstagramLink('no link here')).toBeUndefined();
  });
});

describe('cleaning any shared link', () => {
  it('stores an Instagram post under its clean address', () => {
    const shared = parseSharedLink('https://www.instagram.com/reel/Cxyz12345/?igsh=abc');
    expect(shared?.url).toBe('https://www.instagram.com/reel/Cxyz12345/');
    expect(shared?.host).toBe('instagram.com');
    expect(shared?.instagram?.code).toBe('Cxyz12345');
  });

  it('keeps another site, without tracking parts, and offers no player', () => {
    const shared = parseSharedLink('http://www.example.com/looks/autumn?utm_source=mail&id=7#top');
    expect(shared).toEqual({ url: 'https://www.example.com/looks/autumn?id=7', host: 'example.com' });
  });

  it('keeps an Instagram forwarding address as a plain link', () => {
    const shared = parseSharedLink('https://www.instagram.com/share/reel/BAxyz12345');
    expect(shared?.instagram).toBeUndefined();
    expect(shared?.host).toBe('instagram.com');
  });

  it('refuses text that is not a web address', () => {
    expect(parseSharedLink('cream trousers')).toBeUndefined();
    expect(parseSharedLink('javascript:alert(1)')).toBeUndefined();
    expect(parseSharedLink('https://localhost/x')).toBeUndefined();
  });
});

describe('telling two links apart', () => {
  it('treats two addresses of one post as the same', () => {
    expect(sameLink('https://www.instagram.com/a_creator/reel/Cxyz12345/', 'https://instagram.com/reel/Cxyz12345/?igsh=1')).toBe(true);
    expect(sameLink('https://www.instagram.com/reel/Cxyz12345/', 'https://www.instagram.com/reel/Other12345/')).toBe(false);
    expect(sameLink('https://www.example.com/a/', 'http://example.com/a')).toBe(true);
    expect(sameLink(undefined, 'https://example.com/a')).toBe(false);
  });
});

describe('a creator as typed', () => {
  it('tidies a handle and leaves a name alone', () => {
    expect(cleanCreator(' @A_Creator ')).toBe('@a_creator');
    expect(cleanCreator('Some  Stylist')).toBe('Some Stylist');
    expect(cleanCreator('  ')).toBeUndefined();
  });
});

import type { WishOption } from './types';

/**
 * "Find options": leads from the AI provider's own web search.
 *
 * A lead is a link the search returned, with what the model made of the
 * search result. Nobody has opened the page: not the model, not the server,
 * not the phone. So a lead is always stored as unchecked, and stays that way
 * until the owner taps through and records what the page says.
 *
 * The server and the app both use this file.
 */

/** What the app sends. Only what a search needs: the piece, the size, the stores and the rules. */
export interface LeadsRequest {
  /** "Cream pleated trousers in a winter cloth" */
  name: string;
  /** Cut, cloth and details to look for. */
  lookFor?: string;
  /** "Pants 30 x 30" */
  size?: string;
  /** The owner's stores, by name. Leads from them come first. */
  stores?: string[];
  /** Style rules a product must not break, as sentences. */
  rules?: string[];
  /** Products already on the line, so the search brings new ones. */
  have?: string[];
}

export const LEADS_LIMITS = {
  name: 120,
  lookFor: 600,
  size: 60,
  listItems: 12,
  listItemChars: 200,
};

export interface Lead {
  role: 'exact' | 'lookalike';
  /** The product's name as the search result gives it. */
  name: string;
  store: string;
  /** Exactly as the search returned it. */
  url: string;
  /** In US dollars, only when the search result itself showed one. */
  price?: number;
  /** For a lookalike: what it gives up. For an exact item: how it differs from what was asked. */
  givesUp?: string;
  note?: string;
  /** The title of the search result the link came from. */
  resultTitle?: string;
  /** How old the search engine says the page is, when it says. */
  pageAge?: string;
  /** Pairs an exact item with its cheaper lookalike. */
  pair: number;
}

export interface LeadsResult {
  leads: Lead[];
  /** What the model wants the owner to know, such as "no store had it in a winter cloth". */
  note?: string;
  /** Searches the provider ran. */
  searches: number;
  /** Leads left out because their link was not among the search results. */
  dropped: number;
}

/** A page the provider's search returned. */
export interface SeenPage {
  url: string;
  title?: string;
  pageAge?: string;
}

/** Two addresses are the same page when they match apart from case of the host, a trailing slash and the part after #. */
export function pageKey(url: string): string | undefined {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return undefined;
    parsed.hash = '';
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return undefined;
  }
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function price(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000 ? Math.round(value * 100) / 100 : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The most pairs one answer may carry. */
export const MAX_PAIRS = 4;

/**
 * Turns the model's answer into leads, and keeps only links the search itself
 * returned. A model can misremember or make up an address. One that is not in
 * the search results is left out and counted.
 *
 * A lookalike that is not cheaper than its exact item is left out too: the
 * point of a lookalike is the lower price.
 */
export function cleanLeads(raw: unknown, seen: SeenPage[]): Pick<LeadsResult, 'leads' | 'note' | 'dropped'> {
  const pages = new Map<string, SeenPage>();
  for (const page of seen) {
    const key = pageKey(page.url);
    if (key && !pages.has(key)) pages.set(key, page);
  }
  const answer = isRecord(raw) ? raw : {};
  const pairs = Array.isArray(answer.pairs) ? answer.pairs.slice(0, MAX_PAIRS) : [];
  const leads: Lead[] = [];
  const used = new Set<string>();
  let dropped = 0;

  const read = (value: unknown, role: Lead['role'], pair: number): Lead | undefined => {
    if (!isRecord(value)) return undefined;
    const key = typeof value.url === 'string' ? pageKey(value.url) : undefined;
    const page = key ? pages.get(key) : undefined;
    const name = text(value.name, 140);
    const store = text(value.store, 60);
    if (!key || !page || !name || !store || used.has(key)) {
      dropped += 1;
      return undefined;
    }
    used.add(key);
    return {
      role,
      name,
      store,
      url: page.url,
      price: price(value.price),
      givesUp: text(value.givesUp, 240),
      note: text(value.note, 240),
      resultTitle: text(page.title, 140),
      pageAge: text(page.pageAge, 40),
      pair,
    };
  };

  pairs.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const exact = read(entry.exact, 'exact', index);
    let lookalike = read(entry.lookalike, 'lookalike', index);
    if (exact && lookalike && exact.price !== undefined && lookalike.price !== undefined && lookalike.price >= exact.price) {
      used.delete(pageKey(lookalike.url)!);
      lookalike = undefined;
      dropped += 1;
    }
    if (exact) leads.push(exact);
    if (lookalike) leads.push(lookalike);
  });
  return { leads, note: text(answer.note, 400), dropped };
}

/** A lead as a product on the list: marked as an AI lead, with no store check. */
export function leadToOption(lead: Lead, id: string, today: string): WishOption {
  const from = lead.resultTitle ? `Search result: "${lead.resultTitle}"${lead.pageAge ? `, ${lead.pageAge}` : ''}.` : undefined;
  return {
    id,
    role: lead.role,
    name: lead.name,
    store: lead.store,
    url: lead.url,
    price: lead.price,
    givesUp: lead.givesUp,
    note: [lead.note, from].filter(Boolean).join(' ') || undefined,
    source: 'ai-lead',
    addedOn: today,
  };
}

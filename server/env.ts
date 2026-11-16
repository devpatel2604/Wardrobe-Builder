import type { D1Database } from '@cloudflare/workers-types';

export type { D1Database };

/** What Cloudflare hands the server: see wrangler.jsonc. */
export interface Env {
  /** The database: encrypted backups and reminder settings. */
  DB: D1Database;
  /** The built app's static files. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /**
   * The app key. A secret set in the Cloudflare dashboard, never in this
   * repository. The app sends it with every request, and the server answers
   * nobody else. Until it is set the server refuses everything.
   */
  APP_KEY?: string;
}

/** Outside calls go through this, so tests can stand in for the network. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

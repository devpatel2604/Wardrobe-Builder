import type { D1Database } from '@cloudflare/workers-types';

export type { D1Database };

/** What Cloudflare hands the server: see wrangler.jsonc. */
export interface Env {
  /** The database: encrypted backups, reminder settings, the inbox and the day's AI counts. */
  DB: D1Database;
  /** The built app's static files. */
  ASSETS: { fetch(request: Request): Promise<Response> };
  /**
   * The app key. A secret set in the Cloudflare dashboard, never in this
   * repository. The app sends it with every request, and the server answers
   * nobody else. Until it is set the server refuses everything.
   */
  APP_KEY?: string;
  /**
   * The AI provider's key (Anthropic). A secret set in the Cloudflare
   * dashboard, like APP_KEY. It stays on the server: the app never sees it.
   * Until it is set, AI requests are refused and the rest of the server works.
   */
  ANTHROPIC_API_KEY?: string;
  /** Optional. AI calls allowed per day across all kinds. See server/ai/usage.ts for the default. */
  AI_DAILY_LIMIT?: string;
  /** Optional. Another model for a kind, such as "piece-photo=claude-sonnet-5-5". See server/ai/claude.ts. */
  AI_MODELS?: string;
}

/** Outside calls go through this, so tests can stand in for the network. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

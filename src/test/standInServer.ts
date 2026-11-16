import { vi } from 'vitest';

/**
 * A small stand-in for the server, enough for the screens that add a piece.
 * The real server code is tested with the app's data layer in
 * src/data/inboxRepo.test.ts and src/data/tagging.test.ts.
 */
export const STAND_IN_KEY = 'screen-test-key-0123456789';

export interface SharedItem {
  id: string;
  kind: 'photo' | 'page' | 'link' | 'screenshot';
  receivedAt: string;
  url?: string;
  title?: string;
  text?: string;
}

export interface StandIn {
  /** Every call, as "METHOD /path". */
  calls: string[];
  /** What the app sent to the AI route, newest last. */
  aiRequests: { kind: string; body: Record<string, unknown> }[];
  /** True once the server has an AI key. */
  aiReady: boolean;
  /** Stands in for the model: what it answers for a request. */
  ai: (kind: string, body: Record<string, unknown>) => unknown;
  aiUsed: number;
  /** What the share menu sent and the app has not collected yet. */
  shared: SharedItem[];
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function standInServer(): StandIn {
  const state: StandIn = { calls: [], aiRequests: [], aiReady: false, ai: () => ({ subject: 'not-clothing', slots: [], tags: [], unsure: [] }), aiUsed: 0, shared: [] };
  const today = () => ({ used: state.aiUsed, limit: 120 });
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    state.calls.push(`${method} ${path}`);
    if (path === '/api/health') return json({ app: 'wardrobe-builder', server: 1, ready: true });
    if (new Headers(init?.headers).get('Authorization') !== `Bearer ${STAND_IN_KEY}`) return json({ error: 'That app key is not right.' }, 401);
    if (path === '/api/status') return json({ ok: true, backups: { count: 0, latestAt: null }, reminders: 0, pushKey: 'x', inbox: state.shared.length, ai: state.aiReady });
    if (path === '/api/ai' && method === 'GET') {
      return json({
        ready: state.aiReady,
        kinds: [
          { name: 'piece-photo', model: 'claude-opus-5-5', dailyLimit: 60 },
          { name: 'piece-page', model: 'claude-opus-5-5', dailyLimit: 60 },
        ],
        today: today(),
      });
    }
    const aiKind = /^\/api\/ai\/([a-z-]+)$/.exec(path)?.[1];
    if (aiKind && method === 'POST') {
      if (!state.aiReady) return json({ error: 'The server has no AI key yet.', code: 'no-ai-key' }, 503);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      state.aiRequests.push({ kind: aiKind, body });
      state.aiUsed++;
      return json({ kind: aiKind, model: 'claude-opus-5-5', result: state.ai(aiKind, body), usage: { inputTokens: 1500, outputTokens: 300 }, today: today() });
    }
    if (path === '/api/inbox' && method === 'GET') return json({ items: state.shared });
    const inboxId = /^\/api\/inbox\/([a-z0-9]+)$/.exec(path)?.[1];
    if (inboxId && method === 'DELETE') {
      state.shared = state.shared.filter((item) => item.id !== inboxId);
      return json({ ok: true });
    }
    return json({ error: 'There is nothing at that address.' }, 404);
  };
  vi.stubGlobal('fetch', fetcher);
  return state;
}

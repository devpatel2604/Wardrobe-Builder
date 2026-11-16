import { startTestServer, TEST_KEY, type TestServer } from '../../server/testing';

/**
 * The real small server, running against a local in-memory database, with
 * the app's network calls routed straight into it. Tests of the app's backup
 * and reminders go through this, so the app and the server cannot drift apart.
 */
export interface AppServer {
  /** The app key this server accepts. */
  key: string;
  /** Stands in for the browser's fetch. */
  fetch: typeof fetch;
  /** Every call the app made, in order. */
  requests: { method: string; path: string; body?: string }[];
  /** Set to true to make every call fail as if the phone were offline. */
  down: boolean;
  /** Outside calls the server itself made (push service, weather). */
  outside: { url: string; init?: RequestInit }[];
  /**
   * Stands in for the AI provider. Given what the server sent, returns the
   * JSON the model should answer with. Setting it also gives the server an AI key.
   */
  ai?: (request: Record<string, unknown>) => unknown;
  /** Posts to the inbox the way the share-menu Shortcut does. */
  share(fields: Record<string, string>, file?: { bytes: Uint8Array<ArrayBuffer>; type: string }): Promise<Response>;
  /** Stored backups, oldest first, exactly as the server holds them. */
  snapshots(): Promise<{ createdAt: string; data: string; photoIds: string[] }[]>;
  photoIds(): Promise<string[]>;
  deletePhoto(id: string): Promise<void>;
  inner: TestServer;
  reset(): Promise<void>;
  close(): Promise<void>;
}

function isMessageContent(answer: unknown): answer is { messageContent: unknown[] } {
  return typeof answer === 'object' && answer !== null && Array.isArray((answer as { messageContent?: unknown }).messageContent);
}

export async function startAppServer(): Promise<AppServer> {
  const inner = await startTestServer();
  const server: AppServer = {
    key: TEST_KEY,
    requests: [],
    outside: [],
    down: false,
    inner,
    fetch: async (input, init) => {
      const url = new URL(String(input), 'https://wardrobe.example');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : undefined;
      server.requests.push({ method, path: url.pathname, body });
      if (server.down) throw new TypeError('Failed to fetch');
      const headers = new Headers(init?.headers);
      const auth = headers.get('Authorization');
      if (server.ai) inner.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
      return inner.call(method, url.pathname + url.search, {
        body,
        headers: headers.has('Content-Type') ? { 'Content-Type': headers.get('Content-Type')! } : undefined,
        key: auth?.startsWith('Bearer ') ? auth.slice(7) : null,
        fetcher: async (outsideUrl, outsideInit) => {
          server.outside.push({ url: outsideUrl, init: outsideInit });
          if (outsideUrl.startsWith('https://web.push.apple.com/')) return new Response(null, { status: 201 });
          if (outsideUrl.startsWith('https://api.anthropic.com/') && server.ai) {
            const answer = server.ai(JSON.parse(String(outsideInit?.body)) as Record<string, unknown>);
            const message = {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              model: 'claude-opus-5-5',
              // A stand-in that needs more than one block of text, such as a web search with
              // its results, answers { messageContent: [...] } and it is used as it is.
              content: isMessageContent(answer) ? answer.messageContent : [{ type: 'text', text: JSON.stringify(answer) }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 1500, output_tokens: 300 },
            };
            return new Response(JSON.stringify(message), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          throw new Error(`no network for ${outsideUrl}`);
        },
      });
    },
    async share(fields, file) {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      if (file) form.set('file', new Blob([file.bytes], { type: file.type }), 'shared');
      return inner.call('POST', '/api/inbox', { body: form });
    },
    async snapshots() {
      const list = (await (await inner.call('GET', '/api/backup')).json()) as { snapshots: { id: string }[] };
      const all = [];
      for (const { id } of list.snapshots.reverse()) {
        all.push((await (await inner.call('GET', `/api/backup/snapshots/${id}`)).json()) as { createdAt: string; data: string; photoIds: string[] });
      }
      return all;
    },
    async photoIds() {
      return ((await (await inner.call('GET', '/api/backup')).json()) as { photoIds: string[] }).photoIds.sort();
    },
    async deletePhoto(id) {
      await inner.env.DB.batch([
        inner.env.DB.prepare(`DELETE FROM blobs WHERE id = ?`).bind(`photo-${id}`),
        inner.env.DB.prepare(`DELETE FROM chunks WHERE blob_id = ?`).bind(`photo-${id}`),
      ]);
    },
    async reset() {
      server.requests.length = 0;
      server.outside.length = 0;
      server.down = false;
      server.ai = undefined;
      await inner.reset();
    },
    close: () => inner.close(),
  };
  return server;
}

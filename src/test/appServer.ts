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
  /** Stored backups, oldest first, exactly as the server holds them. */
  snapshots(): Promise<{ createdAt: string; data: string; photoIds: string[] }[]>;
  photoIds(): Promise<string[]>;
  deletePhoto(id: string): Promise<void>;
  inner: TestServer;
  reset(): Promise<void>;
  close(): Promise<void>;
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
      return inner.call(method, url.pathname + url.search, {
        body,
        key: auth?.startsWith('Bearer ') ? auth.slice(7) : null,
        fetcher: async (outsideUrl, outsideInit) => {
          server.outside.push({ url: outsideUrl, init: outsideInit });
          if (outsideUrl.startsWith('https://web.push.apple.com/')) return new Response(null, { status: 201 });
          throw new Error(`no network for ${outsideUrl}`);
        },
      });
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
      await inner.reset();
    },
    close: () => inner.close(),
  };
  return server;
}

import { getPlatformProxy } from 'wrangler';
import type { Env, Fetch } from './env';
import { handleApi } from './index';
import { errorResponse } from './http';
import { ensureSchema, eraseAll } from './schema';

/**
 * Test helpers. The server code runs against a real local copy of the
 * Cloudflare database (in memory, thrown away afterwards), so the SQL is
 * tested as it will run.
 */
export const TEST_KEY = 'test-key-0123456789-abcdef';

export interface TestServer {
  env: Env;
  /** Calls the server the way the app does. Pass key: null to send no key. */
  call(method: string, path: string, options?: { body?: unknown; key?: string | null; now?: Date; fetcher?: Fetch }): Promise<Response>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const noNetwork: Fetch = async (input) => {
  throw new Error(`Unexpected outside call in a test: ${input}`);
};

export async function startTestServer(): Promise<TestServer> {
  const proxy = await getPlatformProxy<Env>({ persist: false });
  const env: Env = { DB: proxy.env.DB, ASSETS: proxy.env.ASSETS, APP_KEY: TEST_KEY };
  return {
    env,
    async call(method, path, options = {}) {
      const headers: Record<string, string> = {};
      const key = options.key === undefined ? TEST_KEY : options.key;
      if (key) headers.Authorization = `Bearer ${key}`;
      let body: string | undefined;
      if (typeof options.body === 'string') body = options.body;
      else if (options.body !== undefined) body = JSON.stringify(options.body);
      const request = new Request(`https://wardrobe.example${path}`, { method, headers, body });
      try {
        return await handleApi(request, env, options.fetcher ?? noNetwork, options.now);
      } catch (error) {
        return errorResponse(error);
      }
    },
    async reset() {
      await ensureSchema(env.DB);
      await eraseAll(env.DB);
    },
    close: () => proxy.dispose(),
  };
}

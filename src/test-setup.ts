import { beforeEach } from 'vitest';

// Mock chrome APIs for unit tests in Vitest environment
const mockLocal = new Map<string, unknown>();
const mockSession = new Map<string, unknown>();

// Define chrome mock
const chromeMock = {
  runtime: {
    id: 'test-extension-id-12345',
    lastError: null as { message: string } | null,
    sendMessage: async (_message: unknown) => ({ success: true }),
    onMessage: {
      addListener: () => {},
      removeListener: () => {},
    },
    onConnect: {
      addListener: () => {},
      removeListener: () => {},
    },
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => {
        if (!keys) {
          return Object.fromEntries(mockLocal.entries());
        }
        if (typeof keys === 'string') {
          return { [keys]: mockLocal.get(keys) };
        }
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((k) => [k, mockLocal.get(k)]));
        }
        const result: Record<string, unknown> = {};
        for (const [k, defaultVal] of Object.entries(keys)) {
          result[k] = mockLocal.has(k) ? mockLocal.get(k) : defaultVal;
        }
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          mockLocal.set(k, v);
        }
      },
      remove: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) {
          mockLocal.delete(k);
        }
      },
      clear: async () => {
        mockLocal.clear();
      },
    },
    session: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => {
        if (!keys) {
          return Object.fromEntries(mockSession.entries());
        }
        if (typeof keys === 'string') {
          return { [keys]: mockSession.get(keys) };
        }
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((k) => [k, mockSession.get(k)]));
        }
        const result: Record<string, unknown> = {};
        for (const [k, defaultVal] of Object.entries(keys)) {
          result[k] = mockSession.has(k) ? mockSession.get(k) : defaultVal;
        }
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          mockSession.set(k, v);
        }
      },
      remove: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) {
          mockSession.delete(k);
        }
      },
      clear: async () => {
        mockSession.clear();
      },
    },
  },
  tabs: {
    query: async () => [{ id: 1, url: 'https://example.com', active: true }],
    create: async ({ url }: { url: string }) => ({ id: 2, url, active: true }),
    update: async (tabId: number, props: unknown) => ({ id: tabId, ...props as object }),
    sendMessage: async (_tabId: number, _msg: unknown) => ({ success: true }),
    captureVisibleTab: (_opts: unknown, cb: (dataUrl: string) => void) => {
      cb('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
    },
    onUpdated: {
      addListener: () => {},
      removeListener: () => {},
    },
  },
  scripting: {
    executeScript: async () => [{ result: true }],
    insertCSS: async () => {},
  },
};

// Assign to global
(globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;

beforeEach(() => {
  mockLocal.clear();
  mockSession.clear();
});

import { describe, expect, it } from 'vitest';
import { registerPwaManifestRoute } from './pwa-manifest-routes.js';

const createResponse = () => ({
  headers: new Map(),
  contentType: '',
  body: '',
  setHeader(name, value) {
    this.headers.set(name, value);
    return this;
  },
  type(value) {
    this.contentType = value;
    return this;
  },
  send(value) {
    this.body = value;
    return this;
  },
});

describe('PWA manifest route', () => {
  it('does not query sessions when building scoped manifests', async () => {
    const routes = new Map();
    const app = {
      get(route, handler) {
        routes.set(route, handler);
      },
    };
    const originalFetch = globalThis.fetch;
    const fetchCalls = [];
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url));
      const sessions = String(url).includes('?directory=')
        ? []
        : [
            {
              id: 'other-session',
              title: 'Other project',
              directory: '/workspace/other',
              time: { updated: 2 },
            },
          ];
      return {
        ok: true,
        json: async () => sessions,
      };
    };

    try {
      registerPwaManifestRoute(app, {
        process: { platform: 'darwin' },
        readSettingsFromDiskMigrated: async () => ({}),
        normalizePwaAppName: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
        normalizePwaOrientation: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
      });

      const handler = routes.get('/manifest.webmanifest');
      const res = createResponse();
      await handler({ query: {} }, res);

      const manifest = JSON.parse(res.body);
      expect(fetchCalls).toHaveLength(0);
      expect(manifest.shortcuts).toEqual([
        {
          name: 'Appearance Settings',
          short_name: 'Settings',
          description: 'Open appearance settings',
          url: '/?settings=appearance',
          icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not query sessions when building root-scoped manifests', async () => {
    const routes = new Map();
    const app = {
      get(route, handler) {
        routes.set(route, handler);
      },
    };
    const originalFetch = globalThis.fetch;
    const fetchCalls = [];
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url));
      return {
        ok: true,
        json: async () => [
          {
            id: 'root-child',
            title: 'Root child',
            directory: '/workspace/app',
            time: { updated: 2 },
          },
        ],
      };
    };

    try {
      registerPwaManifestRoute(app, {
        process: { platform: 'darwin' },
        readSettingsFromDiskMigrated: async () => ({}),
        normalizePwaAppName: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
        normalizePwaOrientation: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
      });

      const handler = routes.get('/manifest.webmanifest');
      const res = createResponse();
      await handler({ query: {} }, res);

      const manifest = JSON.parse(res.body);
      expect(fetchCalls).toEqual([]);
      expect(manifest.shortcuts).toContainEqual({
        name: 'Appearance Settings',
        short_name: 'Settings',
        description: 'Open appearance settings',
        url: '/?settings=appearance',
        icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

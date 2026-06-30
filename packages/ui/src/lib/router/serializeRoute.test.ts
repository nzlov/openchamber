import { describe, expect, test } from 'bun:test';
import { updateBrowserURL } from './serializeRoute';

const originalWindow = (globalThis as { window?: unknown }).window;

const restoreWindow = () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: originalWindow,
  });
};

describe('updateBrowserURL', () => {
  test('preserves directory hints for session routes', () => {
    const calls: Array<{ state: unknown; url: string }> = [];
    try {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: {
          location: { pathname: '/', search: '' },
          history: {
            state: {},
            replaceState: (state: unknown, _title: string, url: string) => {
              calls.push({ state, url });
            },
            pushState: (state: unknown, _title: string, url: string) => {
              calls.push({ state, url });
            },
          },
        },
      });

      updateBrowserURL({
        sessionId: '019f02fe-0400-7f52-86b3-5b814c9de199',
        directory: '/home/nzlov/workspaces/github/pets/pets',
        tab: 'chat',
        isSettingsOpen: false,
        settingsPath: 'home',
        diffFile: null,
      }, { replace: true });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('/?session=019f02fe-0400-7f52-86b3-5b814c9de199&directory=%2Fhome%2Fnzlov%2Fworkspaces%2Fgithub%2Fpets%2Fpets');
    } finally {
      restoreWindow();
    }
  });
});

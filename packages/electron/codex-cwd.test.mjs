import { describe, expect, it } from 'vitest';

import { resolveManagedCodexCwd } from './codex-cwd.mjs';

describe('resolveManagedCodexCwd', () => {
  it('defaults managed Codex cwd to the user home directory', () => {
    expect(resolveManagedCodexCwd({ env: {}, homedir: () => '/Users/example' })).toBe('/Users/example');
  });

  it('preserves an explicit cwd override', () => {
    expect(resolveManagedCodexCwd({
      env: { OPENCHAMBER_CODEX_CWD: '/tmp/codex-cwd' },
      homedir: () => '/Users/example',
    })).toBe('/tmp/codex-cwd');
  });

  it('ignores a blank cwd override', () => {
    expect(resolveManagedCodexCwd({
      env: { OPENCHAMBER_CODEX_CWD: '   ' },
      homedir: () => '/Users/example',
    })).toBe('/Users/example');
  });
});

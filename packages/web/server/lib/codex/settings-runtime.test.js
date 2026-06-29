import { describe, expect, it } from 'vitest';

import { createCodexSettingsRuntime } from './settings-runtime.js';

describe('Codex settings runtime', () => {
  it('normalizes only supported Codex config fields', () => {
    const runtime = createCodexSettingsRuntime();

    expect(runtime.normalizeConfig({
      config: {
        model: 'gpt-5.1-codex',
        approval_policy: 'on-request',
        unsupportedBinary: '/old/runtime',
      },
    })).toEqual({
      model: 'gpt-5.1-codex',
      approval_policy: 'on-request',
    });
  });

  it('rejects unknown config update fields', () => {
    const runtime = createCodexSettingsRuntime();

    expect(runtime.normalizeConfigUpdate({
      model: 'gpt-5.1-codex',
      sandbox_mode: 'workspace-write',
    })).toEqual({
      edits: [
        { key: 'model', value: 'gpt-5.1-codex' },
        { key: 'sandbox_mode', value: 'workspace-write' },
      ],
    });
    expect(() => runtime.normalizeConfigUpdate({ unsupportedBinary: '/old/runtime' })).toThrow('Unsupported Codex config field: unsupportedBinary');
  });
});

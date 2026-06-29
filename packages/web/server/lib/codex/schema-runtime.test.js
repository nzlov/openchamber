import { describe, expect, it } from 'vitest';

import { createCodexSchemaRuntime } from './schema-runtime.js';

describe('Codex schema runtime', () => {
  it('rejects unknown fields and missing required fields', () => {
    const runtime = createCodexSchemaRuntime();
    const fields = new Set(['cwd', 'model']);

    expect(runtime.pickKnownFields({ cwd: '/repo', model: 'gpt-5' }, fields)).toEqual({
      cwd: '/repo',
      model: 'gpt-5',
    });
    expect(() => runtime.pickKnownFields({ sessionID: 'old' }, fields)).toThrow('Unsupported Codex request field: sessionID');
    expect(() => runtime.pickKnownFields({}, fields, { required: ['cwd'] })).toThrow('Missing Codex request field: cwd');
  });

  it('normalizes ids and required arrays', () => {
    const runtime = createCodexSchemaRuntime();

    expect(runtime.requireId(' thread-1 ', 'thread id')).toBe('thread-1');
    expect(() => runtime.requireId('', 'thread id')).toThrow('Missing Codex thread id');
    expect(runtime.requireNonEmptyArray([1], 'turn input')).toEqual([1]);
    expect(() => runtime.requireNonEmptyArray([], 'turn input')).toThrow('Codex turn input is required');
  });
});

import { describe, expect, test } from 'bun:test';

import { decodeCodexEventMessage, parseCodexEventFrame } from './events';

describe('Codex event decoding', () => {
  test('accepts valid event frames', () => {
    expect(parseCodexEventFrame({
      sequence: 1,
      receivedAt: '2026-01-01T00:00:00.000Z',
      method: 'thread/started',
      params: { threadId: 'thread-1' },
    })).toEqual({
      sequence: 1,
      receivedAt: '2026-01-01T00:00:00.000Z',
      method: 'thread/started',
      params: { threadId: 'thread-1' },
      raw: null,
    });
  });

  test('rejects malformed event frames instead of replacing state destructively', () => {
    expect(parseCodexEventFrame({ method: 'thread/deleted' })).toBeNull();
    expect(decodeCodexEventMessage('not-json')).toBeNull();
  });
});

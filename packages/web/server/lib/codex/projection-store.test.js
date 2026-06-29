import { describe, expect, it } from 'vitest';

import { createCodexProjectionStore } from './projection-store.js';

describe('Codex projection store', () => {
  it('projects thread, turn, item, and text delta notifications', () => {
    const store = createCodexProjectionStore();

    store.applyNotification({
      method: 'thread/started',
      params: { thread: { id: 'thread-1', status: 'idle' } },
    });
    store.applyNotification({
      method: 'turn/started',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress' } },
    });
    store.applyNotification({
      method: 'item/started',
      params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'item-1' } },
    });
    store.applyNotification({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'hel' },
    });
    store.applyNotification({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'lo' },
    });
    store.applyNotification({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
    });

    expect(store.getSnapshot()).toEqual({
      threads: [expect.objectContaining({ id: 'thread-1', activeTurnId: null })],
      turns: [expect.objectContaining({ id: 'turn-1', status: 'completed' })],
      items: [expect.objectContaining({ id: 'item-1', text: 'hello' })],
    });
  });

  it('preserves references for no-op merges', () => {
    const store = createCodexProjectionStore();
    store.applyNotification({
      method: 'thread/statusChanged',
      params: { threadId: 'thread-1', status: 'idle' },
    });
    const first = store.getSnapshot().threads[0];
    store.applyNotification({
      method: 'thread/statusChanged',
      params: { threadId: 'thread-1', status: 'idle' },
    });
    const second = store.getSnapshot().threads[0];

    expect(second).toBe(first);
  });
});

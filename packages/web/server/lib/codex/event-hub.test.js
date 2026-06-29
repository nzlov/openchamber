import { describe, expect, it, vi } from 'vitest';

import { createCodexEventHub } from './event-hub.js';

describe('Codex event hub', () => {
  it('publishes normalized events and replays bounded history', () => {
    const hub = createCodexEventHub({
      replayLimit: 2,
      now: () => Date.UTC(2026, 0, 1),
      logger: { warn: vi.fn() },
    });
    const live = [];

    const unsubscribe = hub.subscribe((event) => live.push(event), { replay: false });
    hub.publish({ method: 'thread/started', params: { threadId: 'thread-1' } });
    hub.publish({ method: 'turn/started', params: { turnId: 'turn-1' } });
    hub.publish({ method: 'turn/completed', params: { turnId: 'turn-1' } });
    unsubscribe();

    expect(live.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(hub.getReplay().map((event) => event.method)).toEqual(['turn/started', 'turn/completed']);

    const replayed = [];
    hub.subscribe((event) => replayed.push(event), { afterSequence: 2 });
    expect(replayed.map((event) => event.sequence)).toEqual([3]);
  });

  it('isolates subscriber failures', () => {
    const logger = { warn: vi.fn() };
    const hub = createCodexEventHub({ logger });
    const good = vi.fn();
    hub.subscribe(() => {
      throw new Error('subscriber failed');
    });
    hub.subscribe(good);

    hub.publish({ method: 'thread/started' });

    expect(logger.warn).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });
});

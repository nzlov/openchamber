import { describe, expect, test } from 'bun:test';
import { sessionEvents } from './sessionEvents';

describe('sessionEvents', () => {
  test('reports unavailable sessions with a non-empty id', () => {
    const events: Array<{ sessionId: string; reason: 'missing-rollout' }> = [];
    const unsubscribe = sessionEvents.onSessionUnavailable((event) => {
      events.push(event);
    });

    sessionEvents.reportSessionUnavailable({ sessionId: '', reason: 'missing-rollout' });
    sessionEvents.reportSessionUnavailable({ sessionId: 'session-1', reason: 'missing-rollout' });
    unsubscribe();
    sessionEvents.reportSessionUnavailable({ sessionId: 'session-2', reason: 'missing-rollout' });

    expect(events).toEqual([{ sessionId: 'session-1', reason: 'missing-rollout' }]);
  });
});

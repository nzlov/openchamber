import { describe, expect, it } from 'vitest';

import { createHmrStateRuntime } from './hmr-state-runtime.js';

const createRuntime = (globalThisLike = {}) => createHmrStateRuntime({
  globalThisLike,
  stateKey: '__testHmrState',
});

describe('hmr state runtime', () => {
  it('initializes shutdown and signal state only', () => {
    const runtime = createRuntime();

    expect(runtime.getOrCreateHmrState()).toEqual({
      isShuttingDown: false,
      signalsAttached: false,
    });
  });

  it('reuses existing HMR state object', () => {
    const existing = { isShuttingDown: true, signalsAttached: true };
    const runtime = createRuntime({ __testHmrState: existing });

    expect(runtime.getOrCreateHmrState()).toBe(existing);
  });
});

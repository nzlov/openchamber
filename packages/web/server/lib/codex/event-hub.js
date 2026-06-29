const DEFAULT_REPLAY_LIMIT = 200;

const normalizeReplayLimit = (value) => {
  if (!Number.isFinite(value)) return DEFAULT_REPLAY_LIMIT;
  return Math.max(0, Math.trunc(value));
};

export const createCodexEventHub = (dependencies = {}) => {
  const {
    now = () => Date.now(),
    replayLimit = DEFAULT_REPLAY_LIMIT,
    logger = console,
  } = dependencies;

  const limit = normalizeReplayLimit(replayLimit);
  const subscribers = new Set();
  const replay = [];
  let nextSequence = 1;

  const appendReplay = (event) => {
    if (limit <= 0) return;
    replay.push(event);
    while (replay.length > limit) {
      replay.shift();
    }
  };

  const publish = (message) => {
    const method = typeof message?.method === 'string' ? message.method : 'unknown';
    const event = {
      sequence: nextSequence,
      receivedAt: new Date(now()).toISOString(),
      method,
      params: message?.params ?? null,
      raw: message ?? null,
    };
    nextSequence += 1;
    appendReplay(event);

    for (const subscriber of subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        logger.warn?.('[Codex] event subscriber failed:', error);
      }
    }

    return event;
  };

  const subscribe = (handler, options = {}) => {
    if (typeof handler !== 'function') {
      throw new Error('Codex event subscriber must be a function');
    }
    subscribers.add(handler);

    const shouldReplay = options.replay !== false;
    const afterSequence = Number.isFinite(options.afterSequence)
      ? Math.trunc(options.afterSequence)
      : null;
    if (shouldReplay) {
      for (const event of replay) {
        if (afterSequence !== null && event.sequence <= afterSequence) continue;
        handler(event);
      }
    }

    return () => {
      subscribers.delete(handler);
    };
  };

  const getReplay = () => replay.slice();
  const getSubscriberCount = () => subscribers.size;
  const clear = () => {
    replay.length = 0;
  };

  return {
    publish,
    subscribe,
    getReplay,
    getSubscriberCount,
    clear,
  };
};

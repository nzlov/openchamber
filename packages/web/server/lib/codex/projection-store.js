const getThreadId = (value) => (
  typeof value?.threadId === 'string'
    ? value.threadId
    : (typeof value?.thread?.id === 'string' ? value.thread.id : null)
);

const getTurnId = (value) => (
  typeof value?.turnId === 'string'
    ? value.turnId
    : (typeof value?.turn?.id === 'string' ? value.turn.id : null)
);

const getItemId = (value) => (
  typeof value?.itemId === 'string'
    ? value.itemId
    : (typeof value?.item?.id === 'string' ? value.item.id : null)
);

const mergeIfChanged = (previous, patch) => {
  const base = previous || {};
  let changed = !previous;
  for (const [key, value] of Object.entries(patch)) {
    if (base[key] !== value) {
      changed = true;
      break;
    }
  }
  return changed ? { ...base, ...patch } : previous;
};

export const createCodexProjectionStore = () => {
  const threads = new Map();
  const turns = new Map();
  const items = new Map();

  const upsertThread = (threadId, patch) => {
    if (!threadId) return null;
    const next = mergeIfChanged(threads.get(threadId), { id: threadId, ...patch });
    threads.set(threadId, next);
    return next;
  };

  const upsertTurn = (turnId, patch) => {
    if (!turnId) return null;
    const next = mergeIfChanged(turns.get(turnId), { id: turnId, ...patch });
    turns.set(turnId, next);
    return next;
  };

  const upsertItem = (itemId, patch) => {
    if (!itemId) return null;
    const next = mergeIfChanged(items.get(itemId), { id: itemId, ...patch });
    items.set(itemId, next);
    return next;
  };

  const applyNotification = (message) => {
    const method = typeof message?.method === 'string' ? message.method : '';
    const params = message?.params && typeof message.params === 'object' ? message.params : {};

    if (method === 'thread/started') {
      const threadId = getThreadId(params);
      upsertThread(threadId, {
        raw: params.thread,
        archived: false,
        status: params.thread?.status ?? 'idle',
        updatedAt: Date.now(),
      });
      return { changed: Boolean(threadId), entity: 'thread', id: threadId };
    }

    if (method === 'thread/statusChanged') {
      const threadId = getThreadId(params);
      upsertThread(threadId, { status: params.status, updatedAt: Date.now() });
      return { changed: Boolean(threadId), entity: 'thread', id: threadId };
    }

    if (method === 'thread/nameUpdated') {
      const threadId = getThreadId(params);
      upsertThread(threadId, { title: params.threadName ?? null, updatedAt: Date.now() });
      return { changed: Boolean(threadId), entity: 'thread', id: threadId };
    }

    if (method === 'thread/archived' || method === 'thread/unarchived') {
      const threadId = getThreadId(params);
      upsertThread(threadId, { archived: method === 'thread/archived', updatedAt: Date.now() });
      return { changed: Boolean(threadId), entity: 'thread', id: threadId };
    }

    if (method === 'thread/deleted') {
      const threadId = getThreadId(params);
      if (threadId) threads.delete(threadId);
      return { changed: Boolean(threadId), entity: 'thread', id: threadId };
    }

    if (method === 'turn/started' || method === 'turn/completed') {
      const threadId = getThreadId(params);
      const turnId = getTurnId(params);
      upsertTurn(turnId, {
        threadId,
        raw: params.turn,
        status: params.turn?.status ?? (method === 'turn/started' ? 'inProgress' : 'completed'),
        updatedAt: Date.now(),
      });
      if (threadId) {
        upsertThread(threadId, {
          activeTurnId: method === 'turn/started' ? turnId : null,
          updatedAt: Date.now(),
        });
      }
      return { changed: Boolean(turnId), entity: 'turn', id: turnId };
    }

    if (method === 'item/started' || method === 'item/completed') {
      const itemId = getItemId(params);
      upsertItem(itemId, {
        threadId: getThreadId(params),
        turnId: getTurnId(params),
        raw: params.item,
        status: method === 'item/started' ? 'inProgress' : 'completed',
        updatedAt: Date.now(),
      });
      return { changed: Boolean(itemId), entity: 'item', id: itemId };
    }

    if (method === 'item/agentMessage/delta' || method === 'item/fileChange/outputDelta') {
      const itemId = getItemId(params);
      const previous = items.get(itemId);
      const text = `${previous?.text || ''}${typeof params.delta === 'string' ? params.delta : ''}`;
      upsertItem(itemId, {
        threadId: getThreadId(params),
        turnId: getTurnId(params),
        text,
        updatedAt: Date.now(),
      });
      return { changed: Boolean(itemId), entity: 'item', id: itemId };
    }

    return { changed: false, entity: null, id: null };
  };

  const getSnapshot = () => ({
    threads: Array.from(threads.values()),
    turns: Array.from(turns.values()),
    items: Array.from(items.values()),
  });

  const clear = () => {
    threads.clear();
    turns.clear();
    items.clear();
  };

  return {
    applyNotification,
    getSnapshot,
    clear,
  };
};

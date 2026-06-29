import readline from 'readline';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const formatRpcError = (error) => {
  if (!error || typeof error !== 'object') {
    return String(error || 'Unknown Codex RPC error');
  }
  const message = typeof error.message === 'string' ? error.message : 'Unknown Codex RPC error';
  const code = typeof error.code === 'number' ? ` (${error.code})` : '';
  return `${message}${code}`;
};

export const createCodexRpcClient = (dependencies = {}) => {
  const {
    readable,
    writable,
    logger = console,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = dependencies;

  if (!readable || !writable) {
    throw new Error('createCodexRpcClient requires readable and writable streams');
  }

  let nextId = 1;
  let closed = false;
  const pending = new Map();
  const notificationHandlers = new Set();
  const serverRequestHandlers = new Set();

  const writeMessage = (message) => {
    if (closed) {
      throw new Error('Codex RPC client is closed');
    }
    writable.write(`${JSON.stringify(message)}\n`);
  };

  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeoutFn(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  const close = (error = new Error('Codex RPC client closed')) => {
    if (closed) return;
    closed = true;
    rejectPending(error);
    lineReader.close();
  };

  const handleResponse = (message) => {
    const key = String(message.id);
    const entry = pending.get(key);
    if (!entry) {
      return;
    }

    pending.delete(key);
    clearTimeoutFn(entry.timer);
    if (message.error) {
      entry.reject(new Error(`${entry.method} failed: ${formatRpcError(message.error)}`));
      return;
    }
    entry.resolve(message.result);
  };

  const handleNotification = (message) => {
    for (const handler of notificationHandlers) {
      try {
        handler(message);
      } catch (error) {
        logger.warn?.('[Codex] notification handler failed:', error);
      }
    }
  };

  const handleServerRequest = async (message) => {
    for (const handler of serverRequestHandlers) {
      try {
        const handled = await handler(message);
        if (handled !== undefined) {
          writeMessage({ id: message.id, result: handled });
          return;
        }
      } catch (error) {
        writeMessage({
          id: message.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        });
        return;
      }
    }

    writeMessage({
      id: message.id,
      error: {
        code: -32601,
        message: `Unhandled Codex runtime request: ${message.method}`,
      },
    });
  };

  const handleLine = (line) => {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      logger.warn?.('[Codex] failed to parse app-server JSON-RPC line:', error);
      return;
    }

    if (message && Object.prototype.hasOwnProperty.call(message, 'id') && (Object.prototype.hasOwnProperty.call(message, 'result') || Object.prototype.hasOwnProperty.call(message, 'error'))) {
      handleResponse(message);
      return;
    }

    if (message && Object.prototype.hasOwnProperty.call(message, 'id') && typeof message.method === 'string') {
      void handleServerRequest(message);
      return;
    }

    if (message && typeof message.method === 'string') {
      handleNotification(message);
    }
  };

  const lineReader = readline.createInterface({ input: readable });
  lineReader.on('line', handleLine);
  readable.on?.('error', (error) => {
    close(error instanceof Error ? error : new Error(String(error)));
  });
  readable.on?.('end', () => {
    close(new Error('Codex RPC stream ended'));
  });

  const request = (method, params, options = {}) => {
    if (closed) {
      return Promise.reject(new Error('Codex RPC client is closed'));
    }

    const id = nextId;
    nextId += 1;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, Math.trunc(options.timeoutMs)) : requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeoutFn(() => {
        pending.delete(String(id));
        reject(new Error(`Codex RPC request timed out: ${method}`));
      }, timeoutMs);

      pending.set(String(id), { resolve, reject, timer, method });

      try {
        writeMessage({
          id,
          method,
          ...(params === undefined ? {} : { params }),
        });
      } catch (error) {
        pending.delete(String(id));
        clearTimeoutFn(timer);
        reject(error);
      }
    });
  };

  const notify = (method, params) => {
    writeMessage({
      method,
      ...(params === undefined ? {} : { params }),
    });
  };

  const onNotification = (handler) => {
    notificationHandlers.add(handler);
    return () => notificationHandlers.delete(handler);
  };

  const onServerRequest = (handler) => {
    serverRequestHandlers.add(handler);
    return () => serverRequestHandlers.delete(handler);
  };

  return {
    request,
    notify,
    onNotification,
    onServerRequest,
    close,
  };
};


import { createCodexRpcClient } from './rpc-client.js';
import { createCodexProtocolRuntime } from './protocol-runtime.js';
import { createCodexApprovalRuntime } from './approval-runtime.js';
import { createCodexEventHub } from './event-hub.js';
import { createCodexProjectionStore } from './projection-store.js';

const DEFAULT_CODEX_BINARY = 'codex';
const CODEX_APP_SERVER_ARGS = ['app-server', '--stdio'];
const STDERR_LIMIT_BYTES = 16 * 1024;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

const normalizeConfiguredBinary = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export const resolveCodexBinary = (processLike = process) => {
  const env = processLike?.env ?? {};
  const configured = normalizeConfiguredBinary(env.OPENCHAMBER_CODEX_BINARY);
  if (configured) {
    return { binary: configured, source: 'OPENCHAMBER_CODEX_BINARY' };
  }

  const fallbackConfigured = normalizeConfiguredBinary(env.CODEX_BINARY);
  if (fallbackConfigured) {
    return { binary: fallbackConfigured, source: 'CODEX_BINARY' };
  }

  return { binary: DEFAULT_CODEX_BINARY, source: 'PATH' };
};

const appendBounded = (current, chunk, limitBytes) => {
  const next = `${current}${chunk}`;
  if (Buffer.byteLength(next, 'utf8') <= limitBytes) {
    return next;
  }
  return next.slice(-limitBytes);
};

const waitForChildExit = async (target, timeoutMs) => {
  if (!target || typeof target.once !== 'function') {
    return false;
  }

  const normalizedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 0
    ? Math.trunc(timeoutMs)
    : DEFAULT_STOP_TIMEOUT_MS;

  return await new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(exited);
    };

    target.once('exit', () => finish(true));
    timer = setTimeout(() => finish(false), normalizedTimeoutMs);
    timer.unref?.();
  });
};

export const createCodexProcessRuntime = (dependencies = {}) => {
  const {
    spawn,
    processLike = process,
    logger = console,
    now = () => Date.now(),
    createRpcClient = createCodexRpcClient,
    createProtocolRuntime = createCodexProtocolRuntime,
    eventHub = createCodexEventHub({ now, logger }),
    projectionStore = createCodexProjectionStore(),
    approvalRuntime = createCodexApprovalRuntime({ now, logger }),
  } = dependencies;

  if (typeof spawn !== 'function') {
    throw new Error('createCodexProcessRuntime requires a spawn function');
  }

  let child = null;
  let status = 'stopped';
  let startedAt = null;
  let exitedAt = null;
  let lastError = null;
  let lastExitCode = null;
  let lastExitSignal = null;
  let lastStderr = '';
  let resolvedBinary = resolveCodexBinary(processLike);
  let stopping = false;
  let rpcClient = null;
  let protocolRuntime = null;
  let initialized = false;
  let initializeResponse = null;
  let initializeInFlight = null;

  const getHealthSnapshot = () => ({
    status,
    running: status === 'running' && Boolean(child),
    initialized,
    transport: 'stdio',
    binary: resolvedBinary.binary,
    binarySource: resolvedBinary.source,
    pid: typeof child?.pid === 'number' ? child.pid : null,
    startedAt,
    exitedAt,
    userAgent: initializeResponse?.userAgent || null,
    codexHome: initializeResponse?.codexHome || null,
    platformFamily: initializeResponse?.platformFamily || null,
    platformOs: initializeResponse?.platformOs || null,
    lastError,
    lastExitCode,
    lastExitSignal,
    lastStderr: lastStderr || null,
  });

  const closeRpcClient = (error) => {
    approvalRuntime.clearPending?.(error);
    if (rpcClient && typeof rpcClient.close === 'function') {
      try {
        rpcClient.close(error);
      } catch {
      }
    }
    rpcClient = null;
    protocolRuntime = null;
    initialized = false;
    initializeResponse = null;
    initializeInFlight = null;
  };

  const clearChild = (target) => {
    if (child === target) {
      child = null;
    }
  };

  const attachChildListeners = (target) => {
    target.stderr?.on?.('data', (chunk) => {
      lastStderr = appendBounded(lastStderr, String(chunk), STDERR_LIMIT_BYTES);
    });

    target.once?.('error', (error) => {
      lastError = error instanceof Error ? error.message : String(error);
      status = 'error';
      exitedAt = new Date(now()).toISOString();
      closeRpcClient(error instanceof Error ? error : new Error(String(error)));
      clearChild(target);
      logger.warn?.('[Codex] app-server process error:', lastError);
    });

    target.once?.('exit', (code, signal) => {
      lastExitCode = typeof code === 'number' ? code : null;
      lastExitSignal = typeof signal === 'string' ? signal : null;
      exitedAt = new Date(now()).toISOString();
      status = stopping ? 'stopped' : 'exited';
      stopping = false;
      closeRpcClient(new Error('Codex app-server process exited'));
      clearChild(target);
    });
  };

  const start = async (options = {}) => {
    if (child && status === 'running') {
      return child;
    }

    resolvedBinary = resolveCodexBinary(processLike);
    lastError = null;
    lastExitCode = null;
    lastExitSignal = null;
    lastStderr = '';
    exitedAt = null;
    stopping = false;
    initialized = false;
    initializeResponse = null;
    status = 'starting';

    try {
      const nextChild = spawn(resolvedBinary.binary, CODEX_APP_SERVER_ARGS, {
        cwd: typeof options.cwd === 'string' && options.cwd.trim() ? options.cwd : undefined,
        env: { ...(processLike?.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child = nextChild;
      startedAt = new Date(now()).toISOString();
      rpcClient = createRpcClient({
        readable: nextChild.stdout,
        writable: nextChild.stdin,
        logger,
      });
      rpcClient.onNotification?.((message) => {
        eventHub.publish(message);
        projectionStore.applyNotification(message);
      });
      rpcClient.onServerRequest?.((message) => approvalRuntime.handleServerRequest(message));
      protocolRuntime = createProtocolRuntime({ rpcClient });
      status = 'running';
      attachChildListeners(nextChild);
      return nextChild;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      exitedAt = new Date(now()).toISOString();
      status = 'error';
      child = null;
      throw error;
    }
  };

  const initialize = async (options = {}) => {
    if (child && status === 'running' && initialized && initializeResponse) {
      return initializeResponse;
    }

    if (initializeInFlight) {
      return initializeInFlight;
    }

    if (!child || status !== 'running') {
      await start({ cwd: options.cwd });
    }

    if (!protocolRuntime || typeof protocolRuntime.initialize !== 'function') {
      throw new Error('Codex protocol runtime is unavailable');
    }

    initializeInFlight = (async () => {
      initializeResponse = await protocolRuntime.initialize({
        clientInfo: options.clientInfo,
        capabilities: options.capabilities,
        requestOptions: options.requestOptions,
      });
      initialized = true;
      lastError = null;
      return initializeResponse;
    })();

    try {
      return await initializeInFlight;
    } catch (error) {
      initialized = false;
      initializeResponse = null;
      lastError = error instanceof Error ? error.message : String(error);
      status = 'error';
      throw error;
    } finally {
      initializeInFlight = null;
    }
  };

  const startAndInitialize = async (options = {}) => {
    await start(options);
    return initialize(options);
  };

  const stop = async (options = {}) => {
    if (!child) {
      status = 'stopped';
      closeRpcClient(new Error('Codex app-server process stopped'));
      return false;
    }

    const target = child;
    const signal = typeof options.signal === 'string' && options.signal ? options.signal : 'SIGTERM';
    stopping = true;
    if (typeof target.kill === 'function') {
      const exitPromise = waitForChildExit(target, options.timeoutMs);
      target.kill(signal);
      const exited = await exitPromise;
      if (!exited && child === target) {
        closeRpcClient(new Error('Codex app-server stop timed out'));
        clearChild(target);
        status = 'stopped';
        stopping = false;
      }
      return true;
    }

    closeRpcClient(new Error('Codex app-server process stopped'));
    clearChild(target);
    status = 'stopped';
    return false;
  };

  const restart = async (options = {}) => {
    await stop({
      signal: options.signal,
      timeoutMs: options.stopTimeoutMs,
    });
    return startAndInitialize(options);
  };

  const getProtocolRuntime = () => protocolRuntime;

  return {
    start,
    initialize,
    startAndInitialize,
    restart,
    stop,
    dispose: stop,
    getProtocolRuntime,
    getHealthSnapshot,
    getEventHub: () => eventHub,
    getProjectionStore: () => projectionStore,
    getApprovalRuntime: () => approvalRuntime,
  };
};

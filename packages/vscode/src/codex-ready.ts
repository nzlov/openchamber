import type { ConnectionStatus, CodexManager } from './codex';

const API_URL_WAIT_TIMEOUT_MS = 30000;

export async function waitForApiUrl(
  manager: CodexManager | undefined,
  timeoutMs = API_URL_WAIT_TIMEOUT_MS,
): Promise<string | null> {
  if (!manager) {
    return null;
  }

  // Only hand out a runtime API URL after the active runtime reports connected.
  // VS Code currently has no managed Codex app-server bridge, so the Codex
  // manager returns null and callers surface deterministic unsupported responses.
  const readyUrl = (): string | null => {
    if (manager.getStatus() !== 'connected') {
      return null;
    }
    return manager.getRuntimeApiUrl();
  };

  const initialUrl = readyUrl();
  if (initialUrl) {
    return initialUrl;
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let subscription: { dispose(): void } | null = null;
    let disposeAfterSubscribe = false;

    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (subscription) {
        subscription.dispose();
      } else {
        disposeAfterSubscribe = true;
      }
      resolve(value);
    };

    const handleStatusChange = (status: ConnectionStatus) => {
      // Permanent failure (CLI missing / spawn error) won't recover from holding
      // — fail fast instead of burning the full timeout, matching the web gate's
      // fast 503 for genuinely-down servers.
      if (status === 'error') {
        finish(null);
        return;
      }
      const nextUrl = readyUrl();
      if (nextUrl) {
        finish(nextUrl);
      }
    };

    // onStatusChange invokes the callback synchronously with the current status,
    // so this also covers an already-ready/already-errored manager.
    subscription = manager.onStatusChange(handleStatusChange);
    if (disposeAfterSubscribe) {
      subscription.dispose();
      return;
    }
    if (settled) {
      return;
    }

    timeoutId = setTimeout(() => {
      finish(manager.getRuntimeApiUrl());
    }, timeoutMs);
  });
}

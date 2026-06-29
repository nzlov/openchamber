import { PassThrough } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCodexRpcClient } from './rpc-client.js';

const createHarness = (options = {}) => {
  const readable = new PassThrough();
  const writable = new PassThrough();
  const writes = [];
  writable.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) writes.push(JSON.parse(line));
    }
  });
  const client = createCodexRpcClient({
    readable,
    writable,
    logger: { warn: vi.fn() },
    ...options,
  });
  return { client, readable, writes };
};

describe('Codex RPC client', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('correlates JSON-RPC responses by id', async () => {
    const { client, readable, writes } = createHarness();

    const response = client.request('initialize', { clientInfo: { name: 'openchamber' } });
    expect(writes).toEqual([
      {
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'openchamber' } },
      },
    ]);

    readable.write(`${JSON.stringify({ id: 1, result: { ok: true } })}\n`);

    await expect(response).resolves.toEqual({ ok: true });
  });

  it('rejects JSON-RPC error responses with method context', async () => {
    const { client, readable } = createHarness();

    const response = client.request('thread/start', {});
    readable.write(`${JSON.stringify({ id: 1, error: { code: -32000, message: 'no auth' } })}\n`);

    await expect(response).rejects.toThrow('thread/start failed: no auth (-32000)');
  });

  it('dispatches notifications without requiring a response', () => {
    const { client, readable } = createHarness();
    const handler = vi.fn();
    client.onNotification(handler);

    readable.write(`${JSON.stringify({ method: 'thread/started', params: { threadId: 'thread-1' } })}\n`);

    expect(handler).toHaveBeenCalledWith({
      method: 'thread/started',
      params: { threadId: 'thread-1' },
    });
  });

  it('responds to handled server-initiated requests', async () => {
    const { client, readable, writes } = createHarness();
    client.onServerRequest(async (message) => {
      if (message.method === 'tool/request') return { decision: 'approved' };
      return undefined;
    });

    readable.write(`${JSON.stringify({ id: 9, method: 'tool/request', params: {} })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writes).toContainEqual({
      id: 9,
      result: { decision: 'approved' },
    });
  });

  it('times out pending requests and clears the pending response', async () => {
    vi.useFakeTimers();
    const { client } = createHarness({ requestTimeoutMs: 50 });

    const response = client.request('thread/list', {}).catch((error) => error);
    vi.advanceTimersByTime(50);
    await Promise.resolve();

    await expect(response).resolves.toEqual(expect.any(Error));
    await expect(response).resolves.toHaveProperty('message', 'Codex RPC request timed out: thread/list');
  });

  it('ignores malformed JSON lines while keeping the client usable', async () => {
    const warn = vi.fn();
    const { client, readable, writes } = createHarness({ logger: { warn } });

    readable.write('not-json\n');
    const response = client.request('initialize', {});
    readable.write(`${JSON.stringify({ id: writes[0].id, result: { ok: true } })}\n`);

    expect(warn).toHaveBeenCalled();
    await expect(response).resolves.toEqual({ ok: true });
  });
});

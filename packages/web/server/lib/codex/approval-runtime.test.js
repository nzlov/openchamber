import { describe, expect, it, vi } from 'vitest';

import { createCodexApprovalRuntime } from './approval-runtime.js';

describe('Codex approval runtime', () => {
  it('stores server approval requests and resolves them from explicit replies', async () => {
    const runtime = createCodexApprovalRuntime({
      now: () => Date.UTC(2026, 0, 1),
      logger: { warn: vi.fn() },
    });

    const pendingPromise = runtime.handleServerRequest({
      id: 'request-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'echo hello' },
    });

    expect(runtime.listPending()).toEqual([{
      requestId: 'request-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: 'echo hello' },
      receivedAt: '2026-01-01T00:00:00.000Z',
    }]);

    expect(runtime.reply({
      requestId: 'request-1',
      response: { decision: 'approved' },
    })).toEqual({
      ok: true,
      requestId: 'request-1',
      method: 'item/commandExecution/requestApproval',
    });
    await expect(pendingPromise).resolves.toEqual({ decision: 'approved' });
    expect(runtime.listPending()).toEqual([]);
  });

  it('ignores non-approval server requests so the RPC layer can reject them', () => {
    const runtime = createCodexApprovalRuntime();
    expect(runtime.handleServerRequest({ id: '1', method: 'currentTime/read' })).toBeUndefined();
  });

  it('rejects stale and malformed replies deterministically', () => {
    const runtime = createCodexApprovalRuntime();

    expect(() => runtime.reply({ requestId: '', response: {} })).toThrow('Missing Codex approval request id');
    expect(() => runtime.reply({ requestId: 'missing', response: {} })).toThrow('Codex approval request is not pending');

    runtime.handleServerRequest({
      id: 'request-1',
      method: 'item/fileChange/requestApproval',
      params: {},
    });
    expect(() => runtime.reply({ requestId: 'request-1', response: null })).toThrow('Codex approval response object is required');
  });

  it('clears pending requests on restart or shutdown', async () => {
    const runtime = createCodexApprovalRuntime();
    const pendingPromise = runtime.handleServerRequest({
      id: 'request-1',
      method: 'execCommandApproval',
      params: {},
    });

    runtime.clearPending(new Error('restarting'));

    await expect(pendingPromise).rejects.toThrow('restarting');
    expect(runtime.listPending()).toEqual([]);
  });
});

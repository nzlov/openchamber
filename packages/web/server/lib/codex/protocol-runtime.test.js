import { describe, expect, it, vi } from 'vitest';

import { createCodexProtocolRuntime } from './protocol-runtime.js';

const createHarness = () => {
  const calls = [];
  const rpcClient = {
    request: vi.fn(async (method, params, options) => {
      calls.push({ method, params, options });
      return { ok: true, method, params };
    }),
  };
  const runtime = createCodexProtocolRuntime({ rpcClient });
  return { calls, rpcClient, runtime };
};

describe('Codex protocol runtime', () => {
  it('initializes with OpenChamber client info and experimental Codex API capability', async () => {
    const { runtime, rpcClient } = createHarness();

    await runtime.initialize({
      clientInfo: { name: 'oc', title: 'OC', version: '1.2.3' },
      capabilities: { experimentalApi: false, requestAttestation: true },
      requestOptions: { timeoutMs: 10 },
    });

    expect(rpcClient.request).toHaveBeenCalledWith('initialize', {
      clientInfo: { name: 'oc', title: 'OC', version: '1.2.3' },
      capabilities: {
        experimentalApi: false,
        requestAttestation: true,
        mcpServerOpenaiFormElicitation: false,
      },
    }, { timeoutMs: 10 });
  });

  it('uses deterministic default initialize payloads', async () => {
    const { runtime, rpcClient } = createHarness();

    await runtime.initialize();

    expect(rpcClient.request).toHaveBeenCalledWith('initialize', {
      clientInfo: {
        name: 'openchamber',
        title: 'OpenChamber',
        version: '0.0.0',
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: false,
      },
    }, undefined);
  });

  it('wraps account auth methods with Codex-native method names', async () => {
    const { calls, runtime } = createHarness();

    await runtime.readAccount({ refreshToken: true });
    await runtime.loginAccount({ type: 'apiKey', apiKey: 'sk-test' });
    await runtime.cancelAccountLogin({ loginId: 'login-1' });
    await runtime.logoutAccount();
    await runtime.getAuthStatus({ includeToken: false, refreshToken: true });

    expect(calls.map((call) => call.method)).toEqual([
      'account/read',
      'account/login/start',
      'account/login/cancel',
      'account/logout',
      'getAuthStatus',
    ]);
  });

  it('wraps thread lifecycle methods with Codex-native method names', async () => {
    const { calls, runtime } = createHarness();

    await runtime.startThread({ cwd: '/repo' });
    await runtime.listThreads({ archived: false, limit: 20 });
    await runtime.readThread({ threadId: 'thread-1', includeTurns: true });
    await runtime.archiveThread({ threadId: 'thread-1' });
    await runtime.unarchiveThread({ threadId: 'thread-1' });
    await runtime.setThreadName({ threadId: 'thread-1', threadName: 'name' });
    await runtime.updateThreadSettings({ threadId: 'thread-1', approvalPolicy: 'on-request' });
    await runtime.deleteThread({ threadId: 'thread-1' });

    expect(calls.map((call) => call.method)).toEqual([
      'thread/start',
      'thread/list',
      'thread/read',
      'thread/archive',
      'thread/unarchive',
      'thread/name/set',
      'thread/settings/update',
      'thread/delete',
    ]);
  });

  it('wraps turn methods with Codex-native method names', async () => {
    const { calls, runtime } = createHarness();

    await runtime.startTurn({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'hello' }],
    });
    await runtime.forkThread({ threadId: 'thread-1' });
    await runtime.rollbackThread({ threadId: 'thread-1', numTurns: 1 });
    await runtime.compactThread({ threadId: 'thread-1' });
    await runtime.shellCommand({ threadId: 'thread-1', command: 'pwd' });
    await runtime.steerTurn({ threadId: 'thread-1', turnId: 'turn-1', input: [] });
    await runtime.interruptTurn({ threadId: 'thread-1', turnId: 'turn-1' });

    expect(calls.map((call) => call.method)).toEqual([
      'turn/start',
      'thread/fork',
      'thread/rollback',
      'thread/compact/start',
      'thread/shellCommand',
      'turn/steer',
      'turn/interrupt',
    ]);
  });

  it('fails early when no RPC request function is provided', () => {
    expect(() => createCodexProtocolRuntime({ rpcClient: {} })).toThrow('createCodexProtocolRuntime requires rpcClient.request');
  });

  it('wraps Codex config, model, MCP, and skill methods', async () => {
    const { calls, runtime } = createHarness();

    await runtime.listModels({});
    await runtime.readConfig({});
    await runtime.writeConfigBatch({ edits: [] });
    await runtime.writeConfigValue({ key: 'model', value: 'gpt-5.1-codex' });
    await runtime.listMcpServerStatus({});
    await runtime.listSkills({});

    expect(calls.map((call) => call.method)).toEqual([
      'model/list',
      'config/read',
      'config/batchWrite',
      'config/value/write',
      'mcpServerStatus/list',
      'skills/list',
    ]);
  });
});

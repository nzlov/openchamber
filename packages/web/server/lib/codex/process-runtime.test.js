import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';

import { createCodexProcessRuntime, resolveCodexBinary } from './process-runtime.js';

const createChild = () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 12345;
  child.kill = vi.fn((signal) => {
    child.killedSignal = signal;
    child.emit('exit', null, signal);
    return true;
  });
  return child;
};

describe('Codex process runtime', () => {
  it('resolves the Codex binary from the narrow supported environment order', () => {
    expect(resolveCodexBinary({ env: { OPENCHAMBER_CODEX_BINARY: '/bin/custom', CODEX_BINARY: '/bin/fallback' } })).toEqual({
      binary: '/bin/custom',
      source: 'OPENCHAMBER_CODEX_BINARY',
    });
    expect(resolveCodexBinary({ env: { CODEX_BINARY: '/bin/fallback' } })).toEqual({
      binary: '/bin/fallback',
      source: 'CODEX_BINARY',
    });
    expect(resolveCodexBinary({ env: {} })).toEqual({
      binary: 'codex',
      source: 'PATH',
    });
  });

  it('starts codex app-server with stdio and exposes a health snapshot', async () => {
    const child = createChild();
    const spawn = vi.fn(() => child);
    const runtime = createCodexProcessRuntime({
      spawn,
      processLike: { env: { OPENCHAMBER_CODEX_BINARY: '/opt/codex' } },
      now: () => Date.UTC(2026, 0, 1),
      logger: { warn: vi.fn() },
    });

    await runtime.start({ cwd: '/workspace/app' });

    expect(spawn).toHaveBeenCalledWith('/opt/codex', ['app-server', '--stdio'], {
      cwd: '/workspace/app',
      env: { OPENCHAMBER_CODEX_BINARY: '/opt/codex' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    expect(runtime.getHealthSnapshot()).toEqual(expect.objectContaining({
      status: 'running',
      running: true,
      initialized: false,
      transport: 'stdio',
      binary: '/opt/codex',
      binarySource: 'OPENCHAMBER_CODEX_BINARY',
      pid: 12345,
      startedAt: '2026-01-01T00:00:00.000Z',
    }));
  });

  it('initializes the Codex app-server and exposes negotiated runtime metadata', async () => {
    const child = createChild();
    const rpcClient = { close: vi.fn() };
    const protocolRuntime = {
      initialize: vi.fn(async () => ({
        userAgent: 'codex-cli/0.142.3',
        codexHome: '/home/test/.codex',
        platformFamily: 'unix',
        platformOs: 'linux',
      })),
    };
    const runtime = createCodexProcessRuntime({
      spawn: vi.fn(() => child),
      processLike: { env: {} },
      createRpcClient: vi.fn(() => rpcClient),
      createProtocolRuntime: vi.fn(() => protocolRuntime),
      logger: { warn: vi.fn() },
    });

    await expect(runtime.startAndInitialize({
      clientInfo: { name: 'openchamber', title: 'OpenChamber', version: '1.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })).resolves.toEqual({
      userAgent: 'codex-cli/0.142.3',
      codexHome: '/home/test/.codex',
      platformFamily: 'unix',
      platformOs: 'linux',
    });

    expect(protocolRuntime.initialize).toHaveBeenCalledWith({
      clientInfo: { name: 'openchamber', title: 'OpenChamber', version: '1.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
      requestOptions: undefined,
    });
    expect(runtime.getHealthSnapshot()).toEqual(expect.objectContaining({
      status: 'running',
      running: true,
      initialized: true,
      userAgent: 'codex-cli/0.142.3',
      codexHome: '/home/test/.codex',
      platformFamily: 'unix',
      platformOs: 'linux',
    }));
    expect(runtime.getProtocolRuntime()).toBe(protocolRuntime);
  });

  it('coalesces concurrent initialize calls into one protocol initialize request', async () => {
    const child = createChild();
    const protocolRuntime = {
      initialize: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          userAgent: 'codex-cli/0.142.3',
          codexHome: '/home/test/.codex',
          platformFamily: 'unix',
          platformOs: 'linux',
        };
      }),
    };
    const runtime = createCodexProcessRuntime({
      spawn: vi.fn(() => child),
      processLike: { env: {} },
      createRpcClient: vi.fn(() => ({ close: vi.fn() })),
      createProtocolRuntime: vi.fn(() => protocolRuntime),
      logger: { warn: vi.fn() },
    });

    const [first, second] = await Promise.all([
      runtime.startAndInitialize(),
      runtime.startAndInitialize(),
    ]);

    expect(first).toBe(second);
    expect(protocolRuntime.initialize).toHaveBeenCalledTimes(1);
    expect(runtime.getHealthSnapshot()).toEqual(expect.objectContaining({
      status: 'running',
      running: true,
      initialized: true,
      lastError: null,
    }));
  });

  it('records initialize errors without hiding the diagnostic', async () => {
    const child = createChild();
    const runtime = createCodexProcessRuntime({
      spawn: vi.fn(() => child),
      processLike: { env: {} },
      createRpcClient: vi.fn(() => ({ close: vi.fn() })),
      createProtocolRuntime: vi.fn(() => ({
        initialize: vi.fn(async () => {
          throw new Error('not authenticated');
        }),
      })),
      logger: { warn: vi.fn() },
    });

    await expect(runtime.startAndInitialize()).rejects.toThrow('not authenticated');
    expect(runtime.getHealthSnapshot()).toEqual(expect.objectContaining({
      status: 'error',
      running: false,
      initialized: false,
      lastError: 'not authenticated',
    }));
  });

  it('clears initialized protocol state when the child exits', async () => {
    const child = createChild();
    const rpcClient = { close: vi.fn() };
    const runtime = createCodexProcessRuntime({
      spawn: vi.fn(() => child),
      processLike: { env: {} },
      createRpcClient: vi.fn(() => rpcClient),
      createProtocolRuntime: vi.fn(() => ({
        initialize: vi.fn(async () => ({
          userAgent: 'codex-cli/0.142.3',
          codexHome: '/home/test/.codex',
          platformFamily: 'unix',
          platformOs: 'linux',
        })),
      })),
      logger: { warn: vi.fn() },
    });

    await runtime.startAndInitialize();
    child.emit('exit', 0, null);

    expect(rpcClient.close).toHaveBeenCalled();
    expect(runtime.getProtocolRuntime()).toBeNull();
    expect(runtime.getHealthSnapshot()).toEqual(expect.objectContaining({
      status: 'exited',
      running: false,
      initialized: false,
      userAgent: null,
    }));
  });

  it('captures stderr and exit state without throwing from listeners', async () => {
    const child = createChild();
    const runtime = createCodexProcessRuntime({
      spawn: vi.fn(() => child),
      processLike: { env: {} },
      now: () => Date.UTC(2026, 0, 2),
      logger: { warn: vi.fn() },
    });

    await runtime.start();
    child.stderr.write('diagnostic\n');
    child.emit('exit', 7, null);

    expect(runtime.getHealthSnapshot()).toEqual(expect.objectContaining({
      status: 'exited',
      running: false,
      exitedAt: '2026-01-02T00:00:00.000Z',
      lastExitCode: 7,
      lastExitSignal: null,
      lastStderr: 'diagnostic\n',
    }));
  });

  it('stops the managed child with SIGTERM by default', async () => {
    const child = createChild();
    const runtime = createCodexProcessRuntime({
      spawn: vi.fn(() => child),
      processLike: { env: {} },
      logger: { warn: vi.fn() },
    });

    await runtime.start();
    await runtime.stop();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(runtime.getHealthSnapshot()).toEqual(expect.objectContaining({
      status: 'stopped',
      running: false,
      lastExitSignal: 'SIGTERM',
    }));
  });

  it('restarts by stopping the current child before initializing a new app-server', async () => {
    const firstChild = createChild();
    const secondChild = createChild();
    secondChild.pid = 23456;
    const spawn = vi.fn()
      .mockReturnValueOnce(firstChild)
      .mockReturnValueOnce(secondChild);
    const protocolRuntime = {
      initialize: vi.fn(async () => ({
        userAgent: 'codex-cli/0.142.3',
        codexHome: '/home/test/.codex',
        platformFamily: 'unix',
        platformOs: 'linux',
      })),
    };
    const runtime = createCodexProcessRuntime({
      spawn,
      processLike: { env: {} },
      createRpcClient: vi.fn(() => ({ close: vi.fn() })),
      createProtocolRuntime: vi.fn(() => protocolRuntime),
      logger: { warn: vi.fn() },
    });

    await runtime.startAndInitialize();
    await runtime.restart({ cwd: '/repo' });

    expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][2]).toEqual(expect.objectContaining({ cwd: '/repo' }));
    expect(runtime.getHealthSnapshot()).toEqual(expect.objectContaining({
      status: 'running',
      running: true,
      initialized: true,
      pid: 23456,
    }));
  });

  it('records spawn errors in the health snapshot', async () => {
    const runtime = createCodexProcessRuntime({
      spawn: vi.fn(() => {
        throw new Error('missing codex');
      }),
      processLike: { env: {} },
      now: () => Date.UTC(2026, 0, 3),
      logger: { warn: vi.fn() },
    });

    await expect(runtime.start()).rejects.toThrow('missing codex');
    expect(runtime.getHealthSnapshot()).toEqual(expect.objectContaining({
      status: 'error',
      running: false,
      exitedAt: '2026-01-03T00:00:00.000Z',
      lastError: 'missing codex',
    }));
  });
});

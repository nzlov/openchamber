import { describe, expect, it, vi } from 'vitest';

import { createStartupPipelineRuntime } from './startup-pipeline-runtime.js';

const createHarness = (overrides = {}) => {
  const terminalRuntime = { kind: 'terminal' };
  const serverStartupRuntime = {
    resolveBindHost: vi.fn((host) => host || '127.0.0.1'),
    startListeningAndMaybeTunnel: vi.fn(async () => ({ activePort: 34567 })),
    attachProcessHandlers: vi.fn(),
  };
  const dependencies = {
    createTerminalRuntime: vi.fn(() => terminalRuntime),
    createServerStartupRuntime: vi.fn(() => serverStartupRuntime),
  };
  const runtime = createStartupPipelineRuntime(dependencies);
  const options = {
    app: {},
    server: {},
    express: {},
    fs: {},
    path: {},
    uiAuthController: {},
    buildAugmentedPath: vi.fn(),
    searchPathFor: vi.fn(),
    isExecutable: vi.fn(),
    isRequestOriginAllowed: vi.fn(),
    rejectWebSocketUpgrade: vi.fn(),
    terminalHeartbeatIntervalMs: 15000,
    terminalRebindWindowMs: 60000,
    terminalMaxRebindsPerWindow: 128,
    staticRoutesRuntime: {
      registerApiOnlyFallbackRoutes: vi.fn(),
      registerStaticRoutes: vi.fn(),
    },
    process: { env: {} },
    crypto: {},
    normalizeTunnelBootstrapTtlMs: vi.fn(),
    readSettingsFromDiskMigrated: vi.fn(),
    tunnelAuthController: {},
    startTunnelWithNormalizedRequest: vi.fn(),
    gracefulShutdown: vi.fn(),
    getSignalsAttached: vi.fn(() => false),
    setSignalsAttached: vi.fn(),
    syncToHmrState: vi.fn(),
    TUNNEL_MODE_QUICK: 'quick',
    TUNNEL_MODE_MANAGED_LOCAL: 'managed-local',
    TUNNEL_MODE_MANAGED_REMOTE: 'managed-remote',
    host: '127.0.0.1',
    port: 0,
    startupTunnelRequest: null,
    onTunnelReady: null,
    tunnelRuntimeContext: {
      setActivePort: vi.fn(),
    },
    attachSignals: false,
    apiOnly: false,
    ...overrides,
  };
  return { dependencies, options, runtime, serverStartupRuntime, terminalRuntime };
};

describe('startup pipeline runtime', () => {
  it('does not start or proxy an agent runtime in API-only Web mode', async () => {
    const { options, runtime } = createHarness({ apiOnly: true });

    const result = await runtime.run(options);

    expect(result.messageStreamRuntime).toBeNull();
    expect(options.staticRoutesRuntime.registerApiOnlyFallbackRoutes).toHaveBeenCalledWith(options.app);
    expect(options.staticRoutesRuntime.registerStaticRoutes).not.toHaveBeenCalled();
  });

  it('preserves normal Web startup behavior outside API-only mode', async () => {
    const { options, runtime } = createHarness({ apiOnly: false });

    const result = await runtime.run(options);

    expect(result.messageStreamRuntime).toBeNull();
    expect(options.staticRoutesRuntime.registerStaticRoutes).toHaveBeenCalledWith(options.app);
    expect(options.staticRoutesRuntime.registerApiOnlyFallbackRoutes).not.toHaveBeenCalled();
  });

  it('serves normal Web static routes when runtime startup is skipped', async () => {
    const { options, runtime } = createHarness({ apiOnly: false, skipRuntimeStart: true });

    const result = await runtime.run(options);

    expect(result.messageStreamRuntime).toBeNull();
    expect(options.staticRoutesRuntime.registerStaticRoutes).toHaveBeenCalledWith(options.app);
  });
});

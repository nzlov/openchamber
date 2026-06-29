import { describe, expect, it, vi } from 'vitest';

import { registerCodexRoutes } from './routes.js';

const createRouteHarness = (runtime) => {
  const handlers = new Map();
  const app = {
    use: vi.fn(),
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
    put: (path, handler) => handlers.set(`PUT ${path}`, handler),
    patch: (path, handler) => handlers.set(`PATCH ${path}`, handler),
    delete: (path, handler) => handlers.set(`DELETE ${path}`, handler),
  };

  registerCodexRoutes(app, {
    codexProcessRuntime: runtime,
    express: { json: vi.fn(() => 'json-middleware') },
  });

  const call = async (method, path, request = {}) => {
    const routeHandler = handlers.get(`${method.toUpperCase()} ${path}`);
    expect(routeHandler).toEqual(expect.any(Function));
    const res = {
      statusCode: 200,
      body: null,
      headersSent: false,
      writes: [],
      status(value) {
        this.statusCode = value;
        return this;
      },
      writeHead(value, headers) {
        this.statusCode = value;
        this.headers = headers;
        this.headersSent = true;
        return this;
      },
      write(value) {
        this.writes.push(value);
        return true;
      },
      end() {
        this.ended = true;
      },
      json(value) {
        this.body = value;
        this.headersSent = true;
        return this;
      },
    };
    await routeHandler({
      body: request.body || {},
      headers: request.headers || {},
      params: request.params || {},
      query: request.query || {},
      on: vi.fn(),
    }, res);
    return res;
  };

  return { app, call };
};

const createRuntime = (overrides = {}) => {
  const state = {
    running: false,
    initialized: false,
    ...overrides.state,
  };
  const protocolRuntime = overrides.protocolRuntime || {
    readAccount: vi.fn(async (params) => ({ account: { type: 'apiKey' }, params })),
    loginAccount: vi.fn(async (params) => ({ login: true, params })),
    cancelAccountLogin: vi.fn(async (params) => ({ canceled: true, params })),
    logoutAccount: vi.fn(async () => ({})),
    getAuthStatus: vi.fn(async (params) => ({ authMethod: 'apiKey', authToken: null, requiresOpenaiAuth: false, params })),
    listThreads: vi.fn(async (params) => ({ threads: [], params })),
    startThread: vi.fn(async (params) => ({ thread: { id: 'thread-1' }, params })),
    resumeThread: vi.fn(async (params) => ({ thread: { id: params.threadId }, params })),
    readThread: vi.fn(async (params) => ({ thread: { id: params.threadId }, params })),
    forkThread: vi.fn(async (params) => ({ thread: { id: 'thread-fork' }, params })),
    rollbackThread: vi.fn(async (params) => ({ thread: { id: params.threadId }, params })),
    compactThread: vi.fn(async (params) => ({ compacted: true, params })),
    archiveThread: vi.fn(async (params) => ({ archived: true, params })),
    unarchiveThread: vi.fn(async (params) => ({ archived: false, params })),
    deleteThread: vi.fn(async (params) => ({ deleted: true, params })),
    shellCommand: vi.fn(async (params) => ({ shell: true, params })),
    setThreadName: vi.fn(async (params) => ({ named: true, params })),
    updateThreadSettings: vi.fn(async (params) => ({ settings: true, params })),
    startTurn: vi.fn(async (params) => ({ turn: { id: 'turn-1' }, params })),
    listThreadTurns: vi.fn(async (params) => ({ data: [], nextCursor: null, backwardsCursor: null, params })),
    steerTurn: vi.fn(async (params) => ({ steered: true, params })),
    interruptTurn: vi.fn(async (params) => ({ interrupted: true, params })),
    listModels: vi.fn(async (params) => ({ models: [], params })),
    readConfig: vi.fn(async () => ({ config: { model: 'gpt-5.1-codex', unsupportedBinary: '/old' } })),
    writeConfigBatch: vi.fn(async (params) => ({ written: true, params })),
    listMcpServerStatus: vi.fn(async (params) => ({ servers: [], params })),
    listSkills: vi.fn(async (params) => ({ skills: [], params })),
  };
  const approvalRuntime = overrides.approvalRuntime || {
    listPending: vi.fn(() => []),
    reply: vi.fn(({ requestId, response }) => ({ ok: true, requestId, response })),
  };
  const eventHub = overrides.eventHub || {
    subscribe: vi.fn((handler) => {
      handler({
        sequence: 1,
        receivedAt: '2026-01-01T00:00:00.000Z',
        method: 'thread/started',
        params: { threadId: 'thread-1' },
      });
      return vi.fn();
    }),
  };
  const runtime = {
    getHealthSnapshot: vi.fn(() => ({
      status: state.running ? 'running' : 'stopped',
      running: state.running,
      initialized: state.initialized,
      transport: 'stdio',
      binary: 'codex',
      binarySource: 'PATH',
      pid: state.running ? 123 : null,
      startedAt: state.running ? '2026-01-01T00:00:00.000Z' : null,
      exitedAt: null,
      lastError: null,
      lastExitCode: null,
      lastExitSignal: null,
      lastStderr: null,
    })),
    getProtocolRuntime: vi.fn(() => (state.running && state.initialized ? protocolRuntime : null)),
    getApprovalRuntime: vi.fn(() => approvalRuntime),
    getEventHub: vi.fn(() => eventHub),
    startAndInitialize: vi.fn(async () => {
      state.running = true;
      state.initialized = true;
      return { userAgent: 'codex-cli/0.142.3' };
    }),
    restart: vi.fn(async () => {
      state.running = true;
      state.initialized = true;
      return { userAgent: 'codex-cli/0.142.3' };
    }),
  };
  return { approvalRuntime, eventHub, protocolRuntime, runtime, state };
};

describe('Codex routes', () => {
  it('returns deterministic unavailable health without starting Codex', async () => {
    const { runtime } = createRuntime();
    const { call } = createRouteHarness(runtime);
    const response = await call('GET', '/api/codex/health');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      healthy: false,
      ready: false,
      runtime: runtime.getHealthSnapshot(),
    });
    expect(runtime.startAndInitialize).not.toHaveBeenCalled();
  });

  it('reports ready when the runtime is running and initialized', async () => {
    const { runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);
    const response = await call('GET', '/api/codex/health');

    expect(response.body).toEqual({
      healthy: true,
      ready: true,
      runtime: runtime.getHealthSnapshot(),
    });
  });

  it('reports supported Codex browser API capabilities without starting Codex', async () => {
    const { runtime } = createRuntime();
    const { call } = createRouteHarness(runtime);

    const response = await call('GET', '/api/codex/capabilities');

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      transport: 'stdio',
      experimentalApi: true,
      methods: expect.arrayContaining(['account/login/start', 'thread/start', 'thread/list', 'turn/start']),
      runtime: runtime.getHealthSnapshot(),
    }));
    expect(runtime.startAndInitialize).not.toHaveBeenCalled();
  });

  it('routes account auth calls through Codex-native account methods', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    const readResponse = await call('GET', '/api/codex/account', {
      query: { refreshToken: 'true' },
    });
    const loginResponse = await call('POST', '/api/codex/account/login', {
      body: { type: 'apiKey', apiKey: 'sk-test' },
    });
    const cancelResponse = await call('POST', '/api/codex/account/login/cancel', {
      body: { loginId: 'login-1' },
    });
    const logoutResponse = await call('POST', '/api/codex/account/logout');
    const statusResponse = await call('GET', '/api/codex/auth/status', {
      query: { includeToken: 'false', refreshToken: 'true' },
    });

    expect(readResponse.statusCode).toBe(200);
    expect(loginResponse.statusCode).toBe(200);
    expect(cancelResponse.statusCode).toBe(200);
    expect(logoutResponse.statusCode).toBe(200);
    expect(statusResponse.statusCode).toBe(200);
    expect(protocolRuntime.readAccount).toHaveBeenCalledWith({ refreshToken: true });
    expect(protocolRuntime.loginAccount).toHaveBeenCalledWith({ type: 'apiKey', apiKey: 'sk-test' });
    expect(protocolRuntime.cancelAccountLogin).toHaveBeenCalledWith({ loginId: 'login-1' });
    expect(protocolRuntime.logoutAccount).toHaveBeenCalledWith();
    expect(protocolRuntime.getAuthStatus).toHaveBeenCalledWith({ includeToken: false, refreshToken: true });
  });

  it('initializes Codex before listing threads', async () => {
    const { protocolRuntime, runtime } = createRuntime();
    const { call } = createRouteHarness(runtime);

    const response = await call('GET', '/api/codex/threads', {
      query: { archived: 'false', limit: '20', cwd: '/repo' },
    });

    expect(response.statusCode).toBe(200);
    expect(runtime.startAndInitialize).toHaveBeenCalled();
    expect(protocolRuntime.listThreads).toHaveBeenCalledWith({
      archived: false,
      limit: 20,
      cwd: '/repo',
    });
  });

  it('starts a thread with only supported Codex fields', async () => {
    const { protocolRuntime, runtime } = createRuntime();
    const { call } = createRouteHarness(runtime);

    const response = await call('POST', '/api/codex/threads', {
      body: {
        cwd: '/repo',
        model: 'gpt-5.5-codex',
        approvalPolicy: 'on-request',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(runtime.startAndInitialize).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo' }));
    expect(protocolRuntime.startThread).toHaveBeenCalledWith({
      cwd: '/repo',
      model: 'gpt-5.5-codex',
      approvalPolicy: 'on-request',
    });
  });

  it('rejects unsupported thread fields instead of passing compatibility glue through', async () => {
    const { protocolRuntime, runtime } = createRuntime();
    const { call } = createRouteHarness(runtime);

    const response = await call('POST', '/api/codex/threads', {
      body: { sessionID: 'legacy-session' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: { message: 'Unsupported Codex request field: sessionID' },
    });
    expect(protocolRuntime.startThread).not.toHaveBeenCalled();
  });

  it('reads, archives, unarchives, and deletes threads through the protocol runtime', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    await call('GET', '/api/codex/threads/:threadId', {
      params: { threadId: 'thread-1' },
      query: { includeTurns: 'true' },
    });
    await call('POST', '/api/codex/threads/:threadId/archive', { params: { threadId: 'thread-1' } });
    await call('POST', '/api/codex/threads/:threadId/unarchive', { params: { threadId: 'thread-1' } });
    await call('DELETE', '/api/codex/threads/:threadId', { params: { threadId: 'thread-1' } });

    expect(protocolRuntime.readThread).toHaveBeenCalledWith({ threadId: 'thread-1', includeTurns: true });
    expect(protocolRuntime.archiveThread).toHaveBeenCalledWith({ threadId: 'thread-1' });
    expect(protocolRuntime.unarchiveThread).toHaveBeenCalledWith({ threadId: 'thread-1' });
    expect(protocolRuntime.deleteThread).toHaveBeenCalledWith({ threadId: 'thread-1' });
  });

  it('starts and interrupts turns through the protocol runtime', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    const startResponse = await call('POST', '/api/codex/threads/:threadId/turns', {
      params: { threadId: 'thread-1' },
      body: {
        input: [{ type: 'text', text: 'hello' }],
        cwd: '/repo',
      },
    });
    const interruptResponse = await call('POST', '/api/codex/threads/:threadId/turns/:turnId/interrupt', {
      params: { threadId: 'thread-1', turnId: 'turn-1' },
    });

    expect(startResponse.statusCode).toBe(200);
    expect(interruptResponse.statusCode).toBe(200);
    expect(protocolRuntime.startTurn).toHaveBeenCalledWith({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'hello' }],
      cwd: '/repo',
    });
    expect(protocolRuntime.interruptTurn).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'turn-1' });
  });

  it('resumes existing Codex threads before retrying turn start when app-server has not loaded them', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);
    protocolRuntime.startTurn
      .mockRejectedValueOnce(new Error('turn/start failed: thread not found: thread-1 (-32600)'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1' } });

    const response = await call('POST', '/api/codex/threads/:threadId/turns', {
      params: { threadId: 'thread-1' },
      body: {
        input: [{ type: 'text', text: 'who are you' }],
        cwd: '/repo',
        model: 'gpt-5.5',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(protocolRuntime.resumeThread).toHaveBeenCalledWith({
      threadId: 'thread-1',
      excludeTurns: true,
      cwd: '/repo',
      model: 'gpt-5.5',
    });
    expect(protocolRuntime.startTurn).toHaveBeenCalledTimes(2);
    expect(protocolRuntime.startTurn).toHaveBeenLastCalledWith({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'who are you' }],
      cwd: '/repo',
      model: 'gpt-5.5',
    });
  });

  it('lists turns and treats Codex empty thread history as an empty page', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    const response = await call('GET', '/api/codex/threads/:threadId/turns', {
      params: { threadId: 'thread-1' },
      query: { limit: '20', itemsView: 'full' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      data: [],
      nextCursor: null,
      backwardsCursor: null,
      params: { threadId: 'thread-1', limit: 20, itemsView: 'full' },
    });
    expect(protocolRuntime.listThreadTurns).toHaveBeenCalledWith({
      threadId: 'thread-1',
      limit: 20,
      itemsView: 'full',
    });

    protocolRuntime.listThreadTurns.mockRejectedValueOnce(new Error('thread/turns/list failed: thread thread-2 is not materialized yet; thread/turns/list is unavailable before first user message (-32600)'));
    const emptyResponse = await call('GET', '/api/codex/threads/:threadId/turns', {
      params: { threadId: 'thread-2' },
    });

    expect(emptyResponse.statusCode).toBe(200);
    expect(emptyResponse.body).toEqual({ data: [], nextCursor: null, backwardsCursor: null });
  });

  it('runs shell commands through the Codex thread shell method', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    const response = await call('POST', '/api/codex/threads/:threadId/shell', {
      params: { threadId: 'thread-1' },
      body: { command: 'pwd' },
    });

    expect(response.statusCode).toBe(200);
    expect(protocolRuntime.shellCommand).toHaveBeenCalledWith({
      threadId: 'thread-1',
      command: 'pwd',
    });
  });

  it('forks, rolls back, and compacts threads through Codex-native methods', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    const forkResponse = await call('POST', '/api/codex/threads/:threadId/fork', {
      params: { threadId: 'thread-1' },
      body: { cwd: '/repo', excludeTurns: true },
    });
    const rollbackResponse = await call('POST', '/api/codex/threads/:threadId/rollback', {
      params: { threadId: 'thread-1' },
      body: { numTurns: 2 },
    });
    const compactResponse = await call('POST', '/api/codex/threads/:threadId/compact', {
      params: { threadId: 'thread-1' },
    });

    expect(forkResponse.statusCode).toBe(200);
    expect(rollbackResponse.statusCode).toBe(200);
    expect(compactResponse.statusCode).toBe(200);
    expect(protocolRuntime.forkThread).toHaveBeenCalledWith({
      threadId: 'thread-1',
      cwd: '/repo',
      excludeTurns: true,
    });
    expect(protocolRuntime.rollbackThread).toHaveBeenCalledWith({ threadId: 'thread-1', numTurns: 2 });
    expect(protocolRuntime.compactThread).toHaveBeenCalledWith({ threadId: 'thread-1' });
  });

  it('rejects turn start requests without input', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    const response = await call('POST', '/api/codex/threads/:threadId/turns', {
      params: { threadId: 'thread-1' },
      body: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: { message: 'Codex turn input is required' } });
    expect(protocolRuntime.startTurn).not.toHaveBeenCalled();
  });

  it('restarts and initializes the managed Codex runtime explicitly', async () => {
    const { runtime } = createRuntime();
    const { call } = createRouteHarness(runtime);

    const response = await call('POST', '/api/codex/restart', {
      body: { cwd: '/repo' },
    });

    expect(response.statusCode).toBe(200);
    expect(runtime.restart).toHaveBeenCalledWith({ cwd: '/repo' });
    expect(response.body).toEqual({
      ok: true,
      runtime: runtime.getHealthSnapshot(),
    });
  });

  it('patches thread name and settings through Codex-native methods', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    const response = await call('PATCH', '/api/codex/threads/:threadId', {
      params: { threadId: 'thread-1' },
      body: {
        title: 'New name',
        approvalPolicy: 'on-request',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(protocolRuntime.setThreadName).toHaveBeenCalledWith({
      threadId: 'thread-1',
      threadName: 'New name',
    });
    expect(protocolRuntime.updateThreadSettings).toHaveBeenCalledWith({
      threadId: 'thread-1',
      approvalPolicy: 'on-request',
    });
  });

  it('steers active turns with explicit input', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    await call('POST', '/api/codex/threads/:threadId/turns/:turnId/steer', {
      params: { threadId: 'thread-1', turnId: 'turn-1' },
      body: { input: [{ type: 'text', text: 'continue' }] },
    });

    expect(protocolRuntime.steerTurn).toHaveBeenCalledWith({
      threadId: 'thread-1',
      turnId: 'turn-1',
      input: [{ type: 'text', text: 'continue' }],
    });
  });

  it('streams Codex events as SSE without starting Codex', async () => {
    const { eventHub, runtime } = createRuntime();
    const { call } = createRouteHarness(runtime);

    const response = await call('GET', '/api/codex/events', {
      headers: { accept: 'text/event-stream' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(response.writes.join('')).toContain('event: codex');
    expect(eventHub.subscribe).toHaveBeenCalled();
    expect(runtime.startAndInitialize).not.toHaveBeenCalled();
  });

  it('lists and replies to pending Codex approvals', async () => {
    const { approvalRuntime, runtime } = createRuntime({
      approvalRuntime: {
        listPending: vi.fn(() => [{ requestId: 'request-1' }]),
        reply: vi.fn(({ requestId, response }) => ({ ok: true, requestId, response })),
      },
    });
    const { call } = createRouteHarness(runtime);

    const listResponse = await call('GET', '/api/codex/approvals');
    const replyResponse = await call('POST', '/api/codex/approvals/:requestId/reply', {
      params: { requestId: 'request-1' },
      body: { response: { decision: 'approved' } },
    });

    expect(listResponse.body).toEqual({ approvals: [{ requestId: 'request-1' }] });
    expect(replyResponse.body).toEqual({ ok: true, requestId: 'request-1', response: { decision: 'approved' } });
    expect(approvalRuntime.reply).toHaveBeenCalledWith({
      requestId: 'request-1',
      response: { decision: 'approved' },
    });
  });

  it('reads and updates Codex config without accepting unsupported config fields', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    const readResponse = await call('GET', '/api/codex/config');
    const writeResponse = await call('PUT', '/api/codex/config', {
      body: { model: 'gpt-5.1-codex' },
    });
    const rejectedResponse = await call('PUT', '/api/codex/config', {
      body: { unsupportedBinary: '/old/runtime' },
    });

    expect(readResponse.body.config).toEqual({ model: 'gpt-5.1-codex' });
    expect(writeResponse.body).toEqual({
      written: true,
      params: { edits: [{ key: 'model', value: 'gpt-5.1-codex' }] },
    });
    expect(rejectedResponse.statusCode).toBe(400);
    expect(protocolRuntime.writeConfigBatch).toHaveBeenCalledTimes(1);
  });

  it('exposes Codex model, MCP, and skill routes through protocol calls', async () => {
    const { protocolRuntime, runtime } = createRuntime({ state: { running: true, initialized: true } });
    const { call } = createRouteHarness(runtime);

    await call('GET', '/api/codex/models', { query: { cwd: '/repo' } });
    await call('GET', '/api/codex/mcp');
    await call('GET', '/api/codex/skills');

    expect(protocolRuntime.listModels).toHaveBeenCalledWith({ cwd: '/repo' });
    expect(protocolRuntime.listMcpServerStatus).toHaveBeenCalledWith({});
    expect(protocolRuntime.listSkills).toHaveBeenCalledWith({});
  });
});

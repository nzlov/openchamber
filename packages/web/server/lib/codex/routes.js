import { createCodexSchemaRuntime } from './schema-runtime.js';
import { createCodexSettingsRuntime } from './settings-runtime.js';

const SUPPORTED_CODEX_METHODS = [
  'initialize',
  'account/read',
  'account/login/start',
  'account/login/cancel',
  'account/logout',
  'getAuthStatus',
  'thread/start',
  'thread/resume',
  'thread/fork',
  'thread/rollback',
  'thread/compact/start',
  'thread/list',
  'thread/read',
  'thread/archive',
  'thread/unarchive',
  'thread/delete',
  'thread/shellCommand',
  'thread/turns/list',
  'thread/turns/items/list',
  'thread/name/set',
  'thread/settings/update',
  'turn/start',
  'turn/steer',
  'turn/interrupt',
  'model/list',
  'config/read',
  'config/value/write',
  'config/batchWrite',
  'mcpServerStatus/list',
  'skills/list',
];

const THREAD_START_FIELDS = new Set([
  'model',
  'modelProvider',
  'serviceTier',
  'cwd',
  'runtimeWorkspaceRoots',
  'approvalPolicy',
  'approvalsReviewer',
  'sandbox',
  'permissions',
  'config',
  'serviceName',
  'baseInstructions',
  'developerInstructions',
  'personality',
  'ephemeral',
  'sessionStartSource',
  'threadSource',
  'environments',
  'dynamicTools',
  'selectedCapabilityRoots',
  'experimentalRawEvents',
]);

const TURN_START_FIELDS = new Set([
  'clientUserMessageId',
  'input',
  'responsesapiClientMetadata',
  'additionalContext',
  'environments',
  'cwd',
  'runtimeWorkspaceRoots',
  'approvalPolicy',
  'approvalsReviewer',
  'sandboxPolicy',
  'permissions',
  'model',
  'serviceTier',
  'effort',
  'summary',
  'personality',
  'outputSchema',
  'collaborationMode',
]);

const THREAD_PATCH_FIELDS = new Set([
  'title',
  'approvalPolicy',
  'approvalsReviewer',
  'sandboxPolicy',
  'model',
  'modelProvider',
  'serviceTier',
  'effort',
  'summary',
  'collaborationMode',
]);

const THREAD_FORK_FIELDS = new Set([
  ...THREAD_START_FIELDS,
  'path',
  'excludeTurns',
]);

const THREAD_ROLLBACK_FIELDS = new Set([
  'numTurns',
]);

const ACCOUNT_LOGIN_FIELDS = new Set([
  'type',
  'apiKey',
  'codexStreamlinedLogin',
  'accessToken',
  'chatgptAccountId',
  'chatgptPlanType',
]);

const ACCOUNT_LOGIN_CANCEL_FIELDS = new Set([
  'loginId',
]);

const TURN_STEER_FIELDS = new Set([
  'input',
]);

const THREAD_SHELL_FIELDS = new Set([
  'command',
]);

const parseBooleanQuery = (value) => {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
};

const parsePositiveInteger = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getErrorMessage = (error) => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
  return '';
};

const isEmptyCodexThreadHistoryError = (error) => {
  const message = getErrorMessage(error);
  return message.includes('is not materialized yet')
    || message.includes('includeTurns is unavailable before first user message')
    || message.includes('thread/turns/list is unavailable before first user message')
    || (message.includes('rollout at ') && message.includes(' is empty'))
    || (message.includes('thread-store internal error') && message.includes('failed to read thread') && message.includes(' is empty'));
};

const isCodexThreadNotFoundError = (error) => {
  const message = getErrorMessage(error);
  return message.includes('thread not found');
};

const pickTurnResumeFields = (body) => {
  const resume = { threadId: body.threadId, excludeTurns: true };
  for (const field of [
    'cwd',
    'runtimeWorkspaceRoots',
    'approvalPolicy',
    'approvalsReviewer',
    'permissions',
    'model',
    'serviceTier',
    'personality',
  ]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      resume[field] = body[field];
    }
  }
  return resume;
};

const sendError = (res, error) => {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
  return res.status(statusCode).json({
    error: {
      message: getErrorMessage(error) || String(error || 'Codex request failed'),
    },
  });
};

export const registerCodexRoutes = (app, dependencies = {}) => {
  const {
    codexProcessRuntime,
    express = null,
    schemaRuntime = createCodexSchemaRuntime(),
    settingsRuntime = createCodexSettingsRuntime(),
  } = dependencies;

  if (!codexProcessRuntime || typeof codexProcessRuntime.getHealthSnapshot !== 'function') {
    throw new Error('registerCodexRoutes requires codexProcessRuntime.getHealthSnapshot');
  }
  if (typeof codexProcessRuntime.getProtocolRuntime !== 'function') {
    throw new Error('registerCodexRoutes requires codexProcessRuntime.getProtocolRuntime');
  }
  if (typeof codexProcessRuntime.startAndInitialize !== 'function') {
    throw new Error('registerCodexRoutes requires codexProcessRuntime.startAndInitialize');
  }

  if (express && typeof express.json === 'function') {
    app.use('/api/codex', express.json({ limit: '50mb' }));
  }

  const getInitializedProtocolRuntime = async (options = {}) => {
    const health = codexProcessRuntime.getHealthSnapshot();
    let protocolRuntime = codexProcessRuntime.getProtocolRuntime();
    if (!health.running || !health.initialized || !protocolRuntime) {
      await codexProcessRuntime.startAndInitialize({
        cwd: options.cwd,
        clientInfo: {
          name: 'openchamber',
          title: 'OpenChamber',
          version: typeof options.openchamberVersion === 'string' ? options.openchamberVersion : '0.0.0',
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          mcpServerOpenaiFormElicitation: false,
        },
      });
      protocolRuntime = codexProcessRuntime.getProtocolRuntime();
    }
    if (!protocolRuntime) {
      throw new Error('Codex protocol runtime is unavailable');
    }
    return protocolRuntime;
  };

  const getApprovalRuntime = () => {
    const approvalRuntime = codexProcessRuntime.getApprovalRuntime?.();
    if (!approvalRuntime) {
      throw createHttpError(501, 'Codex approval runtime is unavailable');
    }
    return approvalRuntime;
  };

  const handleJson = (handler) => async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent) {
        res.json(result);
      }
    } catch (error) {
      sendError(res, error);
    }
  };

  app.get('/api/codex/health', (_req, res) => {
    const runtime = codexProcessRuntime.getHealthSnapshot();
    res.json({
      healthy: runtime.running === true && runtime.initialized === true,
      ready: runtime.running === true && runtime.initialized === true,
      runtime,
    });
  });

  app.get('/api/codex/capabilities', (_req, res) => {
    const runtime = codexProcessRuntime.getHealthSnapshot();
    res.json({
      transport: 'stdio',
      experimentalApi: true,
      methods: SUPPORTED_CODEX_METHODS,
      unsupported: {
        browserDirectAppServer: true,
        legacyRuntimeCompatibility: false,
      },
      configFields: settingsRuntime.getSupportedFields(),
      runtime,
    });
  });

  app.get('/api/codex/events', (req, res) => {
    const eventHub = codexProcessRuntime.getEventHub?.();
    if (!eventHub) {
      res.status(501).json({ error: { message: 'Codex event stream is unavailable' } });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': codex events connected\n\n');
    const heartbeat = setInterval(() => {
      res.write(': codex heartbeat\n\n');
    }, 15_000);
    heartbeat.unref?.();

    const lastEventId = parsePositiveInteger(req.headers?.['last-event-id']);
    const unsubscribe = eventHub.subscribe((event) => {
      res.write(`id: ${event.sequence}\n`);
      res.write('event: codex\n');
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }, {
      afterSequence: lastEventId,
    });

    req.on?.('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end?.();
    });
  });

  app.get('/api/codex/account', handleJson(async (req) => {
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.readAccount({
      ...(parseBooleanQuery(req.query?.refreshToken) === true ? { refreshToken: true } : {}),
    });
  }));

  app.post('/api/codex/account/login', handleJson(async (req) => {
    const body = schemaRuntime.pickKnownFields(req.body, ACCOUNT_LOGIN_FIELDS);
    if (typeof body.type !== 'string' || !body.type) {
      throw createHttpError(400, 'Codex account login type is required');
    }
    if (body.type === 'apiKey' && (typeof body.apiKey !== 'string' || !body.apiKey.trim())) {
      throw createHttpError(400, 'Codex API key is required');
    }
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.loginAccount(body);
  }));

  app.post('/api/codex/account/login/cancel', handleJson(async (req) => {
    const body = schemaRuntime.pickKnownFields(req.body, ACCOUNT_LOGIN_CANCEL_FIELDS);
    if (typeof body.loginId !== 'string' || !body.loginId.trim()) {
      throw createHttpError(400, 'Codex account login id is required');
    }
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.cancelAccountLogin({ loginId: body.loginId });
  }));

  app.post('/api/codex/account/logout', handleJson(async () => {
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.logoutAccount();
  }));

  app.get('/api/codex/auth/status', handleJson(async (req) => {
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.getAuthStatus({
      includeToken: parseBooleanQuery(req.query?.includeToken) === true,
      refreshToken: parseBooleanQuery(req.query?.refreshToken) === true,
    });
  }));

  app.post('/api/codex/restart', handleJson(async (req) => {
    if (typeof codexProcessRuntime.restart !== 'function') {
      throw createHttpError(501, 'Codex restart is unsupported by this runtime');
    }
    await codexProcessRuntime.restart({ cwd: req.body?.cwd });
    return {
      ok: true,
      runtime: codexProcessRuntime.getHealthSnapshot(),
    };
  }));

  app.get('/api/codex/threads', handleJson(async (req) => {
    const protocolRuntime = await getInitializedProtocolRuntime();
    const limit = parsePositiveInteger(req.query?.limit);
    const archived = parseBooleanQuery(req.query?.archived);
    return protocolRuntime.listThreads({
      ...(typeof req.query?.cursor === 'string' && req.query.cursor ? { cursor: req.query.cursor } : {}),
      ...(limit ? { limit } : {}),
      ...(archived === null ? {} : { archived }),
      ...(typeof req.query?.cwd === 'string' && req.query.cwd ? { cwd: req.query.cwd } : {}),
      ...(typeof req.query?.searchTerm === 'string' && req.query.searchTerm ? { searchTerm: req.query.searchTerm } : {}),
      ...(parseBooleanQuery(req.query?.useStateDbOnly) === true ? { useStateDbOnly: true } : {}),
    });
  }));

  app.post('/api/codex/threads', handleJson(async (req) => {
    const body = schemaRuntime.pickKnownFields(req.body, THREAD_START_FIELDS);
    const protocolRuntime = await getInitializedProtocolRuntime({ cwd: body.cwd });
    return protocolRuntime.startThread(body);
  }));

  app.get('/api/codex/threads/:threadId', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.readThread({
      threadId,
      includeTurns: parseBooleanQuery(req.query?.includeTurns) !== false,
    });
  }));

  app.patch('/api/codex/threads/:threadId', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const body = schemaRuntime.pickKnownFields(req.body, THREAD_PATCH_FIELDS);
    const protocolRuntime = await getInitializedProtocolRuntime();
    const responses = {};

    if (Object.prototype.hasOwnProperty.call(body, 'title')) {
      responses.name = await protocolRuntime.setThreadName({
        threadId,
        threadName: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined,
      });
    }

    const settingsPatch = {};
    for (const field of THREAD_PATCH_FIELDS) {
      if (field === 'title') continue;
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        settingsPatch[field] = body[field];
      }
    }
    if (Object.keys(settingsPatch).length > 0) {
      responses.settings = await protocolRuntime.updateThreadSettings({ threadId, ...settingsPatch });
    }

    return { ok: true, threadId, ...responses };
  }));

  app.post('/api/codex/threads/:threadId/fork', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const body = schemaRuntime.pickKnownFields(req.body, THREAD_FORK_FIELDS);
    const protocolRuntime = await getInitializedProtocolRuntime({ cwd: body.cwd });
    return protocolRuntime.forkThread({ threadId, ...body });
  }));

  app.post('/api/codex/threads/:threadId/rollback', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const body = schemaRuntime.pickKnownFields(req.body, THREAD_ROLLBACK_FIELDS);
    const numTurns = parsePositiveInteger(body.numTurns);
    if (!numTurns) {
      throw createHttpError(400, 'Codex rollback turn count is required');
    }
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.rollbackThread({ threadId, numTurns });
  }));

  app.post('/api/codex/threads/:threadId/compact', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.compactThread({ threadId });
  }));

  app.post('/api/codex/threads/:threadId/archive', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.archiveThread({ threadId });
  }));

  app.post('/api/codex/threads/:threadId/unarchive', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.unarchiveThread({ threadId });
  }));

  app.delete('/api/codex/threads/:threadId', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.deleteThread({ threadId });
  }));

  app.post('/api/codex/threads/:threadId/shell', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const body = schemaRuntime.pickKnownFields(req.body, THREAD_SHELL_FIELDS);
    if (typeof body.command !== 'string' || body.command.trim().length === 0) {
      throw createHttpError(400, 'Codex shell command is required');
    }
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.shellCommand({ threadId, command: body.command });
  }));

  app.post('/api/codex/threads/:threadId/turns', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const body = schemaRuntime.pickKnownFields(req.body, TURN_START_FIELDS);
    schemaRuntime.requireNonEmptyArray(body.input, 'turn input');
    const protocolRuntime = await getInitializedProtocolRuntime({ cwd: body.cwd });
    const startParams = { threadId, ...body };
    try {
      return await protocolRuntime.startTurn(startParams);
    } catch (error) {
      if (!isCodexThreadNotFoundError(error)) {
        throw error;
      }
      await protocolRuntime.resumeThread(pickTurnResumeFields(startParams));
      return protocolRuntime.startTurn(startParams);
    }
  }));

  app.get('/api/codex/threads/:threadId/turns', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const limit = parsePositiveInteger(req.query?.limit);
    const protocolRuntime = await getInitializedProtocolRuntime();
    try {
      return await protocolRuntime.listThreadTurns({
        threadId,
        ...(typeof req.query?.cursor === 'string' && req.query.cursor ? { cursor: req.query.cursor } : {}),
        ...(limit ? { limit } : {}),
        ...(typeof req.query?.sortDirection === 'string' && req.query.sortDirection ? { sortDirection: req.query.sortDirection } : {}),
        ...(typeof req.query?.itemsView === 'string' && req.query.itemsView ? { itemsView: req.query.itemsView } : {}),
      });
    } catch (error) {
      if (isEmptyCodexThreadHistoryError(error)) {
        return { data: [], nextCursor: null, backwardsCursor: null };
      }
      throw error;
    }
  }));

  app.get('/api/codex/threads/:threadId/turns/:turnId/items', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const turnId = schemaRuntime.requireId(req.params?.turnId, 'turn id');
    const limit = parsePositiveInteger(req.query?.limit);
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.listThreadTurnItems({
      threadId,
      turnId,
      ...(typeof req.query?.cursor === 'string' && req.query.cursor ? { cursor: req.query.cursor } : {}),
      ...(limit ? { limit } : {}),
      ...(typeof req.query?.sortDirection === 'string' && req.query.sortDirection ? { sortDirection: req.query.sortDirection } : {}),
    });
  }));

  app.post('/api/codex/threads/:threadId/turns/:turnId/steer', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const turnId = schemaRuntime.requireId(req.params?.turnId, 'turn id');
    const body = schemaRuntime.pickKnownFields(req.body, TURN_STEER_FIELDS);
    schemaRuntime.requireNonEmptyArray(body.input, 'steer input');
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.steerTurn({ threadId, turnId, ...body });
  }));

  app.post('/api/codex/threads/:threadId/turns/:turnId/interrupt', handleJson(async (req) => {
    const threadId = schemaRuntime.requireId(req.params?.threadId, 'thread id');
    const turnId = schemaRuntime.requireId(req.params?.turnId, 'turn id');
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.interruptTurn({ threadId, turnId });
  }));

  app.get('/api/codex/approvals', handleJson(async () => {
    return { approvals: getApprovalRuntime().listPending() };
  }));

  app.post('/api/codex/approvals/:requestId/reply', handleJson(async (req) => {
    const requestId = schemaRuntime.requireId(req.params?.requestId, 'approval request id');
    return getApprovalRuntime().reply({ requestId, response: req.body?.response });
  }));

  app.get('/api/codex/config', handleJson(async () => {
    const protocolRuntime = await getInitializedProtocolRuntime();
    const raw = await protocolRuntime.readConfig({});
    return {
      config: settingsRuntime.normalizeConfig(raw),
      supportedFields: settingsRuntime.getSupportedFields(),
      raw,
    };
  }));

  app.put('/api/codex/config', handleJson(async (req) => {
    const protocolRuntime = await getInitializedProtocolRuntime();
    const update = settingsRuntime.normalizeConfigUpdate(req.body);
    return protocolRuntime.writeConfigBatch(update);
  }));

  app.get('/api/codex/models', handleJson(async (req) => {
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.listModels({
      ...(typeof req.query?.cwd === 'string' && req.query.cwd ? { cwd: req.query.cwd } : {}),
    });
  }));

  app.get('/api/codex/mcp', handleJson(async () => {
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.listMcpServerStatus({});
  }));

  app.get('/api/codex/skills', handleJson(async () => {
    const protocolRuntime = await getInitializedProtocolRuntime();
    return protocolRuntime.listSkills({});
  }));
};

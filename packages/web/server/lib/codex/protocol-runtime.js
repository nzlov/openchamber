const DEFAULT_CLIENT_INFO = {
  name: 'openchamber',
  title: 'OpenChamber',
  version: '0.0.0',
};

const DEFAULT_INITIALIZE_CAPABILITIES = {
  experimentalApi: true,
  requestAttestation: false,
  mcpServerOpenaiFormElicitation: false,
};

const ensureObject = (value, fallback = {}) => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : fallback
);

const normalizeClientInfo = (clientInfo = DEFAULT_CLIENT_INFO) => {
  const normalized = ensureObject(clientInfo, DEFAULT_CLIENT_INFO);
  return {
    name: typeof normalized.name === 'string' && normalized.name.trim() ? normalized.name.trim() : DEFAULT_CLIENT_INFO.name,
    title: typeof normalized.title === 'string' ? normalized.title : DEFAULT_CLIENT_INFO.title,
    version: typeof normalized.version === 'string' && normalized.version.trim() ? normalized.version.trim() : DEFAULT_CLIENT_INFO.version,
  };
};

const normalizeInitializeCapabilities = (capabilities = DEFAULT_INITIALIZE_CAPABILITIES) => ({
  ...DEFAULT_INITIALIZE_CAPABILITIES,
  ...ensureObject(capabilities, {}),
});

export const createCodexProtocolRuntime = (dependencies = {}) => {
  const { rpcClient } = dependencies;

  if (!rpcClient || typeof rpcClient.request !== 'function') {
    throw new Error('createCodexProtocolRuntime requires rpcClient.request');
  }

  const request = (method, params, options) => rpcClient.request(method, params, options);

  const initialize = (options = {}) => request('initialize', {
    clientInfo: normalizeClientInfo(options.clientInfo),
    capabilities: normalizeInitializeCapabilities(options.capabilities),
  }, options.requestOptions);

  return {
    initialize,
    readAccount: (params = {}, options) => request('account/read', params, options),
    loginAccount: (params, options) => request('account/login/start', params, options),
    cancelAccountLogin: (params, options) => request('account/login/cancel', params, options),
    logoutAccount: (_params, options) => request('account/logout', undefined, options),
    getAuthStatus: (params = {}, options) => request('getAuthStatus', params, options),
    startThread: (params = {}, options) => request('thread/start', params, options),
    resumeThread: (params, options) => request('thread/resume', params, options),
    forkThread: (params, options) => request('thread/fork', params, options),
    rollbackThread: (params, options) => request('thread/rollback', params, options),
    compactThread: (params, options) => request('thread/compact/start', params, options),
    archiveThread: (params, options) => request('thread/archive', params, options),
    unarchiveThread: (params, options) => request('thread/unarchive', params, options),
    deleteThread: (params, options) => request('thread/delete', params, options),
    listThreads: (params = {}, options) => request('thread/list', params, options),
    readThread: (params, options) => request('thread/read', params, options),
    listThreadTurns: (params, options) => request('thread/turns/list', params, options),
    listThreadTurnItems: (params, options) => request('thread/turns/items/list', params, options),
    shellCommand: (params, options) => request('thread/shellCommand', params, options),
    setThreadName: (params, options) => request('thread/name/set', params, options),
    updateThreadSettings: (params, options) => request('thread/settings/update', params, options),
    startTurn: (params, options) => request('turn/start', params, options),
    steerTurn: (params, options) => request('turn/steer', params, options),
    interruptTurn: (params, options) => request('turn/interrupt', params, options),
    listModels: (params = {}, options) => request('model/list', params, options),
    readConfig: (params = {}, options) => request('config/read', params, options),
    writeConfigValue: (params, options) => request('config/value/write', params, options),
    writeConfigBatch: (params, options) => request('config/batchWrite', params, options),
    listMcpServerStatus: (params = {}, options) => request('mcpServerStatus/list', params, options),
    listSkills: (params = {}, options) => request('skills/list', params, options),
  };
};

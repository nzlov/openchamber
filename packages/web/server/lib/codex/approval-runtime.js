const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'mcpServer/elicitation/request',
  'item/tool/requestUserInput',
  'applyPatchApproval',
  'execCommandApproval',
]);

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const createCodexApprovalRuntime = (dependencies = {}) => {
  const {
    now = () => Date.now(),
    logger = console,
  } = dependencies;

  const pending = new Map();

  const listPending = () => Array.from(pending.values()).map((entry) => ({
    requestId: entry.requestId,
    method: entry.method,
    params: entry.params,
    receivedAt: entry.receivedAt,
  }));

  const handleServerRequest = (message) => {
    if (!APPROVAL_METHODS.has(message?.method)) {
      return undefined;
    }

    const requestId = String(message.id || message.params?.requestId || '').trim();
    if (!requestId) {
      throw new Error('Codex approval request is missing an id');
    }

    if (pending.has(requestId)) {
      throw new Error(`Duplicate Codex approval request: ${requestId}`);
    }

    return new Promise((resolve, reject) => {
      pending.set(requestId, {
        requestId,
        method: message.method,
        params: message.params ?? null,
        receivedAt: new Date(now()).toISOString(),
        resolve,
        reject,
      });
    });
  };

  const reply = ({ requestId, response }) => {
    const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
    if (!normalizedRequestId) {
      throw createHttpError(400, 'Missing Codex approval request id');
    }

    const entry = pending.get(normalizedRequestId);
    if (!entry) {
      throw createHttpError(404, 'Codex approval request is not pending');
    }

    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw createHttpError(400, 'Codex approval response object is required');
    }

    pending.delete(normalizedRequestId);
    entry.resolve(response);
    return {
      ok: true,
      requestId: normalizedRequestId,
      method: entry.method,
    };
  };

  const clearPending = (error = new Error('Codex approval runtime cleared')) => {
    for (const entry of pending.values()) {
      try {
        entry.reject(error);
      } catch (rejectError) {
        logger.warn?.('[Codex] approval rejection failed:', rejectError);
      }
    }
    pending.clear();
  };

  return {
    handleServerRequest,
    listPending,
    reply,
    clearPending,
  };
};

const CONFIG_FIELDS = new Set([
  'model',
  'approval_policy',
  'approvals_reviewer',
  'sandbox_mode',
  'model_reasoning_effort',
  'model_reasoning_summary',
  'model_verbosity',
  'service_tier',
]);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const createCodexSettingsRuntime = () => {
  const normalizeConfig = (config) => {
    const source = isPlainObject(config?.config) ? config.config : (isPlainObject(config) ? config : {});
    const normalized = {};
    for (const field of CONFIG_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(source, field)) {
        normalized[field] = source[field] ?? null;
      }
    }
    return normalized;
  };

  const normalizeConfigUpdate = (body) => {
    if (!isPlainObject(body)) {
      throw createHttpError(400, 'Codex config update object is required');
    }

    const unknown = Object.keys(body).filter((field) => !CONFIG_FIELDS.has(field));
    if (unknown.length > 0) {
      throw createHttpError(400, `Unsupported Codex config field: ${unknown[0]}`);
    }

    const edits = [];
    for (const [key, value] of Object.entries(body)) {
      edits.push({ key, value });
    }
    return { edits };
  };

  const getSupportedFields = () => Array.from(CONFIG_FIELDS);

  return {
    normalizeConfig,
    normalizeConfigUpdate,
    getSupportedFields,
  };
};

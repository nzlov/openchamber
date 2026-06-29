const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const createCodexSchemaRuntime = () => {
  const pickKnownFields = (body, fields, options = {}) => {
    const source = isPlainObject(body) ? body : {};
    const unknown = Object.keys(source).filter((key) => !fields.has(key));
    if (unknown.length > 0) {
      throw createHttpError(400, `Unsupported Codex request field: ${unknown[0]}`);
    }

    const picked = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(source, field)) {
        picked[field] = source[field];
      }
    }

    for (const requiredField of options.required || []) {
      if (!Object.prototype.hasOwnProperty.call(picked, requiredField)) {
        throw createHttpError(400, `Missing Codex request field: ${requiredField}`);
      }
    }

    return picked;
  };

  const requireId = (value, label) => {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id) {
      throw createHttpError(400, `Missing Codex ${label}`);
    }
    return id;
  };

  const requireNonEmptyArray = (value, label) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw createHttpError(400, `Codex ${label} is required`);
    }
    return value;
  };

  return {
    pickKnownFields,
    requireId,
    requireNonEmptyArray,
  };
};

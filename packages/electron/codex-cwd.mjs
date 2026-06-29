export const resolveManagedCodexCwd = ({ env, homedir }) => {
  const configured = typeof env?.OPENCHAMBER_CODEX_CWD === 'string'
    ? env.OPENCHAMBER_CODEX_CWD.trim()
    : '';
  if (configured) {
    return configured;
  }

  const home = typeof homedir === 'function' ? homedir() : '';
  return typeof home === 'string' && home.trim() ? home : process.cwd();
};

import fs from 'fs';
import path from 'path';
import os from 'os';

const CODEX_HOME = process.env.CODEX_HOME
  ? path.resolve(process.env.CODEX_HOME)
  : path.join(os.homedir(), '.codex');
const OPENCHAMBER_DATA_DIR = process.env.OPENCHAMBER_DATA_DIR
  ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
  : path.join(os.homedir(), '.config', 'openchamber');

export const ANTIGRAVITY_ACCOUNTS_PATHS = [
  path.join(CODEX_HOME, 'antigravity-accounts.json'),
  path.join(OPENCHAMBER_DATA_DIR, 'antigravity-accounts.json')
];

export const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  } catch (error) {
    console.warn(`Failed to read JSON file: ${filePath}`, error);
    return null;
  }
};

export const getAuthEntry = (auth, aliases) => {
  for (const alias of aliases) {
    if (auth[alias]) {
      return auth[alias];
    }
  }
  return null;
};

export const normalizeAuthEntry = (entry) => {
  if (!entry) return null;
  if (typeof entry === 'string') {
    return { token: entry };
  }
  if (typeof entry === 'object') {
    return entry;
  }
  return null;
};

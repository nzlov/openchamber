import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CODEX_DATA_DIR = path.join(os.homedir(), '.codex');
const AUTH_FILE = path.join(CODEX_DATA_DIR, 'auth.json');

type AuthEntry = Record<string, unknown>;
type AuthFile = Record<string, AuthEntry>;

const readAuthFile = (): AuthFile => {
  if (!fs.existsSync(AUTH_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(AUTH_FILE, 'utf8');
    const trimmed = content.trim();
    if (!trimmed) {
      return {};
    }
    return JSON.parse(trimmed) as AuthFile;
  } catch (error) {
    console.error('Failed to read auth file:', error);
    throw new Error('Failed to read Codex auth configuration');
  }
};

const writeAuthFile = (auth: AuthFile): void => {
  try {
    if (!fs.existsSync(CODEX_DATA_DIR)) {
      fs.mkdirSync(CODEX_DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(AUTH_FILE)) {
      const backupFile = `${AUTH_FILE}.openchamber.backup`;
      fs.copyFileSync(AUTH_FILE, backupFile);
    }

    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to write auth file:', error);
    throw new Error('Failed to write Codex auth configuration');
  }
};

export const removeProviderAuth = (providerId: string): boolean => {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID is required');
  }

  const auth = readAuthFile();

  if (!auth[providerId]) {
    return false;
  }

  delete auth[providerId];
  writeAuthFile(auth);
  return true;
};

export const getProviderAuth = (providerId: string): AuthEntry | null => {
  const auth = readAuthFile();
  return auth[providerId] || null;
};

import fs from 'fs';
import path from 'path';
import os from 'os';

const CODEX_HOME = process.env.CODEX_HOME
  ? path.resolve(process.env.CODEX_HOME)
  : path.join(os.homedir(), '.codex');
const CODEX_AUTH_FILE = path.join(CODEX_HOME, 'auth.json');
const PROVIDER_AUTH_KEYS = {
  codex: ['OPENAI_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  chatgpt: ['OPENAI_API_KEY'],
};

function getProviderAuthKeys(providerId) {
  return PROVIDER_AUTH_KEYS[providerId] || [providerId];
}

function readAuthFile() {
  if (!fs.existsSync(CODEX_AUTH_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(CODEX_AUTH_FILE, 'utf8');
    const trimmed = content.trim();
    if (!trimmed) {
      return {};
    }
    return JSON.parse(trimmed);
  } catch (error) {
    console.error('Failed to read auth file:', error);
    throw new Error('Failed to read Codex auth configuration');
  }
}

function writeAuthFile(auth) {
  try {
    if (!fs.existsSync(CODEX_HOME)) {
      fs.mkdirSync(CODEX_HOME, { recursive: true });
    }

    if (fs.existsSync(CODEX_AUTH_FILE)) {
      const backupFile = `${CODEX_AUTH_FILE}.openchamber.backup`;
      fs.copyFileSync(CODEX_AUTH_FILE, backupFile);
      console.log(`Created auth backup: ${backupFile}`);
    }

    fs.writeFileSync(CODEX_AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
    console.log('Successfully wrote auth file');
  } catch (error) {
    console.error('Failed to write auth file:', error);
    throw new Error('Failed to write Codex auth configuration');
  }
}

function removeProviderAuth(providerId) {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID is required');
  }

  const auth = readAuthFile();

  const keys = getProviderAuthKeys(providerId);
  const existingKeys = keys.filter((key) => Object.prototype.hasOwnProperty.call(auth, key));
  if (existingKeys.length === 0) {
    console.log(`Provider ${providerId} not found in auth file, nothing to remove`);
    return false;
  }

  for (const key of existingKeys) {
    delete auth[key];
  }
  writeAuthFile(auth);
  console.log(`Removed provider auth: ${providerId}`);
  return true;
}

function getProviderAuth(providerId) {
  const auth = readAuthFile();
  for (const key of getProviderAuthKeys(providerId)) {
    if (Object.prototype.hasOwnProperty.call(auth, key)) {
      return auth[key];
    }
  }
  return null;
}

function listProviderAuths() {
  const auth = readAuthFile();
  return Object.keys(auth);
}

export {
  readAuthFile,
  writeAuthFile,
  removeProviderAuth,
  getProviderAuth,
  listProviderAuths,
  CODEX_AUTH_FILE,
  CODEX_HOME
};

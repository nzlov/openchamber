import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createServerUtilsRuntime } from './server-utils-runtime.js';

const originalPath = process.env.PATH;
const tempDirs = [];

const createTempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (originalPath === undefined) {
    delete process.env.PATH;
    return;
  }

  process.env.PATH = originalPath;
});

const createRuntime = (loginShellPath, processLike = { platform: 'linux', env: process.env }) => createServerUtilsRuntime({
  fs,
  os,
  path,
  process: processLike,
  codexReadyGraceMs: 0,
  longRequestTimeoutMs: 0,
  getRuntime: () => ({}),
  getRuntimeAuthHeaders: () => ({}),
  buildRuntimeUrl: (route) => route,
  ensureRuntimeApiPrefix: () => {},
  getUiNotificationClients: () => new Set(),
  getRuntimePort: () => null,
  setRuntimePortState: () => {},
  syncToHmrState: () => {},
  markRuntimeNotReady: () => {},
  setRuntimeNotReadySince: () => {},
  clearLastRuntimeError: () => {},
  getLoginShellPath: () => loginShellPath,
});

describe('server utils runtime', () => {
  it('prefers shell PATH for managed toolchain before appending process-only entries', () => {
    const home = os.homedir();
    const currentPath = [
      path.join(home, '.codex', 'bin'),
      path.join(home, '.bun', 'bin'),
      path.join(home, 'Library', 'pnpm'),
      '/opt/homebrew/bin',
      '/usr/bin',
    ].join(path.delimiter);
    process.env.PATH = currentPath;

    const runtime = createRuntime([
      path.join(home, '.codex', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
      path.join(home, '.cargo', 'bin'),
    ].join(path.delimiter));

    expect(runtime.buildManagedToolchainPath()).toBe([
      path.join(home, '.codex', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
      path.join(home, '.cargo', 'bin'),
      path.join(home, 'Library', 'pnpm'),
    ].join(path.delimiter));
  });

  it('uses login shell PATH for managed toolchain when process PATH is minimal', () => {
    const home = os.homedir();
    const loginShellPath = [
      path.join(home, '.codex', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
    ].join(path.delimiter);
    process.env.PATH = ['/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter);

    const runtime = createRuntime(loginShellPath);

    // Should prefer login shell PATH but merge in any process entries not already present.
    expect(runtime.buildManagedToolchainPath()).toBe([
      path.join(home, '.codex', 'bin'),
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
      '/usr/local/bin',
      '/bin',
    ].join(path.delimiter));
  });

  it('adds existing Windows package-manager directories to managed toolchain PATH', () => {
    const root = createTempDir('openchamber-win-path-');
    const systemDir = path.join(root, 'System32');
    const appData = path.join(root, 'Roaming');
    const programFiles = path.join(root, 'Program Files');
    const localAppData = path.join(root, 'Local');
    const programData = path.join(root, 'ProgramData');
    const userProfile = path.join(root, 'User');

    const npmBin = path.join(appData, 'npm');
    const nodeBin = path.join(programFiles, 'nodejs');
    const pnpmHome = path.join(localAppData, 'pnpm');
    const yarnBin = path.join(localAppData, 'Yarn', 'bin');
    const chocoBin = path.join(programData, 'chocolatey', 'bin');

    for (const dir of [systemDir, npmBin, nodeBin, pnpmHome, yarnBin, chocoBin]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntime(null, {
      platform: 'win32',
      env: {
        PATH: systemDir,
        APPDATA: appData,
        ProgramFiles: programFiles,
        LOCALAPPDATA: localAppData,
        ProgramData: programData,
        USERPROFILE: userProfile,
      },
    });

    expect(runtime.buildManagedToolchainPath()).toBe([
      systemDir,
      npmBin,
      nodeBin,
      pnpmHome,
      yarnBin,
      chocoBin,
    ].join(path.delimiter));
  });

  it('preserves user-configured process PATH order before appending shell-only entries', () => {
    const home = os.homedir();
    process.env.PATH = [
      path.join(home, '.bun', 'bin'),
      path.join(home, 'Library', 'pnpm'),
      '/opt/homebrew/bin',
      '/usr/bin',
    ].join(path.delimiter);

    const runtime = createRuntime([
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      path.join(home, '.cargo', 'bin'),
      '/usr/bin',
    ].join(path.delimiter));

    expect(runtime.buildAugmentedPath()).toBe([
      path.join(home, '.bun', 'bin'),
      path.join(home, 'Library', 'pnpm'),
      '/opt/homebrew/bin',
      '/usr/bin',
      path.join(home, '.cargo', 'bin'),
    ].join(path.delimiter));
  });

  it('prefers login shell PATH when current process PATH is minimal', () => {
    const home = os.homedir();
    process.env.PATH = ['/usr/local/bin', '/usr/bin', '/bin'].join(path.delimiter);

    const runtime = createRuntime([
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
    ].join(path.delimiter));

    expect(runtime.buildAugmentedPath()).toBe([
      path.join(home, '.bun', 'bin'),
      '/opt/homebrew/bin',
      '/usr/bin',
      '/usr/local/bin',
      '/bin',
    ].join(path.delimiter));
  });
});

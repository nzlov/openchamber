import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mergePathValues } from './path-utils.js';

export const createToolchainEnvRuntime = (deps) => {
  const { state } = deps;
  const runSpawnSync = typeof deps.spawnSync === 'function' ? deps.spawnSync : spawnSync;

  const parseNullSeparatedEnvSnapshot = (raw) => {
    if (typeof raw !== 'string' || raw.length === 0) return null;

    const result = {};
    for (const entry of raw.split('\0')) {
      if (!entry) continue;
      const idx = entry.indexOf('=');
      if (idx <= 0) continue;
      result[entry.slice(0, idx)] = entry.slice(idx + 1);
    }

    if (Object.keys(result).length === 0) return null;
    if (process.platform === 'win32' && typeof result.PATH !== 'string') {
      const pathEntry = Object.entries(result).find(([key]) => key.toLowerCase() === 'path');
      if (pathEntry && typeof pathEntry[1] === 'string') result.PATH = pathEntry[1];
    }
    return result;
  };

  const isExecutable = (filePath) => {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return false;
      if (process.platform === 'win32') {
        const ext = path.extname(filePath).toLowerCase();
        return !ext || ['.exe', '.cmd', '.bat', '.com'].includes(ext);
      }
      fs.accessSync(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  const searchPathFor = (binaryName) => {
    const trimmed = typeof binaryName === 'string' ? binaryName.trim() : '';
    if (!trimmed) return null;

    const candidateNames = [];
    if (process.platform === 'win32' && !path.extname(trimmed)) {
      const pathExt = process.env.PATHEXT || process.env.PathExt || '.COM;.EXE;.BAT;.CMD';
      for (const ext of pathExt.split(';')) {
        const normalizedExt = ext.trim();
        if (!normalizedExt) continue;
        candidateNames.push(`${trimmed}${normalizedExt.startsWith('.') ? normalizedExt : `.${normalizedExt}`}`);
      }
    }
    candidateNames.push(trimmed);

    for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
      for (const candidateName of candidateNames) {
        const candidate = path.join(dir, candidateName);
        if (isExecutable(candidate)) return candidate;
      }
    }
    return null;
  };

  const getWindowsShellEnvSnapshot = () => {
    const psScript = [
      '$entries = [ordered]@{}',
      'Get-ChildItem Env: | ForEach-Object { $entries[$_.Name] = $_.Value }',
      "$pathValues = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), [Environment]::GetEnvironmentVariable('Path', 'Process')) | Where-Object { $_ }",
      "if ($pathValues.Count -gt 0) { $entries['Path'] = ($pathValues -join ';') }",
      "$entries.GetEnumerator() | ForEach-Object { [Console]::Out.Write($_.Name); [Console]::Out.Write('='); [Console]::Out.Write($_.Value); [Console]::Out.Write([char]0) }",
    ].join('; ');

    for (const shellPath of ['pwsh.exe', 'powershell.exe']) {
      try {
        const result = runSpawnSync(shellPath, ['-NoLogo', '-Command', psScript], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        });
        if (result.status !== 0) continue;
        const parsed = parseNullSeparatedEnvSnapshot(result.stdout || '');
        if (parsed) return parsed;
      } catch {
      }
    }

    return null;
  };

  const getLoginShellEnvSnapshot = () => {
    if (state.cachedLoginShellEnvSnapshot !== undefined) {
      return state.cachedLoginShellEnvSnapshot;
    }

    if (process.platform === 'win32') {
      state.cachedLoginShellEnvSnapshot = getWindowsShellEnvSnapshot();
      return state.cachedLoginShellEnvSnapshot;
    }

    const shellCandidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean);
    for (const shellPath of shellCandidates) {
      if (!isExecutable(shellPath)) continue;
      try {
        const result = runSpawnSync(shellPath, ['-lic', 'env -0'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        });
        if (result.status !== 0) continue;
        const parsed = parseNullSeparatedEnvSnapshot(result.stdout || '');
        if (parsed) {
          state.cachedLoginShellEnvSnapshot = parsed;
          return parsed;
        }
      } catch {
      }
    }

    state.cachedLoginShellEnvSnapshot = null;
    return null;
  };

  const applyLoginShellEnvSnapshot = () => {
    const snapshot = getLoginShellEnvSnapshot();
    if (!snapshot) return null;

    if (typeof snapshot.PATH === 'string' && snapshot.PATH) {
      process.env.PATH = mergePathValues(process.env.PATH || '', snapshot.PATH, path.delimiter);
    }
    return snapshot;
  };

  const resolveGitBinaryForSpawn = () => searchPathFor('git') || 'git';

  return {
    applyLoginShellEnvSnapshot,
    getLoginShellEnvSnapshot,
    isExecutable,
    searchPathFor,
    resolveGitBinaryForSpawn,
  };
};

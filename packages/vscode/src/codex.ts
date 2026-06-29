import * as vscode from 'vscode';
import * as os from 'os';
import { normalizeWindowsDriveLetter } from './pathUtils';
import { resolveWorkingDirectoryChange } from './workingDirectoryChange';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

type CodexDebugInfo = {
  mode: 'vscode';
  status: ConnectionStatus;
  lastError?: string;
  workingDirectory: string;
  cliAvailable: boolean;
  serverUrl: string | null;
  startCount: number;
  restartCount: number;
  lastStartAt: number | null;
  lastConnectedAt: number | null;
};

type SetWorkingDirectoryResult =
  | { success: true; path: string }
  | { success: false; error: string };

export interface CodexManager {
  start(workdir?: string): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  setWorkingDirectory(path: string): Promise<SetWorkingDirectoryResult>;
  getStatus(): ConnectionStatus;
  getRuntimeApiUrl(): string | null;
  getRuntimeAuthHeaders(): Record<string, string>;
  getWorkingDirectory(): string;
  isCliAvailable(): boolean;
  getDebugInfo(): CodexDebugInfo;
  onStatusChange(callback: (status: ConnectionStatus, error?: string) => void): vscode.Disposable;
}

export function createCodexManager(_context: vscode.ExtensionContext): CodexManager {
  void _context;
  let status: ConnectionStatus = 'disconnected';
  let lastError: string | undefined;
  const listeners = new Set<(status: ConnectionStatus, error?: string) => void>();
  const workspaceDirectory = (): string =>
    normalizeWindowsDriveLetter(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir());
  let workingDirectory = workspaceDirectory();
  let startCount = 0;
  let restartCount = 0;
  let lastStartAt: number | null = null;
  let lastConnectedAt: number | null = null;

  const setStatus = (nextStatus: ConnectionStatus, error?: string) => {
    if (status === nextStatus && lastError === error) {
      return;
    }
    status = nextStatus;
    lastError = error;
    if (nextStatus === 'connected') {
      lastConnectedAt = Date.now();
    }
    listeners.forEach((callback) => callback(status, error));
  };

  const start = async (workdir?: string): Promise<void> => {
    startCount += 1;
    lastStartAt = Date.now();
    if (typeof workdir === 'string' && workdir.trim().length > 0) {
      workingDirectory = normalizeWindowsDriveLetter(workdir.trim());
    } else {
      workingDirectory = workspaceDirectory();
    }
    setStatus('connected');
  };

  const stop = async (): Promise<void> => {
    setStatus('disconnected');
  };

  const restart = async (): Promise<void> => {
    restartCount += 1;
    await start(workingDirectory);
  };

  const setWorkingDirectory = async (nextPath: string): Promise<SetWorkingDirectoryResult> => {
    if (typeof nextPath !== 'string' || nextPath.trim().length === 0) {
      return { success: false, error: 'Working directory is required' };
    }
    const result = resolveWorkingDirectoryChange(workingDirectory, nextPath);
    workingDirectory = result.path;
    return { success: true, path: workingDirectory };
  };

  return {
    start,
    stop,
    restart,
    setWorkingDirectory,
    getStatus: () => status,
    getRuntimeApiUrl: () => null,
    getRuntimeAuthHeaders: () => ({}),
    getWorkingDirectory: () => workingDirectory,
    isCliAvailable: () => true,
    getDebugInfo: () => ({
      mode: 'vscode',
      status,
      lastError,
      workingDirectory,
      cliAvailable: true,
      serverUrl: null,
      startCount,
      restartCount,
      lastStartAt,
      lastConnectedAt,
    }),
    onStatusChange: (callback) => {
      listeners.add(callback);
      return new vscode.Disposable(() => listeners.delete(callback));
    },
  };
}

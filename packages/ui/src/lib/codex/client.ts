import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeUrlResolver } from '@/lib/runtime-url';
import type {
  CodexApprovalView,
  CodexRuntimeHealth,
  CodexThreadStartRequest,
  CodexTurnStartRequest,
} from './types';

const parseJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = typeof data?.error?.message === 'string'
      ? data.error.message
      : `Codex request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
};

const jsonRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await runtimeFetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return parseJson<T>(response);
};

export const codexClient = {
  getHealth: (): Promise<CodexRuntimeHealth> =>
    jsonRequest<CodexRuntimeHealth>('/api/codex/health'),

  getCapabilities: (): Promise<unknown> =>
    jsonRequest('/api/codex/capabilities'),

  readAccount: (query: { refreshToken?: boolean } = {}): Promise<unknown> =>
    runtimeFetch('/api/codex/account', { query }).then((response) => parseJson(response)),

  loginAccount: (body: Record<string, unknown>): Promise<unknown> =>
    jsonRequest('/api/codex/account/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancelAccountLogin: (loginId: string): Promise<unknown> =>
    jsonRequest('/api/codex/account/login/cancel', {
      method: 'POST',
      body: JSON.stringify({ loginId }),
    }),

  logoutAccount: (): Promise<unknown> =>
    jsonRequest('/api/codex/account/logout', { method: 'POST' }),

  getAuthStatus: (query: { includeToken?: boolean; refreshToken?: boolean } = {}): Promise<unknown> =>
    runtimeFetch('/api/codex/auth/status', { query }).then((response) => parseJson(response)),

  restart: (body: { cwd?: string } = {}): Promise<unknown> =>
    jsonRequest('/api/codex/restart', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listThreads: (query: { archived?: boolean; cwd?: string; limit?: number; cursor?: string } = {}): Promise<unknown> =>
    runtimeFetch('/api/codex/threads', { query }).then((response) => parseJson(response)),

  startThread: (body: CodexThreadStartRequest): Promise<unknown> =>
    jsonRequest('/api/codex/threads', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  readThread: (threadId: string, query: { includeTurns?: boolean } = {}): Promise<unknown> =>
    runtimeFetch(`/api/codex/threads/${encodeURIComponent(threadId)}`, { query }).then((response) => parseJson(response)),

  listThreadTurns: (
    threadId: string,
    query: { limit?: number; cursor?: string | number; sortDirection?: string; itemsView?: string } = {},
  ): Promise<unknown> =>
    runtimeFetch(`/api/codex/threads/${encodeURIComponent(threadId)}/turns`, { query }).then((response) => parseJson(response)),

  listThreadTurnItems: (
    threadId: string,
    turnId: string,
    query: { limit?: number; cursor?: string | number; sortDirection?: string } = {},
  ): Promise<unknown> =>
    runtimeFetch(
      `/api/codex/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/items`,
      { query },
    ).then((response) => parseJson(response)),

  updateThread: (threadId: string, body: Record<string, unknown>): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  forkThread: (threadId: string, body: Record<string, unknown> = {}): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}/fork`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  rollbackThread: (threadId: string, body: { numTurns: number }): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}/rollback`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  compactThread: (threadId: string): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}/compact`, {
      method: 'POST',
    }),

  archiveThread: (threadId: string): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}/archive`, { method: 'POST' }),

  unarchiveThread: (threadId: string): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}/unarchive`, { method: 'POST' }),

  deleteThread: (threadId: string): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' }),

  startTurn: (threadId: string, body: CodexTurnStartRequest): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}/turns`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  shellCommand: (threadId: string, body: { command: string }): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}/shell`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  steerTurn: (threadId: string, turnId: string, body: { input: CodexTurnStartRequest['input'] }): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/steer`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  interruptTurn: (threadId: string, turnId: string): Promise<unknown> =>
    jsonRequest(`/api/codex/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`, {
      method: 'POST',
    }),

  listApprovals: (): Promise<{ approvals: CodexApprovalView[] }> =>
    jsonRequest('/api/codex/approvals'),

  replyToApproval: (requestId: string, response: Record<string, unknown>): Promise<unknown> =>
    jsonRequest(`/api/codex/approvals/${encodeURIComponent(requestId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ response }),
    }),

  readConfig: (): Promise<unknown> =>
    jsonRequest('/api/codex/config'),

  updateConfig: (body: Record<string, unknown>): Promise<unknown> =>
    jsonRequest('/api/codex/config', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  listModels: (query: { cwd?: string } = {}): Promise<unknown> =>
    runtimeFetch('/api/codex/models', { query }).then((response) => parseJson(response)),

  listMcp: (): Promise<unknown> =>
    jsonRequest('/api/codex/mcp'),

  listSkills: (): Promise<unknown> =>
    jsonRequest('/api/codex/skills'),

  eventsUrl: (): string => getRuntimeUrlResolver().sse('/api/codex/events'),
};

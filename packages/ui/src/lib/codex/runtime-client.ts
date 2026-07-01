/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DirectoryListResult, FilesAPI } from '../api/types';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { codexClient } from '@/lib/codex/client';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeUrlResolver } from '@/lib/runtime-url';
import type { Agent, Config, CodexRuntimeSdkClient, Event, Message, Part, Provider, Session } from '@/lib/codex/types';
import type { PermissionRequest } from '@/types/permission';
import type { QuestionRequest } from '@/types/question';

export type ProjectFileSearchHit = {
  name: string;
  path: string;
  relativePath: string;
  extension?: string;
};

type DirectorySwitchResult = {
  success: boolean;
  restarted: boolean;
  path: string;
  agents?: Agent[];
  providers?: Provider[];
  models?: unknown[];
};

type SdkResult<T = unknown> = {
  data?: T;
  error?: unknown;
  response?: { status?: number; headers?: Headers };
};

type CompatSessionStatus = {
  type?: string;
  attempt?: number;
  message?: string;
  next?: number;
};

type CompatMessageRecord = {
  info: Message;
  parts: Part[];
};

type CodexEventStreamOptions = {
  signal?: AbortSignal;
  headers?: HeadersInit;
  onSseEvent?: (event: { id?: string; event?: string }) => void;
  onSseError?: (error: unknown) => void;
};

type CodexThread = Record<string, any>;
type CodexTurn = Record<string, any>;
type CodexThreadItem = Record<string, any>;
type CompatMessageTime = { created: number; updated?: number; completed?: number };
type CompatMessageOptions = { parentID?: string; status?: string; finish?: string };
type CompatPartTime = { start?: number; end?: number };

const CODEX_SYSTEM_ERROR_MESSAGE = 'Codex runtime reported a system error before producing an assistant response.';

const normalizeFsPath = (value: string): string => value.replace(/\\/g, '/');

const unsupported = (operation: string): never => {
  throw new Error(`${operation} is no longer available after the Codex runtime migration.`);
};

const ok = <T>(data: T): SdkResult<T> => ({ data });

const createUnsupportedSdkProxy = (path = 'sdk'): any => new Proxy(() => undefined, {
  get(_target, property) {
    if (property === 'then') return undefined;
    return createUnsupportedSdkProxy(`${path}.${String(property)}`);
  },
  apply() {
    return Promise.reject(new Error(`${path} is no longer available after the Codex runtime migration.`));
  },
});

const createCompatSdkProxy = (target: Record<string, any>, path = 'sdk'): any => new Proxy(target, {
  get(object, property) {
    if (property === 'then') return undefined;
    if (property in object) {
      const value = object[property as keyof typeof object];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return createCompatSdkProxy(value, `${path}.${String(property)}`);
      }
      return value;
    }
    return createUnsupportedSdkProxy(`${path}.${String(property)}`);
  },
});

const extractArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data;
  }
  if (value && typeof value === 'object' && Array.isArray((value as { threads?: unknown }).threads)) {
    return (value as { threads: unknown[] }).threads;
  }
  return [];
};

const extractObject = (value: unknown, key: string): Record<string, any> | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, any>;
  if (record[key] && typeof record[key] === 'object') return record[key] as Record<string, any>;
  return record;
};

const extractNextCursor = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const cursor = (value as { nextCursor?: unknown }).nextCursor;
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
};

const okPage = <T>(data: T, nextCursor: string | null): SdkResult<T> => {
  const result = ok(data);
  if (nextCursor) {
    result.response = { headers: new Headers({ 'x-next-cursor': nextCursor }) };
  }
  return result;
};

const secondsToMilliseconds = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value > 10_000_000_000 ? Math.trunc(value) : Math.trunc(value * 1000);
};

const firstTimestamp = (...values: unknown[]): number | undefined => {
  for (const value of values) {
    const timestamp = secondsToMilliseconds(value);
    if (timestamp !== undefined) return timestamp;
  }
  return undefined;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
};

const isEmptyCodexThreadHistoryError = (error: unknown): boolean => {
  const message = errorMessage(error);
  return message.includes('is not materialized yet')
    || message.includes('includeTurns is unavailable before first user message')
    || message.includes('thread/turns/list is unavailable before first user message')
    || (message.includes('rollout at ') && message.includes(' is empty'))
    || (message.includes('thread-store internal error') && message.includes('failed to read thread') && message.includes(' is empty'));
};

const readSessionId = (input: unknown): string | null => {
  if (typeof input === 'string' && input) return input;
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const value = record.sessionID ?? record.sessionId ?? record.id ?? record.threadId;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const codexTextInput = (text: string) => ({
  type: 'text',
  text,
  text_elements: [],
});

const stripFileUrl = (value: string): string => {
  if (!value.startsWith('file://')) return value;
  try {
    return decodeURIComponent(new URL(value).pathname);
  } catch {
    return value.slice('file://'.length);
  }
};

const basename = (value: string): string => {
  const normalized = normalizeFsPath(value);
  return normalized.split('/').filter(Boolean).pop() || normalized;
};

const normalizeCodexFileInput = (value: unknown): unknown | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const mime = typeof record.mime === 'string' ? record.mime : '';
  const type = typeof record.type === 'string' ? record.type : '';
  const detail = typeof record.detail === 'string' ? { detail: record.detail } : {};
  const url = typeof record.url === 'string' ? record.url : null;
  const path = typeof record.path === 'string'
    ? record.path
    : url?.startsWith('file://')
      ? stripFileUrl(url)
      : null;
  const name = typeof record.filename === 'string' && record.filename
    ? record.filename
    : path
      ? basename(path)
      : url
        ? basename(url)
        : 'attachment';

  if (mime.startsWith('image/') || type === 'image') {
    if (path) return { type: 'localImage', path, ...detail };
    if (url) return { type: 'image', url, ...detail };
  }

  if (path) return { type: 'mention', name, path };
  return null;
};

const normalizeCodexInput = (params: { text?: string; parts?: unknown[]; input?: unknown; files?: unknown[]; additionalParts?: unknown[] }): unknown[] => {
  if (Array.isArray(params.input)) return params.input;
  const inputs: unknown[] = [];
  const appendText = (text: unknown) => {
    if (typeof text === 'string' && text.length > 0) {
      inputs.push(codexTextInput(text));
    }
  };
  const appendFiles = (files: unknown) => {
    if (!Array.isArray(files)) return;
    for (const file of files) {
      const input = normalizeCodexFileInput(file);
      if (input) inputs.push(input);
    }
  };

  const text = typeof params.text === 'string' ? params.text : '';
  appendText(text);

  for (const collection of [params.parts, params.additionalParts]) {
    if (!Array.isArray(collection) || collection.length === 0) continue;
    const mapped = collection
      .map((part) => {
        if (!part || typeof part !== 'object') return null;
        const record = part as Record<string, unknown>;
        if (record.type === 'text' || typeof record.text === 'string' || typeof record.content === 'string') {
          const text = typeof record.text === 'string'
            ? record.text
            : typeof record.content === 'string'
              ? record.content
              : '';
          return text ? codexTextInput(text) : null;
        }
        if (record.type === 'file' || record.url || record.path) return normalizeCodexFileInput(record);
        return record;
      })
      .filter(Boolean);
    inputs.push(...mapped);
    for (const part of collection) {
      if (part && typeof part === 'object') appendFiles((part as Record<string, unknown>).files);
    }
  }
  appendFiles(params.files);
  return inputs;
};

const readCurrentDirectoryFromRuntime = (): string | null => {
  return null;
};

class CodexCompatClient {
  private directory: string | null = readCurrentDirectoryFromRuntime();

  private readonly sdkProxy: CodexRuntimeSdkClient;

  private readonly activeTurns = new Map<string, string>();

  private readonly pendingTurns = new Set<string>();

  private readonly turnItemOrders = new Map<string, Map<string, number>>();

  private readonly nextTurnItemOrder = new Map<string, number>();

  private readonly turnMessageIds = new Map<string, Set<string>>();

  private readonly pendingProviderOAuthLogins = new Map<string, string>();

  constructor() {
    const sessionApi = {
      create: async (input: unknown) => ok(await this.createSession(input as any)),
      list: async (params: unknown = {}) => this.listSessionsResult(params as Record<string, unknown>),
      get: async (params: unknown) => {
        const sessionId = readSessionId(params);
        if (!sessionId) return ok(null);
        return ok(await this.getSession(sessionId, (params as { directory?: string | null })?.directory));
      },
      update: async (params: unknown = {}) => {
        const sessionId = readSessionId(params);
        if (!sessionId) return ok(null);
        return ok(await this.updateSession(sessionId, params as Record<string, unknown>, (params as { directory?: string | null })?.directory));
      },
      delete: async (params: unknown) => {
        const sessionId = readSessionId(params);
        return ok(sessionId ? await this.deleteSession(sessionId, (params as { directory?: string | null })?.directory) : false);
      },
      messages: async (params: unknown = {}) => {
        const sessionId = readSessionId(params);
        if (!sessionId) return ok([]);
        const limit = typeof (params as { limit?: unknown }).limit === 'number' ? (params as { limit: number }).limit : undefined;
        const before = typeof (params as { before?: unknown }).before === 'string' ? (params as { before: string }).before : undefined;
        return this.getSessionMessagesResult(sessionId, limit, before);
      },
      children: async () => ok([]),
      init: async () => ok({}),
      abort: async (params: unknown) => {
        const sessionId = readSessionId(params);
        if (sessionId) await this.abortSession(sessionId);
        return ok(true);
      },
      revert: async (params: unknown = {}) => {
        const sessionId = readSessionId(params);
        if (!sessionId) return ok(null);
        const record = params as Record<string, unknown>;
        const messageId = typeof record.messageID === 'string'
          ? record.messageID
          : typeof record.messageId === 'string'
            ? record.messageId
            : undefined;
        return ok(await this.revertSession(sessionId, messageId, undefined, typeof record.directory === 'string' ? record.directory : undefined));
      },
      fork: async (params: unknown = {}) => {
        const sessionId = readSessionId(params);
        if (!sessionId) return ok(null);
        const record = params as Record<string, unknown>;
        const messageId = typeof record.messageID === 'string'
          ? record.messageID
          : typeof record.messageId === 'string'
            ? record.messageId
            : undefined;
        return ok(await this.forkSession(sessionId, messageId, typeof record.directory === 'string' ? record.directory : undefined));
      },
      command: async (params: unknown = {}) => ok(await this.sendCommand(params as any)),
      prompt: async (params: unknown) => ok(await this.sendMessage(params as any)),
      promptAsync: async (params: unknown) => ok(await this.sendMessage(params as any)),
      status: async () => ok(await this.getSessionStatus()),
      unrevert: async (params: unknown = {}) => {
        const sessionId = readSessionId(params);
        return ok(sessionId ? await this.unrevertSession(sessionId, (params as { directory?: string | null })?.directory) : null);
      },
      share: async () => ok(null),
      unshare: async () => ok(null),
      summarize: async (params: unknown = {}) => {
        const sessionId = readSessionId(params);
        if (sessionId) await this.summarizeSession(sessionId);
        return ok({});
      },
      todo: async () => ok([]),
    };
    this.sdkProxy = createCompatSdkProxy({
      app: {
        agents: async () => ok(await this.listAgents()),
        skills: async () => ok(await this.listSkillsWithDetails()),
      },
      path: {
        get: async () => ok({ state: '', config: '', worktree: '', directory: this.getDirectory() ?? '', home: '' }),
      },
      project: {
        current: async () => ok({ id: this.getDirectory() ?? '', path: this.getDirectory() ?? '' }),
        list: async () => ok([]),
      },
      config: {
        get: async () => ok(await this.getConfig()),
        providers: async () => ok(await this.getProviders()),
        update: async (config: Record<string, unknown>) => ok(await this.updateConfig(config)),
      },
      global: {
        config: {
          get: async () => ok(await this.getConfig()),
        },
        event: (options: CodexEventStreamOptions = {}) => this.openEventStream(options),
      },
      experimental: {
        session: sessionApi,
      },
      session: sessionApi,
      permission: {
        list: async () => ok(await this.listPendingPermissions()),
      },
      question: {
        list: async () => ok(await this.listPendingQuestions()),
      },
      command: {
        list: async () => ok(await this.listCommands()),
      },
      mcp: {
        status: async () => ok({}),
      },
      lsp: {
        status: async () => ok([]),
      },
      vcs: {
        get: async () => ok({}),
      },
      provider: {
        list: async () => ok(await this.getProviders()),
        auth: async () => ok(await this.getProviderAuthMethods()),
        oauth: {
          authorize: async (params: unknown) => ok(await this.authorizeProviderOAuth(params as Record<string, unknown>)),
          callback: async (params: unknown) => ok(await this.completeProviderOAuth(params as Record<string, unknown>)),
        },
      },
      auth: {
        set: async (params: unknown) => ok(await this.setProviderApiKey(params as Record<string, unknown>)),
      },
    }) as CodexRuntimeSdkClient;
  }

  reconnectToRuntimeBaseUrl(): void {
    this.clearConfigCache();
  }

  getBaseUrl(): string {
    try {
      return getRuntimeUrlResolver().api('/api');
    } catch {
      return '/api';
    }
  }

  getSdkClient(): CodexRuntimeSdkClient {
    return this.sdkProxy;
  }

  getApiClient(): CodexRuntimeSdkClient {
    return this.sdkProxy;
  }

  getScopedSdkClient(_directory?: string | null): CodexRuntimeSdkClient {
    void _directory;
    return this.sdkProxy;
  }

  getScopedApiClient(_directory?: string | null): CodexRuntimeSdkClient {
    void _directory;
    return this.sdkProxy;
  }

  setDirectory(directory?: string | null): void {
    this.directory = typeof directory === 'string' && directory.trim() ? directory.trim() : null;
  }

  getDirectory(): string | null {
    return this.directory ?? readCurrentDirectoryFromRuntime();
  }

  async withDirectory<T>(directory: string | null | undefined, fn: () => Promise<T> | T): Promise<T> {
    const previous = this.directory;
    this.setDirectory(directory ?? previous);
    try {
      return await fn();
    } finally {
      this.directory = previous;
    }
  }

  clearConfigCache(): void {
  }

  async checkHealth(): Promise<boolean> {
    try {
      const health = await codexClient.getHealth();
      if (health.ready || health.running || health.initialized) return true;
      await codexClient.listThreads({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getConfig(_directory?: string | null): Promise<Config> {
    void _directory;
    try {
      const value = await codexClient.readConfig();
      return (extractObject(value, 'config') ?? {}) as Config;
    } catch {
      return {};
    }
  }

  async updateConfig(config: Record<string, unknown>): Promise<Config> {
    return await codexClient.updateConfig(config) as Config;
  }

  async updateConfigPartial(modifier: (config: Config) => Config): Promise<Config> {
    const current = await this.getConfig();
    return this.updateConfig(modifier(current));
  }

  async getProviders(): Promise<{ providers: Provider[]; default: Record<string, string> }> {
    const response = await codexClient.listModels({ cwd: this.getDirectory() ?? undefined }).catch(() => null);
    const rawModels = extractArray(response);
    const providerMap = new Map<string, Provider>();
    for (const rawModel of rawModels) {
      if (!rawModel || typeof rawModel !== 'object') continue;
      const model = rawModel as Record<string, any>;
      const providerID = typeof model.providerID === 'string'
        ? model.providerID
        : typeof model.provider === 'string'
          ? model.provider
          : typeof model.modelProvider === 'string'
            ? model.modelProvider
            : 'codex';
      const modelID = typeof model.id === 'string'
        ? model.id
        : typeof model.modelID === 'string'
          ? model.modelID
          : typeof model.name === 'string'
            ? model.name
            : null;
      if (!modelID) continue;
      const provider = providerMap.get(providerID) ?? {
        id: providerID,
        name: providerID,
        models: {},
        source: 'codex',
      };
      provider.models[modelID] = {
        id: modelID,
        name: typeof model.name === 'string' ? model.name : modelID,
        displayName: typeof model.displayName === 'string' ? model.displayName : undefined,
        providerID,
        modelID,
        ...model,
      };
      providerMap.set(providerID, provider);
    }
    return { providers: Array.from(providerMap.values()), default: {} };
  }

  async getProvidersForConfig(_directory?: string | null): Promise<{ providers: Provider[]; default: Record<string, string> }> {
    void _directory;
    return this.getProviders();
  }

  private isCodexAccountProvider(providerId: unknown): boolean {
    if (typeof providerId !== 'string') return true;
    return ['codex', 'openai', 'chatgpt'].includes(providerId.toLowerCase());
  }

  async getProviderAuthMethods(): Promise<Record<string, Array<{ type: string; name: string; label: string; method: number }>>> {
    const response = await this.getProviders();
    const providerIds = new Set(response.providers.map((provider) => provider.id));
    providerIds.add('openai');
    providerIds.add('codex');
    const authMethods: Record<string, Array<{ type: string; name: string; label: string; method: number }>> = {};
    for (const providerId of providerIds) {
      if (!this.isCodexAccountProvider(providerId)) continue;
      authMethods[providerId] = [
        { type: 'oauth', name: 'ChatGPT', label: 'ChatGPT', method: 0 },
      ];
    }
    return authMethods;
  }

  async setProviderApiKey(params: Record<string, unknown>): Promise<unknown> {
    if (!this.isCodexAccountProvider(params.providerID ?? params.providerId)) {
      throw new Error('Codex API key login is only available for OpenAI-backed Codex providers.');
    }
    const auth = params.auth && typeof params.auth === 'object' ? params.auth as Record<string, unknown> : {};
    const apiKey = typeof auth.key === 'string'
      ? auth.key
      : typeof params.apiKey === 'string'
        ? params.apiKey
        : typeof params.key === 'string'
          ? params.key
          : '';
    if (!apiKey.trim()) {
      throw new Error('Codex API key is required.');
    }
    return codexClient.loginAccount({ type: 'apiKey', apiKey: apiKey.trim() });
  }

  async authorizeProviderOAuth(params: Record<string, unknown>): Promise<unknown> {
    if (!this.isCodexAccountProvider(params.providerID ?? params.providerId)) {
      throw new Error('Codex OAuth login is only available for OpenAI-backed Codex providers.');
    }
    const response = await codexClient.loginAccount({ type: 'chatgpt', codexStreamlinedLogin: true });
    const record = response && typeof response === 'object' ? response as Record<string, unknown> : {};
    const loginId = typeof record.loginId === 'string' ? record.loginId : null;
    if (loginId) {
      const providerId = typeof params.providerID === 'string'
        ? params.providerID
        : typeof params.providerId === 'string'
          ? params.providerId
          : 'codex';
      const method = typeof params.method === 'number' ? params.method : 0;
      this.pendingProviderOAuthLogins.set(`${providerId}:${method}`, loginId);
    }
    return {
      ...record,
      ...(typeof record.authUrl === 'string' ? { url: record.authUrl } : {}),
      ...(typeof record.verificationUrl === 'string' ? { url: record.verificationUrl, verification_uri: record.verificationUrl } : {}),
      ...(typeof record.userCode === 'string' ? { user_code: record.userCode } : {}),
    };
  }

  async completeProviderOAuth(params: Record<string, unknown>): Promise<unknown> {
    const account = await codexClient.readAccount({ refreshToken: true });
    const accountPayload = account && typeof account === 'object' ? account as Record<string, unknown> : {};
    const accountRecord = accountPayload.account;
    if (!accountRecord || typeof accountRecord !== 'object') {
      throw new Error('Codex account login is not complete.');
    }
    const providerId = typeof params.providerID === 'string'
      ? params.providerID
      : typeof params.providerId === 'string'
        ? params.providerId
        : 'codex';
    const method = typeof params.method === 'number' ? params.method : 0;
    this.pendingProviderOAuthLogins.delete(`${providerId}:${method}`);
    return account;
  }

  async listAgents(_directory?: string | null): Promise<Agent[]> {
    void _directory;
    return [];
  }

  async listToolIds(_options?: unknown): Promise<string[]> {
    void _options;
    return [];
  }

  async listSessions(params: Record<string, unknown> = {}): Promise<Session[]> {
    return (await this.listSessionsResult(params)).data ?? [];
  }

  private async listSessionsResult(params: Record<string, unknown> = {}): Promise<SdkResult<Session[]>> {
    const response = await codexClient.listThreads({
      archived: typeof params.archived === 'boolean' ? params.archived : undefined,
      cwd: typeof params.directory === 'string' ? params.directory : this.getDirectory() ?? undefined,
      limit: typeof params.limit === 'number' ? params.limit : undefined,
      cursor: typeof params.cursor === 'string' || typeof params.cursor === 'number' ? String(params.cursor) : undefined,
    });
    return okPage(extractArray(response).map((item) => this.toSession(item as CodexThread)), extractNextCursor(response));
  }

  async getSession(id: string, _directory?: string | null): Promise<Session> {
    void _directory;
    const response = await codexClient.readThread(id, { includeTurns: false });
    const thread = extractObject(response, 'thread');
    return this.toSession((thread ?? { id }) as CodexThread);
  }

  async createSession(input: string | { title?: string; directory?: string | null; [key: string]: unknown } = {}, _directory?: string | null): Promise<Session> {
    const title = typeof input === 'string' ? input : input.title;
    const cwd = typeof input === 'object' ? input.directory ?? _directory ?? undefined : _directory ?? undefined;
    const response = await codexClient.startThread({ title, cwd });
    const thread = extractObject(response, 'thread');
    if (thread) return this.toSession(thread);
    const id = this.extractThreadId(response) ?? `thread_${Date.now().toString(16)}`;
    return { id, title, directory: cwd, time: { created: Date.now() } };
  }

  async updateSession(id: string, patch: Record<string, unknown>, _directory?: string | null): Promise<Session> {
    void _directory;
    await codexClient.updateThread(id, patch).catch(() => undefined);
    return { id, ...patch, time: {} };
  }

  async deleteSession(id: string, _directory?: string | null): Promise<boolean> {
    void _directory;
    await codexClient.deleteThread(id).catch(() => undefined);
    return true;
  }

  async getSessionMessages(id: string, limit?: number, before?: string): Promise<CompatMessageRecord[]> {
    return (await this.getSessionMessagesResult(id, limit, before)).data ?? [];
  }

  private async getSessionMessagesResult(id: string, limit?: number, before?: string): Promise<SdkResult<CompatMessageRecord[]>> {
    const response = await codexClient.listThreadTurns(id, {
      limit,
      cursor: before,
      sortDirection: 'asc',
      itemsView: 'full',
    }).catch((error) => {
      if (isEmptyCodexThreadHistoryError(error)) {
        return { data: [], nextCursor: null };
      }
      throw error;
    });
    const turns = extractArray(response) as CodexTurn[];
    const records = turns.flatMap((turn) => this.toMessageRecords(id, turn));
    if (!before && this.shouldAppendSystemErrorMessage(records, turns)) {
      const thread = await this.readThreadForStatus(id);
      if (thread && this.isSystemErrorThread(thread)) {
        records.push(this.toSystemErrorMessageRecord(id, turns));
      }
    }
    return okPage(records, extractNextCursor(response));
  }

  async getSessionStatus(): Promise<Record<string, CompatSessionStatus>> {
    const statuses = await this.getSessionStatusForDirectory(this.getDirectory());
    if (statuses === null) {
      throw new Error('Codex session status snapshot failed');
    }
    return statuses;
  }

  async getSessionStatusForDirectory(directory?: string | null, candidateSessionIds?: string[]): Promise<Record<string, CompatSessionStatus> | null> {
    const statuses: Record<string, CompatSessionStatus> = {};
    const candidates = Array.from(new Set((candidateSessionIds ?? []).filter((id) => typeof id === 'string' && id.length > 0)));
    if (candidates.length > 0) {
      const results = await Promise.all(candidates.map(async (id) => {
        try {
          const response = await codexClient.readThread(id, { includeTurns: false });
          return extractObject(response, 'thread') as CodexThread | null;
        } catch {
          return null;
        }
      }));
      if (results.some((thread) => thread === null)) {
        return null;
      }
      for (const thread of results) {
        if (!thread || typeof thread.id !== 'string') continue;
        const status = this.toSessionStatus(thread);
        if (status && status.type !== 'idle') {
          statuses[thread.id] = status;
        }
      }
      return statuses;
    }

    const response = await codexClient.listThreads({
      archived: false,
      cwd: typeof directory === 'string' ? directory : this.getDirectory() ?? undefined,
      limit: 200,
    });
    for (const thread of extractArray(response) as CodexThread[]) {
      if (!thread || typeof thread.id !== 'string') continue;
      const status = this.toSessionStatus(thread);
      if (status && status.type !== 'idle') {
        statuses[thread.id] = status;
      }
    }
    return statuses;
  }

  async listPendingQuestions(_options?: unknown): Promise<QuestionRequest[]> {
    void _options;
    return [];
  }

  async listPendingPermissions(_options?: unknown): Promise<PermissionRequest[]> {
    void _options;
    return [];
  }

  async sendMessage(params: { id?: string; sessionId?: string; sessionID?: string; text?: string; parts?: unknown[]; [key: string]: unknown }): Promise<CompatMessageRecord> {
    const sessionId = params.id ?? params.sessionId ?? params.sessionID;
    if (typeof sessionId !== 'string' || !sessionId) return unsupported('sendMessage without a Codex thread');
    const input = normalizeCodexInput(params);
    if (input.length === 0) return unsupported('sendMessage without Codex input');
    const model = typeof params.model === 'string'
      ? params.model
      : typeof params.modelID === 'string'
        ? params.modelID
        : undefined;
    this.pendingTurns.add(sessionId);
    try {
      const response = await codexClient.startTurn(sessionId, {
        input: input as any,
        cwd: typeof params.directory === 'string' ? params.directory : this.getDirectory() ?? undefined,
        ...(model ? { model } : {}),
        ...(typeof params.messageId === 'string' ? { clientUserMessageId: params.messageId } : {}),
      });
      const turn = extractObject(response, 'turn');
      if (typeof turn?.id === 'string') {
        this.activeTurns.set(sessionId, turn.id);
      }
    } finally {
      this.pendingTurns.delete(sessionId);
    }
    const record = this.toUserMessageRecord(sessionId, `local_${Date.now().toString(16)}`, input);
    return record;
  }

  async sendCommand(params: { id?: string; sessionId?: string; sessionID?: string; command?: string; arguments?: string; skillPath?: string; [key: string]: unknown } = {}): Promise<string> {
    const command = typeof params.command === 'string' ? params.command.trim() : '';
    const args = typeof params.arguments === 'string' ? params.arguments.trim() : '';
    if (!command) return unsupported('sendCommand without a Codex command');
    const input = typeof params.skillPath === 'string' && params.skillPath
      ? [
          { type: 'skill', name: command, path: params.skillPath },
          ...(args ? [codexTextInput(args)] : []),
        ]
      : [codexTextInput(`/${command}${args ? ` ${args}` : ''}`)];
    await this.sendMessage({ ...params, input });
    return command;
  }

  async shellSession(params: { sessionId?: string; id?: string; sessionID?: string; command?: string; directory?: string | null; [key: string]: unknown }): Promise<CompatMessageRecord> {
    const sessionId = params.sessionId ?? params.id ?? params.sessionID;
    if (typeof sessionId !== 'string' || !sessionId) return unsupported('shellSession without a Codex thread');
    const command = typeof params.command === 'string' ? params.command : '';
    if (!command.trim()) return unsupported('shellSession without a shell command');
    await codexClient.shellCommand(sessionId, { command });
    return this.toUserMessageRecord(sessionId, `local_${Date.now().toString(16)}`, [codexTextInput(command)]);
  }

  async summarizeSession(..._args: unknown[]): Promise<void> {
    const sessionId = typeof _args[0] === 'string' ? _args[0] : '';
    if (!sessionId) return unsupported('summarizeSession without a Codex thread');
    await codexClient.compactThread(sessionId);
  }

  async revertSession(sessionId: string, messageId?: string, _partId?: string, directory?: string | null): Promise<Session> {
    void _partId;
    if (!sessionId) return unsupported('revertSession without a Codex thread');
    const numTurns = await this.resolveRollbackTurnCount(sessionId, messageId);
    const response = await codexClient.rollbackThread(sessionId, { numTurns });
    const thread = extractObject(response, 'thread') ?? { id: sessionId, cwd: directory ?? undefined };
    return {
      ...this.toSession(thread),
      revert: messageId ? { messageID: messageId } : undefined,
    };
  }

  async forkSession(sessionId: string, _messageId?: string, directory?: string | null): Promise<Session> {
    void _messageId;
    if (!sessionId) return unsupported('forkSession without a Codex thread');
    const response = await codexClient.forkThread(sessionId, {
      ...(directory ? { cwd: directory } : {}),
      excludeTurns: true,
    });
    const thread = extractObject(response, 'thread');
    if (thread) return this.toSession(thread);
    const id = this.extractThreadId(response) ?? `thread_${Date.now().toString(16)}`;
    return { id, parentID: sessionId, directory: directory ?? undefined, time: { created: Date.now() } };
  }

  async unrevertSession(sessionId: string, directory?: string | null): Promise<Session> {
    if (!sessionId) return unsupported('unrevertSession without a Codex thread');
    const session = await this.getSession(sessionId, directory);
    if ('revert' in session) {
      const next = { ...session };
      delete (next as { revert?: unknown }).revert;
      return next;
    }
    return session;
  }

  async listCommands(): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; source?: string }>> {
    return [];
  }

  async listCommandsWithDetails(): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; source?: string; template?: string }>> {
    return [];
  }

  async listSkillsWithDetails(): Promise<Array<{ name: string; description?: string; location: string; content?: string }>> {
    const response = await codexClient.listSkills().catch(() => null);
    return extractArray(response)
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        name: typeof item.name === 'string' ? item.name : '',
        description: typeof item.description === 'string' ? item.description : undefined,
        location: typeof item.location === 'string' ? item.location : '',
        content: typeof item.content === 'string' ? item.content : undefined,
      }))
      .filter((item) => item.name && item.location);
  }

  async listLocalDirectory(directory?: string): Promise<Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean; isSymbolicLink?: boolean }>> {
    const apis = getRegisteredRuntimeAPIs();
    const filesApi: FilesAPI | undefined = apis?.files;
    if (!filesApi?.listDirectory) return [];
    const result: DirectoryListResult = await filesApi.listDirectory(directory ?? this.getDirectory() ?? '/');
    return result.entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory,
      isFile: !entry.isDirectory,
    }));
  }

  async searchFiles(query: string, options?: { directory?: string | null; limit?: number; dirs?: boolean; type?: string; includeHidden?: boolean; respectGitignore?: boolean }): Promise<ProjectFileSearchHit[]> {
    const directory = options?.directory ?? this.getDirectory();
    const response = await runtimeFetch('/api/fs/search', {
      query: {
        q: query,
        ...(directory ? { directory } : {}),
        ...(typeof options?.limit === 'number' ? { limit: String(options.limit) } : {}),
        ...(typeof options?.type === 'string' ? { type: options.type } : {}),
        ...(options?.dirs === false ? { dirs: 'false' } : {}),
      },
    }).catch(() => null);
    if (!response?.ok) return [];
    const payload = await response.json().catch(() => null);
    const items: unknown[] = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : [];
    return items
      .map((item: unknown): ProjectFileSearchHit | null => {
        const value = typeof item === 'string'
          ? item
          : item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string'
            ? (item as { path: string }).path
            : null;
        if (!value) return null;
        const normalizedRelativePath = normalizeFsPath(value);
        const name = normalizedRelativePath.split('/').filter(Boolean).pop() || normalizedRelativePath;
        const normalizedPath = directory
          ? normalizeFsPath(`${directory}/${normalizedRelativePath}`)
          : normalizedRelativePath;
        return {
          name,
          path: normalizedPath,
          relativePath: normalizedRelativePath,
          extension: name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined,
        };
      })
      .filter((item): item is ProjectFileSearchHit => Boolean(item));
  }

  async getFilesystemHome(): Promise<string | null> {
    const response = await runtimeFetch('/api/fs/home').catch(() => null);
    if (!response?.ok) return null;
    const payload = await response.json().catch(() => null);
    return typeof payload?.home === 'string' ? payload.home : null;
  }

  async getSystemInfo(): Promise<{ homeDirectory?: string | null; [key: string]: unknown } | null> {
    const response = await runtimeFetch('/api/system/info').catch(() => null);
    if (!response?.ok) return null;
    return await response.json().catch(() => null) as Record<string, unknown> | null;
  }

  async createDirectory(targetPath: string): Promise<void> {
    const apis = getRegisteredRuntimeAPIs();
    if (apis?.files?.createDirectory) {
      await apis.files.createDirectory(targetPath);
      return;
    }
    unsupported('createDirectory');
  }

  async cloneRepository(input: { url?: string; directory?: string; remoteUrl?: string; destinationPath?: string; gitIdentityId?: string | null }): Promise<{ path: string; [key: string]: unknown }> {
    const response = await runtimeFetch('/api/git/clone', {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => null);
    if (response?.ok) {
      const payload = await response.json().catch(() => null);
      if (payload && typeof payload === 'object' && typeof (payload as { path?: unknown }).path === 'string') {
        return payload as { path: string; [key: string]: unknown };
      }
    }
    return { path: input.destinationPath ?? input.directory ?? '' };
  }

  async setCodexWorkingDirectory(directoryPath: string | null | undefined): Promise<DirectorySwitchResult | null> {
    if (!directoryPath?.trim()) return null;
    this.setDirectory(directoryPath);
    return {
      success: true,
      restarted: false,
      path: directoryPath,
    };
  }

  private async abortSession(sessionId: string): Promise<void> {
    const turnId = this.activeTurns.get(sessionId) ?? await this.findActiveTurnId(sessionId);
    if (!turnId) return;
    try {
      await codexClient.interruptTurn(sessionId, turnId);
    } finally {
      this.activeTurns.delete(sessionId);
    }
  }

  private async findActiveTurnId(sessionId: string): Promise<string | null> {
    const response = await codexClient.listThreadTurns(sessionId, {
      limit: 10,
      sortDirection: 'desc',
      itemsView: 'full',
    });
    const turns = extractArray(response) as CodexTurn[];
    const activeTurn = turns.find((turn) => (
      typeof turn?.id === 'string'
      && turn.status !== 'completed'
      && turn.status !== 'failed'
      && turn.status !== 'interrupted'
    ));
    return typeof activeTurn?.id === 'string' ? activeTurn.id : null;
  }

  private async resolveRollbackTurnCount(sessionId: string, messageId?: string): Promise<number> {
    if (!messageId) return 1;
    const codexMessageId = this.toCodexItemId(messageId);
    const response = await codexClient.listThreadTurns(sessionId, {
      limit: 500,
      sortDirection: 'asc',
      itemsView: 'full',
    });
    const turns = extractArray(response) as CodexTurn[];
    if (turns.length === 0) return 1;
    const turnIndex = turns.findIndex((turn) => {
      const items = Array.isArray(turn.items) ? turn.items : [];
      return items.some((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === codexMessageId);
    });
    if (turnIndex < 0) {
      throw new Error('Cannot map the selected message to a Codex turn for rollback.');
    }
    return Math.max(1, turns.length - turnIndex);
  }

  private async openEventStream(options: CodexEventStreamOptions = {}): Promise<{ stream: AsyncIterable<unknown> }> {
    const response = await runtimeFetch('/api/codex/events', {
      signal: options.signal,
      ...(options.headers ? { headers: options.headers } : {}),
    });
    if (!response.ok) {
      throw new Error(`Codex event stream failed with ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Codex event stream response is not readable');
    }

    const stream = this.readCodexEventStream(response.body, options);
    return { stream };
  }

  private async *readCodexEventStream(body: ReadableStream<Uint8Array>, options: CodexEventStreamOptions): AsyncIterable<unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.search(/\r?\n\r?\n/);
        while (separator >= 0) {
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + (buffer[separator] === '\r' ? 4 : 2));
          const event = this.parseSseBlock(block);
          if (!event) {
            options.onSseEvent?.({});
          }
          if (event) {
            options.onSseEvent?.({ id: event.id, event: event.event });
            for (const translated of this.translateCodexEvent(event.data)) {
              yield translated;
            }
          }
          separator = buffer.search(/\r?\n\r?\n/);
        }
      }
      const trailing = this.parseSseBlock(buffer);
      if (trailing) {
        options.onSseEvent?.({ id: trailing.id, event: trailing.event });
        for (const translated of this.translateCodexEvent(trailing.data)) {
          yield translated;
        }
      }
    } catch (error) {
      if (!options.signal?.aborted) {
        options.onSseError?.(error);
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private parseSseBlock(block: string): { id?: string; event?: string; data: unknown } | null {
    const data: string[] = [];
    let id: string | undefined;
    let event: string | undefined;
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon >= 0 ? line.slice(0, colon) : line;
      const value = colon >= 0 ? line.slice(colon + 1).replace(/^ /, '') : '';
      if (field === 'id') id = value;
      if (field === 'event') event = value;
      if (field === 'data') data.push(value);
    }
    if (data.length === 0) return null;
    try {
      return { id, event, data: JSON.parse(data.join('\n')) };
    } catch (error) {
      throw new Error(`Failed to parse Codex SSE event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private translateCodexEvent(raw: unknown): unknown[] {
    const frame = raw && typeof raw === 'object' ? raw as Record<string, any> : null;
    const method = typeof frame?.method === 'string' ? frame.method : '';
    const params = frame?.params && typeof frame.params === 'object' ? frame.params as Record<string, any> : {};
    const events: unknown[] = [];
    const push = (threadId: string | null, payload: Event, directory?: string | null) => {
      events.push({
        directory: directory || this.getDirectory() || 'global',
        payload,
        threadId,
        codexEvent: raw,
      });
    };

    if (method === 'thread/started' && params.thread) {
      const session = this.toSession(params.thread);
      push(session.id, {
        type: 'session.created',
        properties: { info: session },
      } as Event, session.directory as string | undefined);
      return events;
    }

    if (method === 'thread/name/updated' && typeof params.threadId === 'string') {
      push(params.threadId, {
        type: 'session.updated',
        properties: {
          info: {
            id: params.threadId,
            title: typeof params.name === 'string' ? params.name : undefined,
            time: { updated: Date.now() },
          },
        },
      } as Event);
      return events;
    }

    if (method === 'thread/deleted' && typeof params.threadId === 'string') {
      push(params.threadId, {
        type: 'session.deleted',
        properties: { sessionID: params.threadId },
      } as Event);
      return events;
    }

    if (method === 'thread/status/changed' && typeof params.threadId === 'string') {
      const status = this.toSessionStatus({ id: params.threadId, status: params.status })
        ?? { type: 'idle' };
      if (status.type === 'error') {
        this.pendingTurns.delete(params.threadId);
        this.activeTurns.delete(params.threadId);
        push(params.threadId, {
          type: 'session.status',
          properties: {
            sessionID: params.threadId,
            status,
          },
        } as Event);
        return events;
      }
      const statusType = status.type === 'busy' || this.activeTurns.has(params.threadId) || this.pendingTurns.has(params.threadId)
        ? 'busy'
        : status.type;
      push(params.threadId, {
        type: 'session.status',
        properties: {
          sessionID: params.threadId,
          status: { type: statusType },
        },
      } as Event);
      return events;
    }

    if (method === 'turn/started' && typeof params.threadId === 'string') {
      if (typeof params.turn?.id === 'string') {
        this.activeTurns.set(params.threadId, params.turn.id);
        const turnKey = this.toTurnKey(params.threadId, params.turn.id);
        this.turnItemOrders.set(turnKey, new Map());
        this.nextTurnItemOrder.set(turnKey, 0);
        if (!this.turnMessageIds.has(turnKey)) {
          this.turnMessageIds.set(turnKey, new Set());
        }
      }
      push(params.threadId, {
        type: 'session.status',
        properties: { sessionID: params.threadId, status: { type: 'busy' } },
      } as Event);
      return events;
    }

    if (method === 'turn/completed' && typeof params.threadId === 'string') {
      const completedTurnId = typeof params.turn?.id === 'string' ? params.turn.id : undefined;
      const records = this.toMessageRecords(params.threadId, params.turn);
      const authoritativeMessageIds = new Set(records.map((record) => record.info.id));
      const staleMessageIds = completedTurnId
        ? this.getUnconfirmedTurnMessageIds(params.threadId, completedTurnId, authoritativeMessageIds)
        : [];
      this.pendingTurns.delete(params.threadId);
      this.activeTurns.delete(params.threadId);
      push(params.threadId, {
        type: 'session.status',
        properties: { sessionID: params.threadId, status: { type: 'idle' } },
      } as Event);
      for (const messageID of staleMessageIds) {
        push(params.threadId, {
          type: 'message.removed',
          properties: { sessionID: params.threadId, messageID },
        } as Event);
      }
      for (const record of records) {
        push(params.threadId, {
          type: 'message.updated',
          properties: { info: record.info, parts: record.parts },
        } as Event);
      }
      if (completedTurnId) {
        this.clearTurnMessageTracking(params.threadId, completedTurnId);
      }
      return events;
    }

    if ((method === 'item/started' || method === 'item/completed') && typeof params.threadId === 'string' && params.item) {
      const turnId = typeof params.turnId === 'string' ? params.turnId : this.activeTurns.get(params.threadId);
      const messageId = this.toMessageIdForItem(params.threadId, turnId, params.item);
      const record = this.toMessageRecord(params.threadId, params.item, undefined, undefined, messageId);
      if (record) {
        this.rememberTurnMessageId(params.threadId, turnId, record.info.id);
        push(params.threadId, {
          type: 'message.updated',
          properties: { info: record.info, parts: record.parts },
        } as Event);
      }
      return events;
    }

    if ((method === 'item/agentMessage/delta' || method === 'item/plan/delta') && typeof params.threadId === 'string') {
      const itemId = typeof params.itemId === 'string' ? params.itemId : null;
      const delta = typeof params.delta === 'string' ? params.delta : '';
      if (itemId && delta) {
        const turnId = typeof params.turnId === 'string' ? params.turnId : this.activeTurns.get(params.threadId);
        const messageId = this.toMessageIdForEvent(params.threadId, turnId, itemId);
        this.rememberTurnMessageId(params.threadId, turnId, messageId);
        push(params.threadId, {
          type: 'message.part.delta',
          properties: {
            sessionID: params.threadId,
            messageID: messageId,
            partID: `${messageId}-text`,
            field: 'text',
            delta,
          },
        } as Event);
      }
      return events;
    }

    if ((method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') && typeof params.threadId === 'string') {
      const itemId = typeof params.itemId === 'string' ? params.itemId : null;
      const delta = typeof params.delta === 'string' ? params.delta : '';
      if (itemId && delta) {
        const turnId = typeof params.turnId === 'string' ? params.turnId : this.activeTurns.get(params.threadId);
        const messageId = this.toMessageIdForEvent(params.threadId, turnId, itemId);
        this.rememberTurnMessageId(params.threadId, turnId, messageId);
        push(params.threadId, {
          type: 'message.part.delta',
          properties: {
            sessionID: params.threadId,
            messageID: messageId,
            partID: `${messageId}-reasoning`,
            field: 'text',
            delta,
          },
        } as Event);
      }
      return events;
    }

    return events;
  }

  private toSession(thread: CodexThread): Session {
    const id = typeof thread.id === 'string' ? thread.id : `thread_${Date.now().toString(16)}`;
    const created = firstTimestamp(thread.createdAt, thread.timestamp, thread.updatedAt, thread.recencyAt) ?? Date.now();
    const updated = firstTimestamp(thread.updatedAt, thread.recencyAt);
    const directory = typeof thread.cwd === 'string'
      ? thread.cwd
      : typeof thread.path === 'string'
        ? thread.path
        : undefined;
    const title = typeof thread.name === 'string' && thread.name.trim()
      ? thread.name
      : typeof thread.preview === 'string' && thread.preview.trim()
        ? thread.preview
        : undefined;
    return {
      id,
      parentID: typeof thread.parentThreadId === 'string' ? thread.parentThreadId : undefined,
      title,
      directory,
      time: {
        created,
        updated,
        archived: thread.status === 'archived' ? updated ?? Date.now() : null,
      },
      metadata: {
        directory,
        codexThread: thread,
      },
      codexThread: thread,
    };
  }

  private readThreadStatusValue(thread: CodexThread): string | null {
    const status = thread.status;
    if (typeof status === 'string') return status;
    if (status && typeof status === 'object' && typeof status.type === 'string') return status.type;
    return null;
  }

  private isSystemErrorThread(thread: CodexThread): boolean {
    return this.readThreadStatusValue(thread) === 'systemError';
  }

  private toSessionStatus(thread: CodexThread): CompatSessionStatus | null {
    const status = this.readThreadStatusValue(thread);
    if (!status) return null;
    if (status === 'active' || status === 'running' || status === 'busy') {
      return { type: 'busy' };
    }
    if (status === 'systemError') {
      return { type: 'error', message: CODEX_SYSTEM_ERROR_MESSAGE };
    }
    return { type: 'idle' };
  }

  private shouldAppendSystemErrorMessage(records: CompatMessageRecord[], turns: CodexTurn[]): boolean {
    if (records.some((record) => record.info.role === 'assistant')) return false;
    return turns.some((turn) => (
      turn
      && typeof turn === 'object'
      && turn.status === 'completed'
      && Array.isArray(turn.items)
      && turn.items.some((item: CodexThreadItem) => item?.type === 'userMessage')
    ));
  }

  private async readThreadForStatus(id: string): Promise<CodexThread | null> {
    try {
      const response = await codexClient.readThread(id, { includeTurns: false });
      return extractObject(response, 'thread') as CodexThread | null;
    } catch {
      return null;
    }
  }

  private toSystemErrorMessageRecord(sessionId: string, turns: CodexTurn[]): CompatMessageRecord {
    const lastTurn = [...turns].reverse().find((turn) => turn && typeof turn === 'object') ?? null;
    const timeValue = firstTimestamp(lastTurn?.completedAt, lastTurn?.startedAt) ?? Date.now();
    const time = { created: timeValue, completed: timeValue };
    const id = `${sessionId}:codex-system-error`;
    return {
      info: {
        id,
        sessionID: sessionId,
        role: 'assistant',
        time,
        status: 'error',
        finish: 'error',
        error: {
          name: 'CodexSystemError',
          message: CODEX_SYSTEM_ERROR_MESSAGE,
        },
      },
      parts: [],
    };
  }

  private toMessageRecords(sessionId: string, turn: CodexTurn | null | undefined): CompatMessageRecord[] {
    if (!turn || typeof turn !== 'object') return [];
    const items = Array.isArray(turn.items) ? turn.items : [];
    const records: CompatMessageRecord[] = [];
    const turnId = typeof turn.id === 'string' ? turn.id : null;
    let parentUserMessageId: string | undefined;
    for (const [index, item] of items.entries()) {
      const itemId = typeof item?.id === 'string' ? item.id : null;
      const clientId = item?.type === 'userMessage' && typeof item.clientId === 'string' && item.clientId.trim()
        ? item.clientId
        : undefined;
      const messageId = clientId ?? (
        turnId && itemId
          ? this.toOrderedMessageId(sessionId, turnId, index, itemId)
          : undefined
      );
      const record = this.toMessageRecord(sessionId, item, turn, item?.type === 'userMessage' ? undefined : parentUserMessageId, messageId);
      if (record) records.push(record);
      if (item?.type === 'userMessage' && itemId) {
        parentUserMessageId = messageId ?? this.toCompatMessageId(sessionId, itemId);
      }
    }
    return records;
  }

  private toCompatMessageId(sessionId: string, itemId: string): string {
    return `${sessionId}:${itemId}`;
  }

  private toTurnKey(sessionId: string, turnId: string): string {
    return `${sessionId}:${turnId}`;
  }

  private toOrderedMessageId(sessionId: string, turnId: string, itemIndex: number, itemId: string): string {
    return `${sessionId}:${turnId}:${String(itemIndex).padStart(6, '0')}:${itemId}`;
  }

  private getOrAssignTurnItemOrder(sessionId: string, turnId: string, itemId: string): number {
    const turnKey = this.toTurnKey(sessionId, turnId);
    let orders = this.turnItemOrders.get(turnKey);
    if (!orders) {
      orders = new Map();
      this.turnItemOrders.set(turnKey, orders);
    }
    const existing = orders.get(itemId);
    if (typeof existing === 'number') return existing;
    const next = this.nextTurnItemOrder.get(turnKey) ?? orders.size;
    orders.set(itemId, next);
    this.nextTurnItemOrder.set(turnKey, next + 1);
    return next;
  }

  private rememberTurnMessageId(sessionId: string, turnId: string | undefined, messageId: string | undefined): void {
    if (!turnId || !messageId) return;
    const turnKey = this.toTurnKey(sessionId, turnId);
    let messageIds = this.turnMessageIds.get(turnKey);
    if (!messageIds) {
      messageIds = new Set();
      this.turnMessageIds.set(turnKey, messageIds);
    }
    messageIds.add(messageId);
  }

  private getUnconfirmedTurnMessageIds(sessionId: string, turnId: string, authoritativeMessageIds: ReadonlySet<string>): string[] {
    const turnKey = this.toTurnKey(sessionId, turnId);
    const messageIds = this.turnMessageIds.get(turnKey);
    if (!messageIds) return [];
    return [...messageIds].filter((messageId) => !authoritativeMessageIds.has(messageId));
  }

  private clearTurnMessageTracking(sessionId: string, turnId: string): void {
    const turnKey = this.toTurnKey(sessionId, turnId);
    this.turnMessageIds.delete(turnKey);
  }

  private toMessageIdForEvent(sessionId: string, turnId: string | undefined, itemId: string): string {
    if (!turnId) return this.toCompatMessageId(sessionId, itemId);
    const order = this.getOrAssignTurnItemOrder(sessionId, turnId, itemId);
    return this.toOrderedMessageId(sessionId, turnId, order, itemId);
  }

  private toMessageIdForItem(sessionId: string, turnId: string | undefined, item: CodexThreadItem): string | undefined {
    if (item.type === 'userMessage' && typeof item.clientId === 'string' && item.clientId.trim()) {
      return item.clientId;
    }
    if (turnId && typeof item.id === 'string') {
      return this.toMessageIdForEvent(sessionId, turnId, item.id);
    }
    return undefined;
  }

  private toCodexItemId(messageId: string): string {
    const parts = messageId.split(':');
    return parts[parts.length - 1] || messageId;
  }

  private toMessageTime(item: CodexThreadItem, turn?: CodexTurn | null): CompatMessageTime {
    const created = firstTimestamp(
      item.createdAt,
      item.startedAt,
      item.startedAtMs,
      item.completedAt,
      item.completedAtMs,
      turn?.startedAt,
      turn?.completedAt,
    ) ?? Date.now();
    const updated = firstTimestamp(
      item.updatedAt,
      item.completedAt,
      item.completedAtMs,
      turn?.completedAt,
    );
    const completed = firstTimestamp(
      item.completedAt,
      item.completedAtMs,
      turn?.completedAt,
    );
    return {
      created,
      ...(updated !== undefined ? { updated } : {}),
      ...(completed !== undefined ? { completed } : {}),
    };
  }

  private toMessageRecord(sessionId: string, item: CodexThreadItem, turn?: CodexTurn | null, parentID?: string, messageIdOverride?: string): CompatMessageRecord | null {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') return null;
    const messageId = messageIdOverride ?? this.toCompatMessageId(sessionId, item.id);
    const time = this.toMessageTime(item, turn);
    const assistantOptions = this.toAssistantMessageOptions(item, turn, parentID);
    if (item.type === 'userMessage') {
      return this.toUserMessageRecord(sessionId, messageId, Array.isArray(item.content) ? item.content : [], time);
    }
    if (item.type === 'agentMessage') {
      return this.toTextMessageRecord(sessionId, messageId, 'assistant', this.readTextContent(item), time, assistantOptions);
    }
    if (item.type === 'plan') {
      return this.toTextMessageRecord(sessionId, messageId, 'assistant', this.readTextContent(item), time, assistantOptions);
    }
    if (item.type === 'reasoning') {
      const text = [
        ...(Array.isArray(item.summary) ? item.summary : []),
        ...(Array.isArray(item.content) ? item.content : []),
      ].filter((value) => typeof value === 'string' && value.length > 0).join('\n');
      return {
        info: { id: messageId, sessionID: sessionId, role: 'assistant', time, ...assistantOptions },
        parts: [{ id: `${messageId}-reasoning`, messageID: messageId, type: 'reasoning', text, time: this.toPartTime(item, turn) }],
      };
    }
    return {
      info: { id: messageId, sessionID: sessionId, role: 'assistant', time, ...assistantOptions },
      parts: [this.toToolPart(messageId, item, turn)],
    };
  }

  private toPartTime(item: CodexThreadItem, turn?: CodexTurn | null): CompatPartTime {
    const start = firstTimestamp(
      item.startedAt,
      item.startedAtMs,
      item.createdAt,
      turn?.startedAt,
    );
    let end = firstTimestamp(
      item.completedAt,
      item.completedAtMs,
      turn?.completedAt,
    );
    const rawStatus = typeof item.status === 'string' ? item.status : '';
    const statusLooksFinal = rawStatus === 'completed'
      || rawStatus === 'failed'
      || rawStatus === 'declined'
      || rawStatus === 'cancelled'
      || rawStatus === 'canceled'
      || rawStatus === 'error'
      || rawStatus === 'errored'
      || turn?.status === 'completed'
      || turn?.status === 'failed';
    if (end === undefined && statusLooksFinal) {
      end = Date.now();
    }
    return {
      ...(start !== undefined ? { start } : {}),
      ...(end !== undefined ? { end } : {}),
    };
  }

  private toToolPart(messageId: string, item: CodexThreadItem, turn?: CodexTurn | null): Part {
    const time = this.toPartTime(item, turn);
    return {
      id: `${messageId}-tool`,
      messageID: messageId,
      type: 'tool',
      tool: this.toToolName(item),
      callID: item.id,
      state: {
        status: this.toToolStatus(item, turn, time),
        input: this.toToolInput(item),
        output: this.toToolOutput(item),
        time,
        metadata: this.toToolMetadata(item),
      },
    };
  }

  private toToolName(item: CodexThreadItem): string {
    if (item.type === 'commandExecution') return 'bash';
    if (item.type === 'fileChange') return 'apply_patch';
    if (item.type === 'mcpToolCall') return typeof item.tool === 'string' ? item.tool : 'mcp';
    if (item.type === 'dynamicToolCall') {
      if (typeof item.namespace === 'string' && item.namespace) return `${item.namespace}.${item.tool ?? 'tool'}`;
      return typeof item.tool === 'string' ? item.tool : 'tool';
    }
    if (item.type === 'webSearch') return 'web_search';
    if (item.type === 'imageView') return 'view_image';
    if (item.type === 'imageGeneration') return 'image_generation';
    if (item.type === 'sleep') return 'sleep';
    if (item.type === 'collabAgentToolCall') return typeof item.tool === 'string' ? item.tool : 'task';
    return typeof item.tool === 'string' ? item.tool : String(item.type ?? 'tool');
  }

  private toToolStatus(item: CodexThreadItem, turn: CodexTurn | null | undefined, time: CompatPartTime): string {
    const status = typeof item.status === 'string' ? item.status : '';
    if (status === 'inProgress' || status === 'started' || status === 'running') return 'running';
    if (status === 'pending') return 'pending';
    if (status === 'completed' || status === 'success') return 'completed';
    if (status === 'failed' || status === 'error' || status === 'errored') return 'failed';
    if (status === 'declined' || status === 'cancelled' || status === 'canceled' || status === 'aborted') return 'cancelled';
    if (turn?.status === 'completed' || typeof time.end === 'number') return 'completed';
    return 'running';
  }

  private toToolInput(item: CodexThreadItem): unknown {
    if (item.type === 'commandExecution') {
      return {
        command: item.command,
        cwd: item.cwd,
        source: item.source,
        actions: item.commandActions,
      };
    }
    if (item.type === 'fileChange') return { changes: item.changes };
    if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') return item.arguments;
    if (item.type === 'webSearch') return { query: item.query };
    if (item.type === 'sleep') return { durationMs: item.durationMs };
    if (item.type === 'imageView') return { path: item.path };
    if (item.type === 'imageGeneration') return { prompt: item.revisedPrompt };
    return item.arguments ?? item.command ?? item.changes ?? item.prompt ?? item.query ?? undefined;
  }

  private toToolOutput(item: CodexThreadItem): unknown {
    if (item.type === 'commandExecution') return item.aggregatedOutput;
    if (item.type === 'fileChange' && Array.isArray(item.changes)) {
      return item.changes.map((change: Record<string, unknown>) => {
        const path = typeof change.path === 'string' ? change.path : '';
        const kind = typeof change.kind === 'string' ? change.kind : 'changed';
        const diff = typeof change.diff === 'string' ? change.diff : '';
        return [path ? `${kind} ${path}` : kind, diff].filter(Boolean).join('\n');
      }).join('\n\n');
    }
    if (item.error) return item.error;
    if (item.result) return item.result;
    if (item.contentItems) return item.contentItems;
    if (item.action) return item.action;
    if (item.savedPath) return item.savedPath;
    return undefined;
  }

  private toToolMetadata(item: CodexThreadItem): Record<string, unknown> {
    if (item.type === 'fileChange' && Array.isArray(item.changes)) {
      return {
        ...item,
        files: item.changes
          .map((change: Record<string, unknown>) => change.path)
          .filter((path: unknown): path is string => typeof path === 'string' && path.length > 0),
      };
    }
    return item;
  }

  private toAssistantMessageOptions(item: CodexThreadItem, turn?: CodexTurn | null, parentID?: string): CompatMessageOptions {
    const isCompleted = turn?.status === 'completed'
      || item.status === 'completed'
      || item.phase === 'final_answer'
      || firstTimestamp(item.completedAt, item.completedAtMs, turn?.completedAt) !== undefined;
    return {
      ...(parentID ? { parentID } : {}),
      ...(isCompleted ? { status: 'completed', finish: 'stop' } : {}),
    };
  }

  private readTextContent(item: CodexThreadItem): string {
    if (typeof item.text === 'string') return item.text;
    if (Array.isArray(item.content)) {
      return item.content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
            return (part as { text: string }).text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    if (typeof item.content === 'string') return item.content;
    return '';
  }

  private toTextMessageRecord(sessionId: string, id: string, role: string, text: string, time: CompatMessageTime = { created: Date.now() }, options: CompatMessageOptions = {}): CompatMessageRecord {
    return {
      info: { id, sessionID: sessionId, role, time, ...options },
      parts: [{ id: `${id}-text`, messageID: id, type: 'text', text }],
    };
  }

  private toUserMessageRecord(sessionId: string, id: string, input: unknown[], time: CompatMessageTime = { created: Date.now() }): CompatMessageRecord {
    const parts = input
      .map((part, index): Part | null => {
        if (!part || typeof part !== 'object') return null;
        const record = part as Record<string, any>;
        if (record.type === 'text') {
          return {
            id: `${id}-text-${index}`,
            messageID: id,
            type: 'text',
            text: typeof record.text === 'string' ? record.text : '',
          };
        }
        if ((record.type === 'image' || record.type === 'localImage') && typeof (record.url ?? record.path) === 'string') {
          return {
            id: `${id}-file-${index}`,
            messageID: id,
            type: 'file',
            url: record.url ?? record.path,
            mime: 'image/*',
          };
        }
        return {
          id: `${id}-input-${index}`,
          messageID: id,
          type: String(record.type ?? 'input'),
          ...record,
        };
      })
      .filter((part): part is Part => Boolean(part));
    return {
      info: { id, sessionID: sessionId, role: 'user', time },
      parts,
    };
  }

  private extractThreadId(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') return record.id;
    if (typeof record.threadId === 'string') return record.threadId;
    const thread = record.thread;
    if (thread && typeof thread === 'object' && typeof (thread as { id?: unknown }).id === 'string') {
      return (thread as { id: string }).id;
    }
    return null;
  }
}

export const codexRuntimeClient = new CodexCompatClient();

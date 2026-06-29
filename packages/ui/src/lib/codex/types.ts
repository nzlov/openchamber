import type { PermissionRequest as LocalPermissionRequest } from '@/types/permission';
import type { QuestionRequest as LocalQuestionRequest } from '@/types/question';

/*
 * Transitional structural types for payloads that still flow through the
 * legacy session UI while the server is moving to Codex-native contracts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export type JsonRecord = Record<string, Loose>;

export type SdkResult<T = Loose> = {
  data?: T;
  error?: Loose;
  response?: {
    status?: number;
    headers?: Headers;
    [key: string]: Loose;
  };
};

export type SessionTime = {
  created?: number;
  updated?: number;
  archived?: number | null;
  [key: string]: Loose;
};

export type Session = {
  id: string;
  parentID?: Loose;
  title?: Loose;
  version?: string;
  time: SessionTime;
  metadata?: JsonRecord | null;
  revert?: { messageID?: string; partID?: string } | null;
  [key: string]: Loose;
};

export type TextPart = {
  id: Loose;
  type: Loose;
  text?: Loose;
  synthetic?: boolean;
  [key: string]: Loose;
};

export type ReasoningPart = {
  id: Loose;
  type: Loose;
  text?: Loose;
  synthetic?: boolean;
  [key: string]: Loose;
};

export type FilePart = {
  id: Loose;
  type: Loose;
  url?: Loose;
  mime?: Loose;
  filename?: Loose;
  synthetic?: boolean;
  [key: string]: Loose;
};

export type ToolState = {
  status?: Loose;
  input?: Loose;
  output?: Loose;
  metadata?: JsonRecord;
  title?: Loose;
  description?: Loose;
  [key: string]: Loose;
};

export type ToolPart = {
  id: Loose;
  type: Loose;
  tool?: Loose;
  callID?: Loose;
  state?: Loose;
  synthetic?: boolean;
  [key: string]: Loose;
};

export type Part = {
  id: Loose;
  type: Loose;
  text?: Loose;
  url?: Loose;
  mime?: Loose;
  filename?: Loose;
  tool?: Loose;
  callID?: Loose;
  messageID?: Loose;
  state?: Loose;
  synthetic?: Loose;
  [key: string]: Loose;
};

export type MessageInfo = {
  id: string;
  role?: Loose;
  sessionID?: string;
  time?: Loose;
  modelID?: string;
  providerID?: string;
  agent?: string;
  error?: Loose;
  [key: string]: Loose;
};

export type Message = {
  id: Loose;
  role?: Loose;
  sessionID?: Loose;
  time?: Loose;
  modelID?: Loose;
  providerID?: Loose;
  agent?: Loose;
  error?: Loose;
  [key: string]: Loose;
};

export type ModelRef = {
  providerID: string;
  modelID: string;
};

export type Model = {
  id: string;
  name: string;
  displayName?: string;
  providerID?: string;
  modelID?: string;
  cost?: JsonRecord | null;
  limit?: { context?: number; output?: number };
  [key: string]: Loose;
};

export type Provider = {
  id: string;
  name: string;
  models: Record<string, Model>;
  source?: string;
};

export type AgentMode = 'all' | 'primary' | 'subagent';

export type Agent = {
  name: string;
  description?: string;
  mode: AgentMode;
  model?: ModelRef;
  variant?: string;
  tools?: Record<string, boolean>;
  prompt?: string;
  temperature?: number;
  topP?: number;
  permission?: PermissionConfig | null;
  [key: string]: Loose;
};

export type Config = Loose;

export type Command = {
  name: string;
  description?: string;
  template?: string;
  [key: string]: Loose;
};

export type Path = {
  state: string;
  config: string;
  worktree: string;
  directory: string;
  home: string;
  [key: string]: Loose;
};

export type Project = {
  id: string;
  name?: string;
  path?: string;
  directory?: string;
  [key: string]: Loose;
};

export type ProviderListResponse = Loose;

export type ProviderAuthResponse = JsonRecord;

export type PermissionConfig = string | JsonRecord;
export type PermissionRequest = Loose | LocalPermissionRequest;
export type QuestionRequest = Loose | LocalQuestionRequest;

export type SessionStatus = Loose;

export type Todo = {
  id?: string;
  content: string;
  status: string;
  priority: string;
  [key: string]: Loose;
};

export type McpStatus = {
  name: string;
  status: string;
  error?: string;
  [key: string]: Loose;
};

export type LspStatus = {
  language: string;
  status: string;
  [key: string]: Loose;
};

export type VcsInfo = {
  branch?: string;
  root?: string;
  [key: string]: Loose;
};

export type Event = {
  type: string;
  properties?: JsonRecord;
  sessionID?: string;
  messageID?: string;
  partID?: string;
  [key: string]: Loose;
};

export type TextPartInput = {
  type: 'text';
  text: string;
  [key: string]: Loose;
};

export type FilePartInput = {
  type: 'file';
  url: string;
  mime?: string;
  filename?: string;
  [key: string]: Loose;
};

export type CodexRuntimeHealth = {
  status?: string;
  healthy?: boolean;
  running?: boolean;
  ready?: boolean;
  initialized?: boolean;
  cwd?: string;
  port?: number | null;
  pid?: number | null;
  binary?: string | null;
  error?: string | null;
  [key: string]: Loose;
};

export type CodexApprovalView = {
  id: string;
  requestId?: string;
  threadId?: string;
  turnId?: string;
  title?: string;
  message?: string;
  action?: string;
  payload?: Loose;
  [key: string]: Loose;
};

export type CodexEventFrame = {
  sequence: number;
  receivedAt: string;
  method: string;
  params: Loose;
  raw: Loose;
};

export type CodexThreadStartRequest = {
  cwd?: string;
  title?: string;
  input?: CodexTurnStartRequest['input'];
  [key: string]: Loose;
};

export type CodexTurnStartRequest = {
  input: Array<TextPartInput | FilePartInput | JsonRecord>;
  model?: string | ModelRef;
  agent?: string;
  cwd?: string;
  [key: string]: Loose;
};

type SdkMethod<T = Loose> = (...args: Loose[]) => Promise<SdkResult<T>>;

export type SessionMessageRecord = {
  info: MessageInfo;
  parts: Part[];
  [key: string]: Loose;
};

export type CodexRuntimeSdkClient = {
  app: {
    init?: SdkMethod;
    log?: SdkMethod;
    agents: SdkMethod<Agent[]>;
    skills: SdkMethod<JsonRecord[]>;
    [key: string]: Loose;
  };
  session: {
    create: SdkMethod<Session>;
    list: SdkMethod<Session[]>;
    get: SdkMethod<Session>;
    update: SdkMethod<Session>;
    delete: SdkMethod;
    messages: SdkMethod<SessionMessageRecord[]>;
    children: SdkMethod<Session[]>;
    init: SdkMethod;
    abort: SdkMethod;
    revert: SdkMethod<Session>;
    fork: SdkMethod<Session>;
    command: SdkMethod;
    prompt: SdkMethod<SessionMessageRecord>;
    status: SdkMethod<Record<string, SessionStatus>>;
    unrevert: SdkMethod<Session>;
    share: SdkMethod;
    unshare: SdkMethod;
    summarize: SdkMethod;
    todo: SdkMethod<Todo[]>;
    [key: string]: Loose;
  };
  config: {
    get: SdkMethod<Config>;
    providers: SdkMethod<ProviderListResponse>;
    update: SdkMethod<Config>;
    [key: string]: Loose;
  };
  provider: {
    list: SdkMethod<ProviderListResponse>;
    auth: SdkMethod<ProviderAuthResponse>;
    oauth: Loose;
    [key: string]: Loose;
  };
  auth: Loose;
  command: {
    list: SdkMethod<Command[]>;
    [key: string]: Loose;
  };
  project: {
    list: SdkMethod<Project[]>;
    current: SdkMethod<Project>;
    [key: string]: Loose;
  };
  path: {
    get: SdkMethod<Path>;
    [key: string]: Loose;
  };
  event: Loose;
  file: {
    read: SdkMethod;
    list: SdkMethod<JsonRecord[]>;
    [key: string]: Loose;
  };
  find: {
    files: SdkMethod<string[]>;
    [key: string]: Loose;
  };
  global: {
    config: {
      get: SdkMethod<Config>;
      [key: string]: Loose;
    };
    [key: string]: Loose;
  };
  mcp: {
    status: SdkMethod<Record<string, McpStatus>>;
    start: SdkMethod;
    callback: SdkMethod;
    remove: SdkMethod;
    [key: string]: Loose;
  };
  lsp: Record<string, SdkMethod<LspStatus[]>>;
  vcs: Record<string, SdkMethod<VcsInfo>>;
  question: {
    list: SdkMethod<QuestionRequest[]>;
    reply: SdkMethod<boolean>;
    reject: SdkMethod<boolean>;
    [key: string]: Loose;
  };
  permission: {
    list: SdkMethod<PermissionRequest[]>;
    reply: SdkMethod<boolean>;
    [key: string]: Loose;
  };
  experimental: {
    session: Record<string, SdkMethod<Session[]>>;
    [key: string]: Loose;
  };
  [key: string]: Loose;
};

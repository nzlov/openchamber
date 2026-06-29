import { describe, expect, mock, test } from 'bun:test';

(mock as unknown as { restore?: () => void }).restore?.();

const startTurnCalls: Array<{ threadId: string; body: Record<string, unknown> }> = [];
const shellCommandCalls: Array<{ threadId: string; body: Record<string, unknown> }> = [];
const rollbackCalls: Array<{ threadId: string; body: Record<string, unknown> }> = [];
const forkCalls: Array<{ threadId: string; body: Record<string, unknown> }> = [];
const compactCalls: string[] = [];
const loginAccountCalls: Array<Record<string, unknown>> = [];
const readThreadCalls: Array<{ threadId: string; query?: Record<string, unknown> }> = [];
let listThreadTurnsError: Error | null = null;

mock.module('@/contexts/runtimeAPIRegistry', () => ({
  getRegisteredRuntimeAPIs: mock(() => null),
}));

mock.module('@/lib/runtime-url', () => ({
  getRuntimeUrlResolver: mock(() => ({
    api: (path: string) => path,
  })),
}));

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async () => new Response(JSON.stringify({ config: {} }), {
    headers: { 'Content-Type': 'application/json' },
  })),
}));

mock.module('@/lib/codex/client', () => ({
  codexClient: {
    getHealth: mock(async () => ({ ready: false, running: false, initialized: false })),
    listThreads: mock(async () => ({
      data: [{
        id: 'thread_1',
        name: 'Thread one',
        cwd: '/workspace/project',
        createdAt: 10,
        updatedAt: 20,
      }],
      nextCursor: 'cursor:threads:2',
    })),
    readConfig: mock(async () => ({ model: 'gpt-5-codex' })),
    updateConfig: mock(async (value: Record<string, unknown>) => value),
    readThread: mock(async (threadId: string, query?: Record<string, unknown>) => {
      readThreadCalls.push({ threadId, query });
      return {
        thread: {
          id: threadId,
          name: 'Thread one',
          cwd: '/workspace/project',
          createdAt: 10,
          updatedAt: 20,
        },
      };
    }),
    startThread: mock(async (body: Record<string, unknown>) => ({
      thread: {
        id: 'thread_1',
        name: body.title,
        cwd: body.cwd,
        createdAt: 10,
      },
    })),
    updateThread: mock(async () => ({})),
    deleteThread: mock(async () => ({})),
    rollbackThread: mock(async (threadId: string, body: Record<string, unknown>) => {
      rollbackCalls.push({ threadId, body });
      return { thread: { id: threadId, name: 'Rolled back', cwd: '/workspace/project' } };
    }),
    forkThread: mock(async (threadId: string, body: Record<string, unknown>) => {
      forkCalls.push({ threadId, body });
      return { thread: { id: 'thread_fork', parentThreadId: threadId, cwd: body.cwd, createdAt: 30 } };
    }),
    compactThread: mock(async (threadId: string) => {
      compactCalls.push(threadId);
      return {};
    }),
    loginAccount: mock(async (body: Record<string, unknown>) => {
      loginAccountCalls.push(body);
      if (body.type === 'chatgpt') return { type: 'chatgpt', loginId: 'login_1', authUrl: 'https://auth.example/login' };
      return { type: 'apiKey' };
    }),
    readAccount: mock(async () => ({ account: { type: 'chatgpt', email: 'dev@example.test', planType: 'plus' } })),
    startTurn: mock(async (threadId: string, body: Record<string, unknown>) => {
      startTurnCalls.push({ threadId, body });
      return { turn: { id: 'turn_1', body } };
    }),
    shellCommand: mock(async (threadId: string, body: Record<string, unknown>) => {
      shellCommandCalls.push({ threadId, body });
      return { ok: true };
    }),
    listThreadTurns: mock(async () => {
      if (listThreadTurnsError) throw listThreadTurnsError;
      return {
        data: [{
          id: 'turn_1',
          status: 'completed',
          startedAt: 30,
          completedAt: 40,
          items: [
            { type: 'userMessage', id: 'item_user', content: [{ type: 'text', text: 'hello', text_elements: [] }] },
            { type: 'agentMessage', id: 'item_agent', text: 'hi', phase: null, memoryCitation: null },
          ],
        }],
        nextCursor: 'cursor:turns:2',
      };
    }),
    listSkills: mock(async () => []),
    listModels: mock(async () => ({ data: [] })),
  },
}));

const { codexRuntimeClient } = await import(`./runtime-client?facade-test=${Date.now()}`);

describe('Codex runtime client migration facade', () => {
  test('maps UI send options into Codex turn input', async () => {
    startTurnCalls.length = 0;

    const record = await codexRuntimeClient.sendMessage({
      sessionID: 'thread_1',
      text: 'hello',
      directory: '/workspace/project',
      modelID: 'gpt-5-codex',
      messageId: 'msg_1',
      files: [{ type: 'file', mime: 'image/png', url: 'file:///workspace/project/screenshot.png', filename: 'screenshot.png' }],
      additionalParts: [{ text: 'extra context', synthetic: true }],
    });

    expect(record.info.role).toBe('user');
    expect(startTurnCalls).toHaveLength(1);
    expect(startTurnCalls[0]).toEqual({
      threadId: 'thread_1',
      body: {
        input: [
          { type: 'text', text: 'hello', text_elements: [] },
          { type: 'text', text: 'extra context', text_elements: [] },
          { type: 'localImage', path: '/workspace/project/screenshot.png' },
        ],
        cwd: '/workspace/project',
        model: 'gpt-5-codex',
        clientUserMessageId: 'msg_1',
      },
    });
  });

  test('does not require the removed Codex SDK for basic config and health calls', async () => {
    const sdk = codexRuntimeClient.getSdkClient();

    expect(await codexRuntimeClient.getConfig('/workspace/project')).toEqual({ model: 'gpt-5-codex' });
    expect((await sdk.global.config.get()).data).toEqual({ model: 'gpt-5-codex' });
    expect(await codexRuntimeClient.checkHealth()).toBe(true);
  });

  test('maps Codex threads and turn items into the legacy UI facade shape', async () => {
    const sdk = codexRuntimeClient.getSdkClient();
    readThreadCalls.length = 0;
    listThreadTurnsError = null;

    const sessions = await sdk.session.list({ directory: '/workspace/project' });
    expect(sessions.data?.[0]?.id).toBe('thread_1');
    expect(sessions.data?.[0]?.title).toBe('Thread one');
    expect(sessions.data?.[0]?.time.created).toBe(10_000);
    expect(sessions.response?.headers?.get('x-next-cursor')).toBe('cursor:threads:2');

    const session = await sdk.session.get({ sessionID: 'thread_1', directory: '/workspace/project' });
    expect(session.data?.id).toBe('thread_1');
    expect(readThreadCalls).toEqual([
      { threadId: 'thread_1', query: { includeTurns: false } },
    ]);

    const messages = await sdk.session.messages({ sessionID: 'thread_1', limit: 20 });
    expect(messages.data?.map((record: { info: { role?: string } }) => record.info.role)).toEqual(['user', 'assistant']);
    expect(messages.data?.map((record: { info: { id?: string } }) => record.info.id)).toEqual(['thread_1:item_user', 'thread_1:item_agent']);
    expect(messages.data?.map((record: { info: { time?: { created?: number } } }) => record.info.time?.created)).toEqual([30_000, 30_000]);
    expect(messages.data?.[1]?.info.parentID).toBe('thread_1:item_user');
    expect(messages.data?.[1]?.info.status).toBe('completed');
    expect(messages.data?.[1]?.info.finish).toBe('stop');
    expect(messages.data?.[1]?.info.time?.completed).toBe(40_000);
    expect(messages.data?.[1]?.parts[0]?.messageID).toBe('thread_1:item_agent');
    expect(messages.data?.[1]?.parts[0]?.text).toBe('hi');
    expect(messages.response?.headers?.get('x-next-cursor')).toBe('cursor:turns:2');

    const otherMessages = await sdk.session.messages({ sessionID: 'thread_2', limit: 20 });
    expect(otherMessages.data?.map((record: { info: { id?: string } }) => record.info.id)).toEqual(['thread_2:item_user', 'thread_2:item_agent']);
    expect(otherMessages.data?.[1]?.parts[0]?.messageID).toBe('thread_2:item_agent');
  });

  test('treats unmaterialized or empty Codex thread history as an empty message page', async () => {
    const sdk = codexRuntimeClient.getSdkClient();
    listThreadTurnsError = new Error('thread/turns/list failed: failed to load thread history for thread thread_1: thread-store internal error: failed to read thread /home/user/.codex/sessions/rollout.jsonl: rollout at /home/user/.codex/sessions/rollout.jsonl is empty (-32603)');

    const messages = await sdk.session.messages({ sessionID: 'thread_1', limit: 20 });
    expect(messages.data).toEqual([]);
    expect(messages.response?.headers?.get('x-next-cursor')).toBe(undefined);

    listThreadTurnsError = new Error('thread/read failed: thread thread_1 is not materialized yet; includeTurns is unavailable before first user message (-32600)');
    const messagesBeforeFirstUserInput = await sdk.session.messages({ sessionID: 'thread_1', limit: 20 });
    expect(messagesBeforeFirstUserInput.data).toEqual([]);

    listThreadTurnsError = new Error('thread/turns/list failed: thread thread_1 is not materialized yet; thread/turns/list is unavailable before first user message (-32600)');
    const turnsBeforeFirstUserInput = await sdk.session.messages({ sessionID: 'thread_1', limit: 20 });
    expect(turnsBeforeFirstUserInput.data).toEqual([]);

    listThreadTurnsError = null;
  });

  test('sends Codex turns with array input and honors directory overrides', async () => {
    startTurnCalls.length = 0;
    const created = await codexRuntimeClient.createSession({ title: 'New', directory: '/tmp/a' }, '/tmp/b');
    expect(created.directory).toBe('/tmp/a');

    const record = await codexRuntimeClient.sendMessage({
      sessionID: 'thread_1',
      text: 'hello',
      directory: '/workspace/project',
    });
    expect(record.info.role).toBe('user');
    expect(record.parts[0]?.text).toBe('hello');
    expect(startTurnCalls[0].body.cwd).toBe('/workspace/project');
  });

  test('maps slash skill and shell sends onto Codex-native calls', async () => {
    startTurnCalls.length = 0;
    shellCommandCalls.length = 0;

    await codexRuntimeClient.sendCommand({
      id: 'thread_1',
      command: 'review',
      arguments: 'focus on auth',
      skillPath: '/skills/review/SKILL.md',
    });
    await codexRuntimeClient.shellSession({
      sessionId: 'thread_1',
      command: 'pwd',
    });

    expect(startTurnCalls[0].body.input).toEqual([
      { type: 'skill', name: 'review', path: '/skills/review/SKILL.md' },
      { type: 'text', text: 'focus on auth', text_elements: [] },
    ]);
    expect(shellCommandCalls).toEqual([
      { threadId: 'thread_1', body: { command: 'pwd' } },
    ]);
  });

  test('maps revert, fork, and compact actions onto Codex-native thread calls', async () => {
    rollbackCalls.length = 0;
    forkCalls.length = 0;
    compactCalls.length = 0;

    const reverted = await codexRuntimeClient.revertSession('thread_1', 'item_user', undefined, '/workspace/project');
    const forked = await codexRuntimeClient.forkSession('thread_1', 'item_user', '/workspace/project');
    await codexRuntimeClient.summarizeSession('thread_1');

    expect(rollbackCalls).toEqual([
      { threadId: 'thread_1', body: { numTurns: 1 } },
    ]);
    expect(reverted.revert).toEqual({ messageID: 'item_user' });
    expect(forkCalls).toEqual([
      { threadId: 'thread_1', body: { cwd: '/workspace/project', excludeTurns: true } },
    ]);
    expect(forked.id).toBe('thread_fork');
    expect(compactCalls).toEqual(['thread_1']);
  });

  test('maps provider auth compatibility calls onto Codex account login', async () => {
    loginAccountCalls.length = 0;
    const sdk = codexRuntimeClient.getSdkClient();

    const authMethods = await sdk.provider.auth();
    const apiKeyResult = await sdk.auth.set({
      providerID: 'openai',
      auth: { type: 'api', key: 'sk-test' },
    });
    const oauthStart = await sdk.provider.oauth.authorize({
      providerID: 'openai',
      method: 0,
    });
    const oauthComplete = await sdk.provider.oauth.callback({
      providerID: 'openai',
      method: 0,
    });

    expect(authMethods.data?.openai?.[0]?.type).toBe('oauth');
    expect(apiKeyResult.data).toEqual({ type: 'apiKey' });
    expect(oauthStart.data?.url).toBe('https://auth.example/login');
    expect(oauthComplete.data?.account?.type).toBe('chatgpt');
    expect(loginAccountCalls).toEqual([
      { type: 'apiKey', apiKey: 'sk-test' },
      { type: 'chatgpt', codexStreamlinedLogin: true },
    ]);
  });
});

import { describe, expect, mock, test } from 'bun:test';

(mock as unknown as { restore?: () => void }).restore?.();

const startTurnCalls: Array<{ threadId: string; body: Record<string, unknown> }> = [];
const shellCommandCalls: Array<{ threadId: string; body: Record<string, unknown> }> = [];
const rollbackCalls: Array<{ threadId: string; body: Record<string, unknown> }> = [];
const forkCalls: Array<{ threadId: string; body: Record<string, unknown> }> = [];
const interruptTurnCalls: Array<{ threadId: string; turnId: string }> = [];
const compactCalls: string[] = [];
const loginAccountCalls: Array<Record<string, unknown>> = [];
const listThreadsCalls: Array<Record<string, unknown>> = [];
const readThreadCalls: Array<{ threadId: string; query?: Record<string, unknown> }> = [];
let listThreadsResponse: Record<string, unknown> | null = null;
let readThreadResponse: Record<string, unknown> | null = null;
const readThreadResponses = new Map<string, Record<string, unknown>>();
const readThreadErrors = new Map<string, Error>();
let listThreadTurnsError: Error | null = null;
let listThreadTurnsResponse: Record<string, unknown> | null = null;
let startTurnDeferred: { promise: Promise<Record<string, unknown>>; resolve: (value: Record<string, unknown>) => void } | null = null;

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
    listThreads: mock(async (query: Record<string, unknown> = {}) => {
      listThreadsCalls.push(query);
      return listThreadsResponse ?? ({
      data: [{
        id: 'thread_1',
        name: 'Thread one',
        cwd: '/workspace/project',
        createdAt: 10,
        updatedAt: 20,
      }],
      nextCursor: 'cursor:threads:2',
      });
    }),
    readConfig: mock(async () => ({ model: 'gpt-5-codex' })),
    updateConfig: mock(async (value: Record<string, unknown>) => value),
    readThread: mock(async (threadId: string, query?: Record<string, unknown>) => {
      readThreadCalls.push({ threadId, query });
      const keyedError = readThreadErrors.get(threadId);
      if (keyedError) throw keyedError;
      const keyedResponse = readThreadResponses.get(threadId);
      if (keyedResponse) return keyedResponse;
      return readThreadResponse ?? {
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
      if (startTurnDeferred) return await startTurnDeferred.promise;
      return { turn: { id: 'turn_1', body } };
    }),
    interruptTurn: mock(async (threadId: string, turnId: string) => {
      interruptTurnCalls.push({ threadId, turnId });
      return {};
    }),
    shellCommand: mock(async (threadId: string, body: Record<string, unknown>) => {
      shellCommandCalls.push({ threadId, body });
      return { ok: true };
    }),
    listThreadTurns: mock(async () => {
      if (listThreadTurnsError) throw listThreadTurnsError;
      if (listThreadTurnsResponse) return listThreadTurnsResponse;
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
    listThreadsResponse = null;
    readThreadResponse = null;
    readThreadCalls.length = 0;
    listThreadTurnsError = null;
    listThreadTurnsResponse = null;

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
    expect(messages.data?.map((record: { info: { id?: string } }) => record.info.id)).toEqual(['thread_1:turn_1:000000:item_user', 'thread_1:turn_1:000001:item_agent']);
    expect(messages.data?.map((record: { info: { time?: { created?: number } } }) => record.info.time?.created)).toEqual([30_000, 30_000]);
    expect(messages.data?.[1]?.info.parentID).toBe('thread_1:turn_1:000000:item_user');
    expect(messages.data?.[1]?.info.status).toBe('completed');
    expect(messages.data?.[1]?.info.finish).toBe('stop');
    expect(messages.data?.[1]?.info.time?.completed).toBe(40_000);
    expect(messages.data?.[1]?.parts[0]?.messageID).toBe('thread_1:turn_1:000001:item_agent');
    expect(messages.data?.[1]?.parts[0]?.text).toBe('hi');
    expect(messages.response?.headers?.get('x-next-cursor')).toBe('cursor:turns:2');

    const otherMessages = await sdk.session.messages({ sessionID: 'thread_2', limit: 20 });
    expect(otherMessages.data?.map((record: { info: { id?: string } }) => record.info.id)).toEqual(['thread_2:turn_1:000000:item_user', 'thread_2:turn_1:000001:item_agent']);
    expect(otherMessages.data?.[1]?.parts[0]?.messageID).toBe('thread_2:turn_1:000001:item_agent');
  });

  test('maps Codex system-error threads into status snapshots', async () => {
    listThreadsCalls.length = 0;
    readThreadCalls.length = 0;
    listThreadsResponse = {
      data: [
        { id: 'thread_busy', status: { type: 'active' }, cwd: '/workspace/project' },
        { id: 'thread_error', status: { type: 'systemError' }, cwd: '/workspace/project' },
        { id: 'thread_idle', status: { type: 'idle' }, cwd: '/workspace/project' },
      ],
      nextCursor: null,
    };

    const statuses = await codexRuntimeClient.getSessionStatusForDirectory('/workspace/project');

    expect(statuses).toEqual({
      thread_busy: { type: 'busy' },
      thread_error: {
        type: 'error',
        message: 'Codex runtime reported a system error before producing an assistant response.',
      },
    });
    expect(listThreadsCalls).toEqual([{ archived: false, cwd: '/workspace/project', limit: 200 }]);
    expect(readThreadCalls).toEqual([]);

    listThreadsResponse = null;
  });

  test('reads candidate threads directly for status resync snapshots', async () => {
    listThreadsCalls.length = 0;
    readThreadCalls.length = 0;
    readThreadResponses.set('thread_old_error', {
      thread: {
        id: 'thread_old_error',
        status: { type: 'systemError' },
        cwd: '/workspace/project',
      },
    });

    const statuses = await codexRuntimeClient.getSessionStatusForDirectory('/workspace/project', ['thread_old_error']);

    expect(statuses).toEqual({
      thread_old_error: {
        type: 'error',
        message: 'Codex runtime reported a system error before producing an assistant response.',
      },
    });
    expect(listThreadsCalls).toEqual([]);
    expect(readThreadCalls).toEqual([
      { threadId: 'thread_old_error', query: { includeTurns: false } },
    ]);

    readThreadResponses.clear();
  });

  test('returns null when a candidate thread status fetch fails', async () => {
    listThreadsCalls.length = 0;
    readThreadCalls.length = 0;
    readThreadErrors.set('thread_unavailable', new Error('thread not loaded'));

    const statuses = await codexRuntimeClient.getSessionStatusForDirectory('/workspace/project', ['thread_unavailable']);

    expect(statuses).toBe(null);
    expect(listThreadsCalls).toEqual([]);
    expect(readThreadCalls).toEqual([
      { threadId: 'thread_unavailable', query: { includeTurns: false } },
    ]);

    readThreadErrors.clear();
  });

  test('adds a visible assistant error when Codex finishes a system-error turn without assistant output', async () => {
    const sdk = codexRuntimeClient.getSdkClient();
    readThreadResponse = {
      thread: {
        id: 'thread_system_error',
        status: { type: 'systemError' },
        cwd: '/workspace/project',
        createdAt: 10,
        updatedAt: 20,
      },
    };
    listThreadTurnsError = null;
    listThreadTurnsResponse = {
      data: [{
        id: 'turn_system_error',
        status: 'completed',
        startedAt: 30,
        completedAt: 40,
        items: [
          { type: 'userMessage', id: 'item_user', clientId: 'msg_system_error', content: [{ type: 'text', text: 'hello', text_elements: [] }] },
        ],
      }],
      nextCursor: null,
    };

    const messages = await sdk.session.messages({ sessionID: 'thread_system_error', limit: 20 });

    expect(messages.data?.map((record: { info: { role?: string } }) => record.info.role)).toEqual(['user', 'assistant']);
    const errorInfo = messages.data?.[1]?.info as {
      id?: string;
      sessionID?: string;
      role?: string;
      status?: string;
      finish?: string;
      error?: unknown;
    } | undefined;
    expect({
      id: errorInfo?.id,
      sessionID: errorInfo?.sessionID,
      role: errorInfo?.role,
      status: errorInfo?.status,
      finish: errorInfo?.finish,
      error: errorInfo?.error,
    }).toEqual({
      id: 'thread_system_error:codex-system-error',
      sessionID: 'thread_system_error',
      role: 'assistant',
      status: 'error',
      finish: 'error',
      error: {
        name: 'CodexSystemError',
        message: 'Codex runtime reported a system error before producing an assistant response.',
      },
    });
    expect(messages.data?.[1]?.parts).toEqual([]);

    readThreadResponse = null;
    listThreadTurnsResponse = null;
  });

  test('uses Codex user message client ids to reconcile optimistic sends', async () => {
    const sdk = codexRuntimeClient.getSdkClient();
    listThreadTurnsError = null;
    listThreadTurnsResponse = {
      data: [{
        id: 'turn_client',
        status: 'completed',
        startedAt: 30,
        completedAt: 40,
        items: [
          { type: 'userMessage', id: 'item_user', clientId: 'msg_client_1', content: [{ type: 'text', text: 'hello', text_elements: [] }] },
          { type: 'agentMessage', id: 'item_agent', text: 'hi', phase: 'final_answer', memoryCitation: null },
        ],
      }],
      nextCursor: null,
    };

    const messages = await sdk.session.messages({ sessionID: 'thread_1', limit: 20 });

    expect(messages.data?.map((record: { info: { id?: string } }) => record.info.id)).toEqual([
      'msg_client_1',
      'thread_1:turn_client:000001:item_agent',
    ]);
    expect(messages.data?.[1]?.info.parentID).toBe('msg_client_1');
    expect(messages.data?.[0]?.parts[0]?.messageID).toBe('msg_client_1');

    listThreadTurnsResponse = null;
  });

  test('maps Codex tool and reasoning items into renderable message parts', async () => {
    const sdk = codexRuntimeClient.getSdkClient();
    listThreadTurnsError = null;
    listThreadTurnsResponse = {
      data: [{
        id: 'turn_tools',
        status: 'completed',
        startedAt: 50,
        completedAt: 60,
        items: [
          { type: 'userMessage', id: 'item_user_tools', content: [{ type: 'text', text: 'inspect', text_elements: [] }] },
          { type: 'reasoning', id: 'item_reasoning', summary: ['checking files'], content: ['need command output'] },
          {
            type: 'commandExecution',
            id: 'item_command',
            command: 'pwd',
            cwd: '/workspace/project',
            processId: null,
            source: 'agent',
            status: 'completed',
            commandActions: [],
            aggregatedOutput: '/workspace/project',
            exitCode: 0,
            durationMs: 12,
          },
          {
            type: 'fileChange',
            id: 'item_patch',
            changes: [{ path: '/workspace/project/a.ts', kind: 'update', diff: '--- a.ts\n+++ a.ts' }],
            status: 'completed',
          },
          {
            type: 'mcpToolCall',
            id: 'item_mcp',
            server: 'browser',
            tool: 'open',
            status: 'inProgress',
            arguments: { url: 'https://example.test' },
            appContext: null,
            pluginId: null,
            result: null,
            error: null,
            durationMs: null,
          },
          {
            type: 'dynamicToolCall',
            id: 'item_dynamic',
            namespace: 'image_gen',
            tool: 'imagegen',
            arguments: { prompt: 'logo' },
            status: 'failed',
            contentItems: null,
            success: false,
            durationMs: 3,
          },
        ],
      }],
      nextCursor: null,
    };

    const messages = await sdk.session.messages({ sessionID: 'thread_1', limit: 20 });
    expect(messages.data?.map((record: { info: { id?: string } }) => record.info.id)).toEqual([
      'thread_1:turn_tools:000000:item_user_tools',
      'thread_1:turn_tools:000001:item_reasoning',
      'thread_1:turn_tools:000002:item_command',
      'thread_1:turn_tools:000003:item_patch',
      'thread_1:turn_tools:000004:item_mcp',
      'thread_1:turn_tools:000005:item_dynamic',
    ]);

    const reasoning = messages.data?.[1]?.parts[0];
    expect(reasoning?.id).toBe('thread_1:turn_tools:000001:item_reasoning-reasoning');
    expect(reasoning?.messageID).toBe('thread_1:turn_tools:000001:item_reasoning');
    expect(reasoning?.type).toBe('reasoning');
    expect(reasoning?.text).toBe('checking files\nneed command output');
    expect(reasoning?.time).toEqual({ start: 50_000, end: 60_000 });

    const command = messages.data?.[2]?.parts[0];
    expect(command?.type).toBe('tool');
    expect(command?.tool).toBe('bash');
    expect(command?.callID).toBe('item_command');
    expect(command?.state?.status).toBe('completed');
    expect(command?.state?.input).toEqual({ command: 'pwd', cwd: '/workspace/project', source: 'agent', actions: [] });
    expect(command?.state?.output).toBe('/workspace/project');
    expect(command?.state?.time).toEqual({ start: 50_000, end: 60_000 });

    const patch = messages.data?.[3]?.parts[0];
    expect(patch?.tool).toBe('apply_patch');
    expect(patch?.state?.status).toBe('completed');
    expect(patch?.state?.time?.end).toBe(60_000);
    expect(patch?.state?.metadata?.files).toEqual(['/workspace/project/a.ts']);

    const mcp = messages.data?.[4]?.parts[0];
    expect(mcp?.type).toBe('tool');
    expect(mcp?.tool).toBe('open');
    expect(mcp?.state?.status).toBe('running');
    expect(mcp?.state?.input).toEqual({ url: 'https://example.test' });

    const dynamic = messages.data?.[5]?.parts[0];
    expect(dynamic?.type).toBe('tool');
    expect(dynamic?.tool).toBe('image_gen.imagegen');
    expect(dynamic?.state?.status).toBe('failed');
    expect(dynamic?.state?.input).toEqual({ prompt: 'logo' });

    listThreadTurnsResponse = null;
  });

  test('keeps Codex item message ids sortable in turn item order', async () => {
    const sdk = codexRuntimeClient.getSdkClient();
    listThreadTurnsError = null;
    listThreadTurnsResponse = {
      data: [{
        id: 'turn_order',
        status: 'completed',
        startedAt: 70,
        completedAt: 80,
        items: [
          { type: 'userMessage', id: 'item-1', content: [{ type: 'text', text: 'start', text_elements: [] }] },
          { type: 'agentMessage', id: 'item-2', text: 'two', phase: 'commentary', memoryCitation: null },
          { type: 'agentMessage', id: 'item-10', text: 'ten', phase: 'commentary', memoryCitation: null },
          { type: 'fileChange', id: 'call_patch', changes: [], status: 'completed' },
          { type: 'agentMessage', id: 'item-11', text: 'eleven', phase: 'final_answer', memoryCitation: null },
        ],
      }],
      nextCursor: null,
    };

    const messages = await sdk.session.messages({ sessionID: 'thread_1', limit: 20 });
    expect(messages.data?.map((record: { info: { id?: string } }) => record.info.id)).toEqual([
      'thread_1:turn_order:000000:item-1',
      'thread_1:turn_order:000001:item-2',
      'thread_1:turn_order:000002:item-10',
      'thread_1:turn_order:000003:call_patch',
      'thread_1:turn_order:000004:item-11',
    ]);
    expect(messages.data?.map((record: { parts?: Array<{ text?: string; tool?: string }> }) => record.parts?.[0]?.text ?? record.parts?.[0]?.tool)).toEqual([
      'start',
      'two',
      'ten',
      'apply_patch',
      'eleven',
    ]);

    listThreadTurnsResponse = null;
  });

  test('maps Codex reasoning deltas onto reasoning text parts', () => {
    const events = (codexRuntimeClient as unknown as {
      translateCodexEvent: (event: unknown) => Array<{ payload: { type: string; properties: Record<string, unknown> } }>;
    }).translateCodexEvent({
      method: 'item/reasoning/textDelta',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'item_reasoning',
        delta: 'thinking...',
        contentIndex: 0,
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      type: 'message.part.delta',
      properties: {
        sessionID: 'thread_1',
        messageID: 'thread_1:turn_1:000000:item_reasoning',
        partID: 'thread_1:turn_1:000000:item_reasoning-reasoning',
        field: 'text',
        delta: 'thinking...',
      },
    });
  });

  test('includes session id on Codex assistant deltas so first streaming events route to the session store', () => {
    const events = (codexRuntimeClient as unknown as {
      translateCodexEvent: (event: unknown) => Array<{ payload: { type: string; properties: Record<string, unknown> } }>;
    }).translateCodexEvent({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread_agent',
        turnId: 'turn_1',
        itemId: 'item_agent',
        delta: 'hello',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      type: 'message.part.delta',
      properties: {
        sessionID: 'thread_agent',
        messageID: 'thread_agent:turn_1:000000:item_agent',
        partID: 'thread_agent:turn_1:000000:item_agent-text',
        field: 'text',
        delta: 'hello',
      },
    });
  });

  test('removes live assistant message ids that are replaced by completed turn items', () => {
    const translate = (event: unknown) => (codexRuntimeClient as unknown as {
      translateCodexEvent: (event: unknown) => Array<{ payload: { type: string; properties: Record<string, unknown> } }>;
    }).translateCodexEvent(event);

    translate({
      method: 'turn/started',
      params: {
        threadId: 'thread_reconcile',
        turn: { id: 'turn_reconcile' },
      },
    });
    translate({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread_reconcile',
        turnId: 'turn_reconcile',
        itemId: 'msg_tmp_assistant',
        delta: 'final text',
      },
    });

    const events = translate({
      method: 'turn/completed',
      params: {
        threadId: 'thread_reconcile',
        turn: {
          id: 'turn_reconcile',
          items: [
            {
              type: 'userMessage',
              id: 'item_user',
              clientId: 'msg_user_client',
              content: [{ type: 'text', text: 'question', text_elements: [] }],
            },
            {
              type: 'agentMessage',
              id: 'item-15',
              text: 'final text',
            },
          ],
          status: 'completed',
          startedAt: 1,
          completedAt: 2,
        },
      },
    });

    expect(events.map((event) => event.payload.type)).toEqual([
      'session.status',
      'message.removed',
      'message.updated',
      'message.updated',
    ]);
    expect(events[1]?.payload.properties).toEqual({
      sessionID: 'thread_reconcile',
      messageID: 'thread_reconcile:turn_reconcile:000000:msg_tmp_assistant',
    });
    expect((events[3]?.payload.properties.info as { id?: string }).id).toBe(
      'thread_reconcile:turn_reconcile:000001:item-15'
    );
  });

  test('keeps completed turn item ordering stable for late item lifecycle events', () => {
    const translate = (event: unknown) => (codexRuntimeClient as unknown as {
      translateCodexEvent: (event: unknown) => Array<{ payload: { type: string; properties: Record<string, unknown> } }>;
    }).translateCodexEvent(event);

    translate({
      method: 'turn/started',
      params: {
        threadId: 'thread_late_item',
        turn: { id: 'turn_late_item' },
      },
    });
    translate({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread_late_item',
        turnId: 'turn_late_item',
        itemId: 'msg_tmp_assistant',
        delta: 'final text',
      },
    });
    translate({
      method: 'turn/completed',
      params: {
        threadId: 'thread_late_item',
        turn: {
          id: 'turn_late_item',
          items: [
            {
              type: 'userMessage',
              id: 'item_user',
              clientId: 'msg_user_client',
              content: [{ type: 'text', text: 'question', text_elements: [] }],
            },
            {
              type: 'agentMessage',
              id: 'item-15',
              text: 'final text',
            },
          ],
          status: 'completed',
          startedAt: 1,
          completedAt: 2,
        },
      },
    });

    const events = translate({
      method: 'item/completed',
      params: {
        threadId: 'thread_late_item',
        turnId: 'turn_late_item',
        item: {
          type: 'agentMessage',
          id: 'item-15',
          text: 'final text',
        },
      },
    });

    expect(events).toHaveLength(1);
    expect((events[0]?.payload.properties.info as { id?: string }).id).toBe(
      'thread_late_item:turn_late_item:000001:item-15'
    );
  });

  test('does not forget live message ids when turn started arrives after a delta', () => {
    const translate = (event: unknown) => (codexRuntimeClient as unknown as {
      translateCodexEvent: (event: unknown) => Array<{ payload: { type: string; properties: Record<string, unknown> } }>;
    }).translateCodexEvent(event);

    translate({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread_out_of_order',
        turnId: 'turn_out_of_order',
        itemId: 'msg_tmp_assistant',
        delta: 'final text',
      },
    });
    translate({
      method: 'turn/started',
      params: {
        threadId: 'thread_out_of_order',
        turn: { id: 'turn_out_of_order' },
      },
    });

    const events = translate({
      method: 'turn/completed',
      params: {
        threadId: 'thread_out_of_order',
        turn: {
          id: 'turn_out_of_order',
          items: [
            {
              type: 'userMessage',
              id: 'item_user',
              clientId: 'msg_user_client',
              content: [{ type: 'text', text: 'question', text_elements: [] }],
            },
            {
              type: 'agentMessage',
              id: 'item-15',
              text: 'final text',
            },
          ],
          status: 'completed',
          startedAt: 1,
          completedAt: 2,
        },
      },
    });

    expect(events[1]?.payload).toEqual({
      type: 'message.removed',
      properties: {
        sessionID: 'thread_out_of_order',
        messageID: 'thread_out_of_order:turn_out_of_order:000000:msg_tmp_assistant',
      },
    });
  });

  test('keeps status busy when Codex reports thread idle before the active turn completes', () => {
    const translate = (event: unknown) => (codexRuntimeClient as unknown as {
      translateCodexEvent: (event: unknown) => Array<{ payload: { type: string; properties: Record<string, unknown> } }>;
    }).translateCodexEvent(event);

    translate({
      method: 'turn/started',
      params: {
        threadId: 'thread_status_race',
        turn: { id: 'turn_status_race' },
      },
    });
    const events = translate({
      method: 'thread/status/changed',
      params: {
        threadId: 'thread_status_race',
        status: 'idle',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      type: 'session.status',
      properties: {
        sessionID: 'thread_status_race',
        status: { type: 'busy' },
      },
    });
  });

  test('maps system-error status even while an active turn is tracked', () => {
    const translate = (event: unknown) => (codexRuntimeClient as unknown as {
      translateCodexEvent: (event: unknown) => Array<{ payload: { type: string; properties: Record<string, unknown> } }>;
    }).translateCodexEvent(event);

    translate({
      method: 'turn/started',
      params: {
        threadId: 'thread_status_error',
        turn: { id: 'turn_status_error' },
      },
    });
    const events = translate({
      method: 'thread/status/changed',
      params: {
        threadId: 'thread_status_error',
        status: { type: 'systemError' },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      type: 'session.status',
      properties: {
        sessionID: 'thread_status_error',
        status: {
          type: 'error',
          message: 'Codex runtime reported a system error before producing an assistant response.',
        },
      },
    });
  });

  test('keeps status busy while a new turn request is still pending', async () => {
    const translate = (event: unknown) => (codexRuntimeClient as unknown as {
      translateCodexEvent: (event: unknown) => Array<{ payload: { type: string; properties: Record<string, unknown> } }>;
    }).translateCodexEvent(event);
    let resolveStartTurn: (value: Record<string, unknown>) => void = () => {};
    const deferred = {
      promise: new Promise<Record<string, unknown>>((resolve) => {
        resolveStartTurn = resolve;
      }),
      resolve: resolveStartTurn,
    };
    startTurnDeferred = deferred;

    const sendPromise = codexRuntimeClient.sendMessage({
      sessionID: 'thread_pending_turn',
      text: 'hello',
      directory: '/workspace/project',
    });
    await Promise.resolve();
    const events = translate({
      method: 'thread/status/changed',
      params: {
        threadId: 'thread_pending_turn',
        status: 'idle',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      type: 'session.status',
      properties: {
        sessionID: 'thread_pending_turn',
        status: { type: 'busy' },
      },
    });

    deferred.resolve({ turn: { id: 'turn_pending' } });
    await sendPromise;
    startTurnDeferred = null;
  });

  test('uses Codex user message client ids for item lifecycle events', () => {
    const translate = (event: unknown) => (codexRuntimeClient as unknown as {
      translateCodexEvent: (event: unknown) => Array<{ payload: { type: string; properties: Record<string, unknown> } }>;
    }).translateCodexEvent(event);

    translate({
      method: 'turn/started',
      params: {
        threadId: 'thread_item_client',
        turn: { id: 'turn_item_client' },
      },
    });
    const events = translate({
      method: 'item/completed',
      params: {
        threadId: 'thread_item_client',
        turnId: 'turn_item_client',
        item: {
          type: 'userMessage',
          id: 'item_user_server',
          clientId: 'msg_item_client',
          content: [{ type: 'text', text: 'hello', text_elements: [] }],
        },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload.type).toBe('message.updated');
    expect((events[0]?.payload.properties.info as { id?: string }).id).toBe('msg_item_client');
    expect((events[0]?.payload.properties.parts as Array<{ messageID?: string }>)[0]?.messageID).toBe('msg_item_client');
  });

  test('treats unmaterialized or empty Codex thread history as an empty message page', async () => {
    const sdk = codexRuntimeClient.getSdkClient();
    listThreadTurnsResponse = null;
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

  test('aborts the latest active Codex turn when the in-memory active turn was lost', async () => {
    const sdk = codexRuntimeClient.getSdkClient();
    interruptTurnCalls.length = 0;
    listThreadTurnsError = null;
    listThreadTurnsResponse = {
      data: [
        { id: 'turn_completed', status: 'completed', startedAt: 10, completedAt: 20, items: [] },
        { id: 'turn_running', status: 'inProgress', startedAt: 30, completedAt: null, items: [] },
      ],
      nextCursor: null,
    };

    await sdk.session.abort({ sessionID: 'thread_lost' });

    listThreadTurnsResponse = null;

    expect(interruptTurnCalls).toEqual([
      { threadId: 'thread_lost', turnId: 'turn_running' },
    ]);
  });

  test('maps revert, fork, and compact actions onto Codex-native thread calls', async () => {
    rollbackCalls.length = 0;
    forkCalls.length = 0;
    compactCalls.length = 0;

    const reverted = await codexRuntimeClient.revertSession('thread_1', 'thread_1:turn_1:000000:item_user', undefined, '/workspace/project');
    const forked = await codexRuntimeClient.forkSession('thread_1', 'item_user', '/workspace/project');
    await codexRuntimeClient.summarizeSession('thread_1');

    expect(rollbackCalls).toEqual([
      { threadId: 'thread_1', body: { numTurns: 1 } },
    ]);
    expect(reverted.revert).toEqual({ messageID: 'thread_1:turn_1:000000:item_user' });
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

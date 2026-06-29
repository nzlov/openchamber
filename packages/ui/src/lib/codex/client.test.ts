import { describe, expect, mock, test } from 'bun:test';

const fetchCalls: Array<{ path: string; init?: unknown }> = [];

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async (path: string, init?: unknown) => {
    fetchCalls.push({ path, init });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }),
}));

mock.module('@/lib/runtime-url', () => ({
  getRuntimeUrlResolver: mock(() => ({
    sse: (path: string) => `/runtime${path}?oc_url_token=short`,
  })),
}));

const { codexClient } = await import(`./client?codex-client-test=${Date.now()}`);

describe('codexClient', () => {
  test('uses runtimeFetch route paths for Codex HTTP calls', async () => {
    fetchCalls.length = 0;

    await codexClient.startTurn('thread-1', {
      input: [{ type: 'text', text: 'hello' }],
      model: 'gpt-5.1-codex',
    });

    expect(fetchCalls[0]?.path).toBe('/api/codex/threads/thread-1/turns');
    expect((fetchCalls[0]?.init as RequestInit).method).toBe('POST');
    expect((fetchCalls[0]?.init as RequestInit).body).toBe(JSON.stringify({
      input: [{ type: 'text', text: 'hello' }],
      model: 'gpt-5.1-codex',
    }));

    await codexClient.readThread('thread-1', { includeTurns: false });
    expect(fetchCalls[1]?.path).toBe('/api/codex/threads/thread-1');
    expect(fetchCalls[1]?.init).toEqual({ query: { includeTurns: false } });
  });

  test('uses runtime URL resolver only for SSE event URLs', () => {
    expect(codexClient.eventsUrl()).toBe('/runtime/api/codex/events?oc_url_token=short');
  });
});

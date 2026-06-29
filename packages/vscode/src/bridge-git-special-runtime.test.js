import { beforeEach, describe, expect, it, mock } from 'bun:test';

const gitService = {
  getGitRangeFiles: mock(),
  getGitRangeDiff: mock(),
};

const rawFetch = mock(async (input, init) => {
  const url = String(input);
  if (url.endsWith('/v2/model')) {
    return new Response(JSON.stringify([{ providerID: 'anthropic', id: 'claude-sonnet-4-5' }]), { status: 200 });
  }
  if (url.endsWith('/session') && init?.method === 'POST') {
    return new Response(JSON.stringify({ id: 'ses_1' }), { status: 200 });
  }
  if (url.includes('/session/ses_1/prompt_async')) {
    return new Response(JSON.stringify(true), { status: 200 });
  }
  if (url.includes('/session/ses_1/message')) {
    return new Response(JSON.stringify([{
      info: { role: 'assistant', finish: 'stop' },
      parts: [{ type: 'text', text: '{"title":"PR title","body":"PR body"}' }],
    }]), { status: 200 });
  }
  if (url.endsWith('/session/ses_1') && init?.method === 'DELETE') {
    return new Response(JSON.stringify(true), { status: 200 });
  }
  throw new Error(`unexpected fetch: ${url}`);
});

mock.module('./gitService', () => gitService);

const { handleSpecialGitBridgeMessage } = await import('./bridge-git-special-runtime');

describe('bridge git special runtime', () => {
  beforeEach(() => {
    gitService.getGitRangeFiles.mockReset();
    gitService.getGitRangeDiff.mockReset();
    rawFetch.mockClear();

    globalThis.fetch = rawFetch;
    gitService.getGitRangeFiles.mockImplementation(async () => ['src/a.ts']);
    gitService.getGitRangeDiff.mockImplementation(async () => ({ diff: 'diff --git a/src/a.ts b/src/a.ts\n+new line' }));
  });

  it('generates PR descriptions through the bridge HTTP session flow', async () => {
    const response = await handleSpecialGitBridgeMessage({
      id: '1',
      type: 'api:git/pr-description',
      payload: {
        directory: '/repo',
        base: 'main',
        head: 'feature',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
      },
    }, {
      manager: {
        getRuntimeApiUrl: () => 'http://codex.test',
        getRuntimeAuthHeaders: () => ({ Authorization: 'Bearer test' }),
      },
    }, {
      readSettings: () => ({}),
      execGit: mock(),
    });

    expect(response).toEqual({
      id: '1',
      type: 'api:git/pr-description',
      success: true,
      data: { title: 'PR title', body: 'PR body' },
    });
    expect(rawFetch.mock.calls.map((call) => String(call[0]))).toEqual([
      'http://codex.test/v2/model',
      'http://codex.test/session',
      'http://codex.test/session/ses_1/prompt_async?directory=%2Frepo',
      'http://codex.test/session/ses_1/message?directory=%2Frepo&limit=10',
      'http://codex.test/session/ses_1',
    ]);
  });
});

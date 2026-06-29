import { describe, expect, test } from 'bun:test'
import type { CodexRuntimeSdkClient } from '@/lib/codex/types'

import { listGlobalSessionPages } from './globalSessions'

describe('listGlobalSessionPages', () => {
  test('sanitizes session list records before returning them', async () => {
    const apiClient = {
      experimental: {
        session: {
          list: async () => ({
            data: [
              {
                id: 'ses_1',
                directory: '/repo/app',
                title: 'Alpha',
                time: { created: 1, updated: 2 },
                metadata: {
                  openchamber: {
                    kind: 'review',
                    originalSessionID: 'ses_original',
                  },
                },
                permission: [{ permission: 'todowrite' }],
                revert: { messageID: 'msg_1', snapshot: 'abc123', diff: 'diff --git a/x b/x' },
                summary: {
                  additions: 5,
                  deletions: 3,
                  files: 2,
                  diffs: [{ patch: '@@ -1 +1 @@', additions: 5, deletions: 3 }],
                },
              },
            ],
            response: { headers: new Headers() },
          }),
        },
      },
    } as unknown as CodexRuntimeSdkClient

    const sessions = await listGlobalSessionPages(apiClient, { archived: false, pageSize: 500 })
    const session = sessions[0] as typeof sessions[number] & {
      metadata?: unknown
      permission?: unknown
      revert?: { messageID?: string; snapshot?: string; diff?: string }
      summary?: { additions?: number; deletions?: number; files?: number; diffs?: unknown[] }
    }

    expect(session.metadata).toEqual({
      openchamber: {
        kind: 'review',
        originalSessionID: 'ses_original',
      },
    })
    expect(session.permission).toBe(undefined)
    expect(session.revert).toEqual({ messageID: 'msg_1' })
    expect(session.summary).toEqual({ additions: 5, deletions: 3, files: 2 })
  })

  test('passes opaque pagination cursors without numeric coercion', async () => {
    const cursors: unknown[] = []
    const pages = [
      {
        data: [{ id: 'ses_1', time: { updated: 20 } }],
        response: { headers: new Headers({ 'x-next-cursor': 'cursor:opaque:2' }) },
      },
      {
        data: [{ id: 'ses_2', time: { updated: 10 } }],
        response: { headers: new Headers() },
      },
    ]
    const apiClient = {
      experimental: {
        session: {
          list: async (params: { cursor?: unknown }) => {
            cursors.push(params.cursor)
            return pages.shift() ?? { data: [], response: { headers: new Headers() } }
          },
        },
      },
    } as unknown as CodexRuntimeSdkClient

    const sessions = await listGlobalSessionPages(apiClient, { archived: false, pageSize: 1 })

    expect(sessions.map((session) => session.id)).toEqual(['ses_1', 'ses_2'])
    expect(cursors).toEqual([undefined, 'cursor:opaque:2'])
  })
})

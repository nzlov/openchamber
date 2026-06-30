import { describe, expect, test } from 'bun:test'

import { isThreadNotLoadedSessionError, shouldFetchSessionForRenderableSync } from './use-sync'

describe('shouldFetchSessionForRenderableSync', () => {
  test('fetches full session detail when a lightweight list session is opened', () => {
    expect(shouldFetchSessionForRenderableSync({
      hasSession: true,
      shouldLoadMessages: true,
      force: false,
    })).toBe(true)
  })

  test('skips session detail fetch when session and messages are already ready', () => {
    expect(shouldFetchSessionForRenderableSync({
      hasSession: true,
      shouldLoadMessages: false,
      force: false,
    })).toBe(false)
  })

  test('fetches when the session record is missing', () => {
    expect(shouldFetchSessionForRenderableSync({
      hasSession: false,
      shouldLoadMessages: false,
      force: false,
    })).toBe(true)
  })
})

describe('isThreadNotLoadedSessionError', () => {
  test('matches Codex thread/read not-loaded errors', () => {
    expect(isThreadNotLoadedSessionError(new Error(
      'thread/read failed: thread not loaded: 019f1709-5f26-7f92-b6c3-0329646c63ec (-32600)',
    ))).toBe(true)
  })

  test('does not match unrelated session fetch errors', () => {
    expect(isThreadNotLoadedSessionError(new Error('session.get failed: network request failed'))).toBe(false)
    expect(isThreadNotLoadedSessionError(new Error('thread/read failed: permission denied (-32600)'))).toBe(false)
  })
})

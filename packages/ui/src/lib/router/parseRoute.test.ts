import { describe, expect, test } from 'bun:test';
import { parseRoute } from './parseRoute';

describe('parseRoute', () => {
  test('parses session route with optional directory hint', () => {
    const route = parseRoute(new URLSearchParams([
      ['session', ' 019f1288-375e-7522-87a1-28a4507c4cb2 '],
      ['directory', ' /home/nzlov/workspaces/github/openchamber '],
    ]));

    expect(route.sessionId).toBe('019f1288-375e-7522-87a1-28a4507c4cb2');
    expect(route.directory).toBe('/home/nzlov/workspaces/github/openchamber');
  });

  test('ignores empty session and directory values', () => {
    const route = parseRoute(new URLSearchParams([
      ['session', ' '],
      ['directory', ' '],
    ]));

    expect(route.sessionId).toBeNull();
    expect(route.directory).toBeNull();
  });
});

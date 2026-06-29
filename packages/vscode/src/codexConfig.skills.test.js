import { describe, expect, test } from 'bun:test';

import {
  BUILT_IN_SKILL_LOCATION,
  getSkillSources,
  mergeDiscoveredSkills,
} from './codexConfig';

describe('VS Code skill discovery parity', () => {
  test('merges Codex API skills with locally discovered fallback skills', () => {
    const merged = mergeDiscoveredSkills(
      [
        { name: 'built-in', path: BUILT_IN_SKILL_LOCATION, scope: 'user', source: 'codex' },
        { name: 'local-first', path: '/tmp/local-first/SKILL.md', scope: 'user', source: 'agents' },
      ],
      [
        { name: 'local-first', path: '/tmp/local-first/SKILL.md', scope: 'user', source: 'agents' },
        { name: 'local-only', path: '/tmp/local-only/SKILL.md', scope: 'project', source: 'claude' },
      ],
    );

    expect(merged.map((skill) => skill.name)).toEqual(['built-in', 'local-first', 'local-only']);
  });

  test('resolves built-in skills without treating the virtual location as a file', () => {
    const discoveredSkill = {
      name: 'customize-codex',
      path: BUILT_IN_SKILL_LOCATION,
      scope: 'user',
      source: 'codex',
      description: 'Customize codex',
      content: '# Customize codex\n\nUse for config work.',
    };

    const sources = getSkillSources('customize-codex', '/tmp/openchamber-vscode-skills-test', discoveredSkill);

    expect(sources.md.exists).toBe(true);
    expect(sources.md.path).toBeNull();
    expect(sources.md.dir).toBeNull();
    expect(sources.md.scope).toBe('user');
    expect(sources.md.source).toBe('codex');
    expect(sources.md.description).toBe('Customize codex');
    expect(sources.md.instructions).toBe('# Customize codex\n\nUse for config work.');
    expect(sources.md.fields).toEqual(['description', 'instructions']);
  });
});

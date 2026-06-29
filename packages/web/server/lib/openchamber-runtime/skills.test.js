import { describe, expect, it } from 'vitest';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { getSkillSources, mergeDiscoveredSkills } from './skills.js';

describe('skills', () => {
  it('merges locally discovered Codex skills with local skills', () => {
    const merged = mergeDiscoveredSkills(
      [
        { name: 'existing-codex-skill', path: '/home/jkker/.codex/skills/existing-codex-skill/SKILL.md', source: 'codex' },
        { name: 'existing-agent-skill', path: '/home/jkker/.agents/skills/existing-agent-skill/SKILL.md', source: 'agents' },
      ],
      [
        { name: 'existing-agent-skill', path: '/home/jkker/.agents/skills/existing-agent-skill/SKILL.md', source: 'agents' },
        { name: 'new-agent-skill', path: '/home/jkker/.agents/skills/new-agent-skill/SKILL.md', source: 'agents' },
      ],
    );

    expect(merged.map((skill) => skill.name)).toEqual([
      'existing-codex-skill',
      'existing-agent-skill',
      'new-agent-skill',
    ]);
  });

  it('resolves built-in Codex skill content without parsing virtual locations as files', () => {
    const sources = getSkillSources(
      'customize-codex',
      '/tmp/openchamber-skills-test-missing-project',
      {
        name: 'customize-codex',
        path: '<built-in>',
        scope: 'user',
        source: 'codex',
        description: 'Customize Codex',
        content: '# Customizing Codex\n\nUse this skill when updating config.',
      },
    );

    expect(sources.md.exists).toBe(true);
    expect(sources.md.path).toBe(null);
    expect(sources.md.dir).toBe(null);
    expect(sources.md.scope).toBe('user');
    expect(sources.md.source).toBe('codex');
    expect(sources.md.description).toBe('Customize Codex');
    expect(sources.md.instructions).toBe('# Customizing Codex\n\nUse this skill when updating config.');
    expect(sources.md.fields).toEqual(['description', 'instructions']);
  });

  it('clears file metadata when a discovered skill path is unreadable', () => {
    const missingPath = path.join(os.tmpdir(), 'openchamber-skills-test-missing-file', 'SKILL.md');
    const sources = getSkillSources(
      'missing-agent-skill',
      '/tmp/openchamber-skills-test-missing-project',
      {
        name: 'missing-agent-skill',
        path: missingPath,
        scope: 'user',
        source: 'agents',
        description: 'Missing skill',
      },
    );

    expect(sources.md.exists).toBe(false);
    expect(sources.md.path).toBe(null);
    expect(sources.md.dir).toBe(null);
    expect(sources.md.scope).toBe(null);
    expect(sources.md.source).toBe(null);
    expect(sources.md.description).toBe('Missing skill');
    expect(sources.md.instructions).toBe('');
  });

  it('enriches discovered skills when their location is a real markdown file', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-skills-'));
    const skillDir = path.join(tempRoot, 'example-skill');
    const skillPath = path.join(skillDir, 'SKILL.md');

    try {
      await fsPromises.mkdir(skillDir, { recursive: true });
      await fsPromises.writeFile(
        skillPath,
        [
          '---',
          'name: example-skill',
          'description: Example from agents',
          '---',
          '',
          'Use this skill for examples.',
          '',
        ].join('\n'),
        'utf8',
      );

      const sources = getSkillSources('example-skill', tempRoot, {
        name: 'example-skill',
        path: skillPath,
        scope: 'user',
        source: 'agents',
        description: 'Fallback description',
      });

      expect(sources.md.exists).toBe(true);
      expect(sources.md.path).toBe(skillPath);
      expect(sources.md.scope).toBe('user');
      expect(sources.md.source).toBe('agents');
      expect(sources.md.description).toBe('Example from agents');
      expect(sources.md.instructions).toBe('Use this skill for examples.');
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

import type { SkillScope, SkillSource } from '@/stores/useSkillsStore';

export type SkillLocationValue = 'user-codex' | 'project-codex' | 'user-claude' | 'project-claude' | 'user-agents' | 'project-agents';

export const SKILL_LOCATION_OPTIONS: Array<{
  value: SkillLocationValue;
  scope: SkillScope;
  source: SkillSource;
  label: string;
  description: string;
}> = [
  {
    value: 'user-codex',
    scope: 'user',
    source: 'codex',
    label: 'User / Codex',
    description: 'Global Codex config location',
  },
  {
    value: 'project-codex',
    scope: 'project',
    source: 'codex',
    label: 'Project / Codex',
    description: 'Current project .codex location',
  },
  {
    value: 'user-agents',
    scope: 'user',
    source: 'agents',
    label: 'User / Agents',
    description: 'Global .agents compatibility location',
  },
  {
    value: 'project-agents',
    scope: 'project',
    source: 'agents',
    label: 'Project / Agents',
    description: 'Current project .agents compatibility location',
  },
];

export function locationValueFrom(scope: SkillScope, source: SkillSource): SkillLocationValue {
  if (scope === 'project' && source === 'claude') return 'project-claude';
  if (scope === 'project' && source === 'agents') return 'project-agents';
  if (source === 'claude') return 'user-claude';
  if (scope === 'project') return 'project-codex';
  if (source === 'agents') return 'user-agents';
  return 'user-codex';
}

export function locationPartsFrom(value: SkillLocationValue): { scope: SkillScope; source: SkillSource } {
  if (value === 'user-claude') return { scope: 'user', source: 'claude' };
  if (value === 'project-claude') return { scope: 'project', source: 'claude' };
  const match = SKILL_LOCATION_OPTIONS.find((option) => option.value === value);
  if (!match) {
    return { scope: 'user', source: 'codex' };
  }
  return { scope: match.scope, source: match.source };
}

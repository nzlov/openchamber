import type { CodexEventFrame } from './types';

export const parseCodexEventFrame = (value: unknown): CodexEventFrame | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.sequence !== 'number') return null;
  if (typeof candidate.receivedAt !== 'string') return null;
  if (typeof candidate.method !== 'string' || candidate.method.length === 0) return null;

  return {
    sequence: candidate.sequence,
    receivedAt: candidate.receivedAt,
    method: candidate.method,
    params: candidate.params ?? null,
    raw: candidate.raw ?? null,
  };
};

export const decodeCodexEventMessage = (data: string): CodexEventFrame | null => {
  try {
    return parseCodexEventFrame(JSON.parse(data));
  } catch {
    return null;
  }
};

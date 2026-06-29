import { describe, expect, it, vi } from 'vitest';
import { computeNextRunAt, createScheduledTasksRuntime, formatScheduledSessionTitle } from './runtime.js';

describe('scheduled-tasks runtime helpers', () => {
  it('computes next daily run in timezone', () => {
    const nowUtc = Date.UTC(2025, 0, 1, 8, 0, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'daily',
        times: ['09:30'],
        timezone: 'UTC',
      },
    }, nowUtc);

    expect(next).toBe(Date.UTC(2025, 0, 1, 9, 30, 0));
  });

  it('computes weekly next run using weekdays', () => {
    // Monday 2025-01-06 10:00:00 UTC
    const nowUtc = Date.UTC(2025, 0, 6, 10, 0, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'weekly',
        times: ['09:00'],
        weekdays: [1, 3],
        timezone: 'UTC',
      },
    }, nowUtc);

    // Wednesday 2025-01-08 09:00:00 UTC
    expect(next).toBe(Date.UTC(2025, 0, 8, 9, 0, 0));
  });

  it('picks nearest time from multiple daily times', () => {
    const nowUtc = Date.UTC(2025, 0, 1, 9, 20, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'daily',
        times: ['09:15', '09:45', '18:00'],
        timezone: 'UTC',
      },
    }, nowUtc);

    expect(next).toBe(Date.UTC(2025, 0, 1, 9, 45, 0));
  });

  it('computes one-time next run for future date', () => {
    const nowUtc = Date.UTC(2026, 3, 15, 10, 0, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'once',
        date: '2026-04-16',
        time: '13:30',
        timezone: 'UTC',
      },
    }, nowUtc);

    expect(next).toBe(Date.UTC(2026, 3, 16, 13, 30, 0));
  });

  it('returns null for past one-time schedule', () => {
    const nowUtc = Date.UTC(2026, 3, 16, 14, 0, 0);
    const next = computeNextRunAt({
      enabled: true,
      schedule: {
        kind: 'once',
        date: '2026-04-16',
        time: '13:30',
        timezone: 'UTC',
      },
    }, nowUtc);

    expect(next).toBeNull();
  });

  it('formats session title with timestamp suffix', () => {
    const title = formatScheduledSessionTitle({
      name: 'Morning Sync',
      schedule: { timezone: 'UTC' },
    }, Date.UTC(2025, 2, 10, 7, 5, 0));

    expect(title).toBe('Morning Sync 2025-03-10 07:05');
  });

  it('runs scheduled tasks through Codex threads and turns', async () => {
    const task = {
      id: 'task-1',
      enabled: true,
      name: 'Morning Sync',
      schedule: { kind: 'daily', times: ['09:30'], timezone: 'UTC' },
      execution: {
        providerID: 'openai',
        modelID: 'gpt-5.1-codex',
        prompt: 'Summarize project',
      },
    };
    let savedTask = task;
    const protocolRuntime = {
      startThread: vi.fn(async () => ({ thread: { id: 'thread-1' } })),
      setThreadName: vi.fn(async () => ({})),
      startTurn: vi.fn(async () => ({ turn: { id: 'turn-1' } })),
    };
    const runtime = createScheduledTasksRuntime({
      projectConfigRuntime: {
        listScheduledTasks: vi.fn(async () => [savedTask]),
        updateScheduledTaskState: vi.fn(async (_projectID, _taskID, patch) => {
          savedTask = {
            ...savedTask,
            state: {
              ...(savedTask.state || {}),
              ...patch,
            },
          };
          return { task: savedTask };
        }),
        upsertScheduledTask: vi.fn(async (_projectID, nextTask) => {
          savedTask = nextTask;
          return { task: savedTask };
        }),
      },
      listProjects: vi.fn(async () => [{ id: 'project-1', path: '/repo' }]),
      codexProcessRuntime: {
        getHealthSnapshot: vi.fn(() => ({ running: true, initialized: true })),
        getProtocolRuntime: vi.fn(() => protocolRuntime),
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    await runtime.syncProject('project-1');
    const result = await runtime.runNow('project-1', 'task-1');

    expect(result.ok).toBe(true);
    expect(result.sessionID).toBe('thread-1');
    expect(protocolRuntime.startThread).toHaveBeenCalledWith({
      cwd: '/repo',
      model: 'gpt-5.1-codex',
      modelProvider: 'openai',
      threadSource: 'api',
    });
    expect(protocolRuntime.setThreadName).toHaveBeenCalledWith({
      threadId: 'thread-1',
      name: expect.stringContaining('Morning Sync'),
    });
    expect(protocolRuntime.startTurn).toHaveBeenCalledWith({
      threadId: 'thread-1',
      cwd: '/repo',
      model: 'gpt-5.1-codex',
      input: [{ type: 'text', text: 'Summarize project', text_elements: [] }],
      responsesapiClientMetadata: {
        openchamberScheduledTaskId: 'task-1',
        openchamberScheduledTaskReason: 'manual',
      },
    });
  });
});

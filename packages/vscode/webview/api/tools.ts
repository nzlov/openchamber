import type { ToolsAPI } from '@openchamber/ui/lib/api/types';
import { codexRuntimeClient } from '@openchamber/ui/lib/codex/runtime-client';

export const createVSCodeToolsAPI = (): ToolsAPI => ({
  async getAvailableTools(): Promise<string[]> {
    const data = await codexRuntimeClient.listToolIds();
    if (!Array.isArray(data)) {
      throw new Error('Tools API returned invalid data format');
    }

    return data
      .filter((tool: unknown): tool is string => typeof tool === 'string' && tool !== 'invalid')
      .sort();
  },
});

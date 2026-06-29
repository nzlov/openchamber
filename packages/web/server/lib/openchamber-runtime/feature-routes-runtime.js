import { registerFsRoutes } from '../fs/routes.js';
import { registerQuotaRoutes } from '../quota/routes.js';
import { registerGitHubRoutes } from '../github/routes.js';
import { registerGitRoutes } from '../git/routes.js';
import { registerMagicPromptRoutes } from '../magic-prompts/routes.js';
import { registerSessionFoldersRoutes } from '../session-folders/routes.js';
import { registerConfigEntityRoutes } from './config-entity-routes.js';
import { registerSettingsUtilityRoutes } from './core-routes.js';
import { registerProjectIconRoutes } from './project-icon-routes.js';
import { registerScheduledTaskRoutes } from '../scheduled-tasks/routes.js';
import { registerSkillRoutes } from './skill-routes.js';
import { registerPluginRoutes } from './plugin-routes.js';
import { getNpmInfo, clearCache as clearNpmCache } from './npm-registry.js';
import { parseNpmSpec, parsePathSpec, isExactSemver } from './plugin-spec.js';
import { registerRuntimeConfigRoutes } from './routes.js';
import { getProviderSources, removeProviderConfig } from './providers.js';
import { getAgentSources, getAgentConfig, createAgent, updateAgent, deleteAgent } from './agents.js';
import { getCommandSources, createCommand, updateCommand, deleteCommand } from './commands.js';
import { listMcpConfigs, getMcpConfig, createMcpConfig, updateMcpConfig, deleteMcpConfig } from './mcp.js';
import { listSnippets, getSnippet, createSnippet, updateSnippet, deleteSnippet, expandSnippets } from './snippets.js';
import {
  listPluginEntries,
  getPluginEntry,
  createPluginEntry,
  updatePluginEntry,
  deletePluginEntry,
  listPluginDirFiles,
  readPluginDirFile,
  writePluginDirFile,
  deletePluginDirFile,
  encodePluginId,
  decodePluginId,
} from './plugins.js';
import { SKILL_DIR, SKILL_SCOPE, readSkillSupportingFile, writeSkillSupportingFile, deleteSkillSupportingFile } from './shared.js';
import { getSkillSources, discoverSkills, mergeDiscoveredSkills, createSkill, updateSkill, deleteSkill } from './skills.js';
import { getCuratedSkillsSources } from '../skills-catalog/curated-sources.js';
import { getCacheKey, getCachedScan, setCachedScan } from '../skills-catalog/cache.js';
import { isClawdHubSource, parseSkillRepoSource } from '../skills-catalog/source.js';
import { scanSkillsRepository } from '../skills-catalog/scan.js';
import { installSkillsFromRepository } from '../skills-catalog/install.js';
import { scanClawdHubPage } from '../skills-catalog/clawdhub/scan.js';
import { installSkillsFromClawdHub } from '../skills-catalog/clawdhub/install.js';

export const createFeatureRoutesRuntime = (dependencies) => {
  const {
    clientReloadDelayMs,
  } = dependencies;

  let quotaProviders = null;
  const getQuotaProviders = async () => {
    if (!quotaProviders) {
      quotaProviders = await import('../quota/index.js');
    }
    return quotaProviders;
  };

  const registerRoutes = async (app, routeDependencies) => {
    const {
      crypto,
      fs,
      os,
      path,
      fsPromises,
      spawn,
      resolveGitBinaryForSpawn,
      createFsSearchRuntime,
      openchamberDataDir,
      openchamberUserConfigRoot,
      normalizeDirectoryPath,
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      validateDirectoryPath,
      readCustomThemesFromDisk,
      refreshRuntimeAfterConfigChange,
      formatSettingsResponse,
      readSettingsFromDisk,
      readSettingsFromDiskMigrated,
      persistSettings,
      sanitizeProjects,
      sanitizeSkillCatalogs,
      isUnsafeSkillRelativePath,
      buildAugmentedPath,
      projectConfigRuntime,
      scheduledTasksRuntime,
      getOpenChamberEventClients,
      writeSseEvent,
    } = routeDependencies;

    registerSettingsUtilityRoutes(app, {
      readCustomThemesFromDisk,
      refreshRuntimeAfterConfigChange,
      clientReloadDelayMs,
    });

    registerRuntimeConfigRoutes(app, {
      clientReloadDelayMs,
      formatSettingsResponse,
      readSettingsFromDisk,
      readSettingsFromDiskMigrated,
      persistSettings,
      sanitizeProjects,
      resolveProjectDirectory,
      getProviderSources,
      removeProviderConfig,
      refreshRuntimeAfterConfigChange,
    });

    registerProjectIconRoutes(app, {
      fsPromises,
      path,
      crypto,
      openchamberDataDir,
      sanitizeProjects,
      readSettingsFromDiskMigrated,
      persistSettings,
      createFsSearchRuntime,
      spawn,
      resolveGitBinaryForSpawn,
    });

    registerScheduledTaskRoutes(app, {
      readSettingsFromDiskMigrated,
      sanitizeProjects,
      projectConfigRuntime,
      scheduledTasksRuntime,
      getOpenChamberEventClients,
      writeSseEvent,
    });

    registerConfigEntityRoutes(app, {
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      refreshRuntimeAfterConfigChange,
      clientReloadDelayMs,
      getAgentSources,
      getAgentConfig,
      createAgent,
      updateAgent,
      deleteAgent,
      getCommandSources,
      createCommand,
      updateCommand,
      deleteCommand,
      listMcpConfigs,
      getMcpConfig,
      createMcpConfig,
      updateMcpConfig,
      deleteMcpConfig,
      listSnippets,
      getSnippet,
      createSnippet,
      updateSnippet,
      deleteSnippet,
      expandSnippets,
    });

    registerPluginRoutes(app, {
      resolveOptionalProjectDirectory,
      refreshRuntimeAfterConfigChange,
      clientReloadDelayMs,
      listPluginEntries,
      getPluginEntry,
      createPluginEntry,
      updatePluginEntry,
      deletePluginEntry,
      listPluginDirFiles,
      readPluginDirFile,
      writePluginDirFile,
      deletePluginDirFile,
      encodePluginId,
      decodePluginId,
      getNpmInfo,
      parseNpmSpec,
      parsePathSpec,
      isExactSemver,
    });

    const { getProfiles, getProfile } = await import('../git/index.js');

    registerSkillRoutes(app, {
      fs,
      path,
      os,
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      readSettingsFromDisk,
      sanitizeSkillCatalogs,
      isUnsafeSkillRelativePath,
      refreshRuntimeAfterConfigChange,
      clientReloadDelayMs,
      getSkillSources,
      discoverSkills,
      mergeDiscoveredSkills,
      createSkill,
      updateSkill,
      deleteSkill,
      readSkillSupportingFile,
      writeSkillSupportingFile,
      deleteSkillSupportingFile,
      SKILL_SCOPE,
      SKILL_DIR,
      getCuratedSkillsSources,
      getCacheKey,
      getCachedScan,
      setCachedScan,
      parseSkillRepoSource,
      scanSkillsRepository,
      installSkillsFromRepository,
      scanClawdHubPage,
      installSkillsFromClawdHub,
      isClawdHubSource,
      getProfiles,
      getProfile,
    });

    registerQuotaRoutes(app, { getQuotaProviders });
    registerGitHubRoutes(app);
    registerGitRoutes(app);
    registerMagicPromptRoutes(app, {
      fsPromises,
      path,
      openchamberDataDir,
    });
    registerSessionFoldersRoutes(app, {
      fsPromises,
      path,
      openchamberDataDir,
    });
    registerFsRoutes(app, {
      os,
      path,
      fsPromises,
      spawn,
      crypto,
      normalizeDirectoryPath,
      resolveProjectDirectory,
      buildAugmentedPath,
      resolveGitBinaryForSpawn,
      openchamberUserConfigRoot,
    });
  };

  return {
    registerRoutes,
  };
};

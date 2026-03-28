// packages/dashboard/src/git-hosts/registry.ts

import type { GitHostPlugin } from './types.js';
import { GitHubPlugin } from './github.js';
import { GitLabPlugin } from './gitlab.js';
import { AzureDevOpsPlugin } from './azure-devops.js';

const plugins = new Map<string, GitHostPlugin>();

export function registerGitHostPlugin(plugin: GitHostPlugin): void {
  plugins.set(plugin.type, plugin);
}

export function getGitHostPlugin(type: string): GitHostPlugin | undefined {
  return plugins.get(type);
}

export function listGitHostPluginTypes(): readonly string[] {
  return [...plugins.keys()];
}

// Register built-in plugins
registerGitHostPlugin(new GitHubPlugin());
registerGitHostPlugin(new GitLabPlugin());
registerGitHostPlugin(new AzureDevOpsPlugin());

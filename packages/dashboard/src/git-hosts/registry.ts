// packages/dashboard/src/git-hosts/registry.ts

import type { GitHostPlugin } from './types.js';
import type { PluginManager } from '../plugins/manager.js';
import type { GitHostPluginInstance } from '../plugins/types.js';

let _pluginManager: PluginManager | undefined;

export function setGitHostPluginManager(pm: PluginManager): void {
  _pluginManager = pm;
}

export function getGitHostPlugin(type: string): GitHostPlugin | undefined {
  if (_pluginManager === undefined) return undefined;

  // Find active git-host plugins and match by type suffix
  const activePlugins = _pluginManager.list().filter(
    (p) => p.type === 'git-host' && p.status === 'active',
  );

  for (const p of activePlugins) {
    const instance = _pluginManager.getActiveInstance(p.id) as GitHostPluginInstance | undefined;
    if (instance?.gitHost?.type === type) {
      return instance.gitHost;
    }
  }
  return undefined;
}

export function listGitHostPluginTypes(): readonly string[] {
  if (_pluginManager === undefined) return [];

  const active = _pluginManager.list().filter(
    (p) => p.type === 'git-host' && p.status === 'active',
  );

  return active.map((p) => {
    const instance = _pluginManager!.getActiveInstance(p.id) as GitHostPluginInstance | undefined;
    return instance?.gitHost?.type ?? p.packageName;
  }).filter(Boolean);
}

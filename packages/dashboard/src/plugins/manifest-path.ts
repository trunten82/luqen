/**
 * PBH-B Task 2 — pure plugin package-dir + manifest resolution.
 *
 * Extracted from PluginManager (resolvePackageDir / readManifest /
 * tryReadManifest) so there is exactly ONE implementation of "where does a
 * plugin package live" and "what does its manifest say" — shared by
 * PluginManager itself and the at-rest store registry (stores.ts), which
 * must resolve plugin secret fields the SAME way the runtime does
 * (encryptConfig/decryptConfig), or a re-key would silently miss fields.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginManifest } from './types.js';

/** Convert @luqen/plugin-auth-entra -> auth-entra */
export function packageNameToPluginName(packageName: string): string {
  const parts = packageName.split('/');
  const last = parts[parts.length - 1];
  return last.replace(/^plugin-/, '');
}

/**
 * Resolve the package directory — checks new layout first, falls back to legacy.
 * New: pluginsDir/packages/{name}/
 * Legacy: pluginsDir/node_modules/@scope/plugin-name/
 */
export function resolvePluginPackageDir(pluginsDir: string, packageName: string): string {
  const name = packageNameToPluginName(packageName);
  const newPath = join(pluginsDir, 'packages', name);
  if (existsSync(newPath)) return newPath;

  // Legacy layout (npm-installed plugins)
  return join(pluginsDir, 'node_modules', ...packageName.split('/'));
}

export function readPluginManifest(pluginsDir: string, packageName: string): PluginManifest {
  const manifestPath = join(resolvePluginPackageDir(pluginsDir, packageName), 'manifest.json');
  const raw = readFileSync(manifestPath, 'utf-8');
  return JSON.parse(raw) as PluginManifest;
}

export function tryReadPluginManifest(pluginsDir: string, packageName: string): PluginManifest | null {
  try {
    return readPluginManifest(pluginsDir, packageName);
  } catch {
    return null;
  }
}

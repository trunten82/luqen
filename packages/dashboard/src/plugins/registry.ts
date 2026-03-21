import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AdminPage {
  readonly path: string;
  readonly title: string;
  readonly icon: string;
  readonly permission: string;
}

export interface RegistryEntry {
  readonly name: string;
  readonly displayName: string;
  readonly type: PluginType;
  readonly version: string;
  readonly description: string;
  readonly packageName: string;
  readonly icon: string;
  readonly adminPages?: readonly AdminPage[];
}

export type PluginType = 'auth' | 'notification' | 'storage';

interface RegistryFile {
  readonly plugins: readonly RegistryEntry[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_REGISTRY_PATH = resolve(__dirname, '..', '..', 'plugin-registry.json');

/**
 * Reads the plugin registry JSON and returns an array of entries.
 * @param registryPath - Optional path to the registry JSON file.
 */
export function loadRegistry(registryPath: string = DEFAULT_REGISTRY_PATH): readonly RegistryEntry[] {
  const raw = readFileSync(registryPath, 'utf-8');
  const data: RegistryFile = JSON.parse(raw);
  return data.plugins;
}

/**
 * Filters registry entries by plugin type.
 */
export function filterByType(entries: readonly RegistryEntry[], type: PluginType): readonly RegistryEntry[] {
  return entries.filter((entry) => entry.type === type);
}

/**
 * Finds a registry entry by its slug name, or returns null if not found.
 */
export function getByName(entries: readonly RegistryEntry[], name: string): RegistryEntry | null {
  return entries.find((entry) => entry.name === name) ?? null;
}

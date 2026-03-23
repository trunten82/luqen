import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegistryEntry, CatalogueResponse, PluginType } from './types.js';

// Re-export for backward compat (some consumers import from registry.ts)
export type { RegistryEntry, PluginType };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_REGISTRY_PATH = resolve(__dirname, '..', '..', 'plugin-registry.json');
const DEFAULT_CATALOGUE_URL =
  'https://raw.githubusercontent.com/trunten82/luqen-plugins/main/catalogue.json';

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cachedEntries: readonly RegistryEntry[] | null = null;
let cacheExpiresAt = 0;

/** Clear the in-memory catalogue cache (useful for testing). */
export function clearRegistryCache(): void {
  cachedEntries = null;
  cacheExpiresAt = 0;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RegistryOptions {
  /** URL to fetch the remote plugin catalogue. */
  readonly catalogueUrl?: string;
  /** Cache TTL in seconds. Default: 3600 (1 hour). */
  readonly cacheTtlSeconds?: number;
  /** Path to the local plugin-registry.json fallback. */
  readonly fallbackPath?: string;
}

// ---------------------------------------------------------------------------
// Local fallback
// ---------------------------------------------------------------------------

function loadLocalRegistry(registryPath: string): readonly RegistryEntry[] {
  if (!existsSync(registryPath)) return [];
  try {
    const raw = readFileSync(registryPath, 'utf-8');
    const data = JSON.parse(raw) as { plugins?: readonly RegistryEntry[] };
    return data.plugins ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Remote fetch
// ---------------------------------------------------------------------------

async function fetchRemoteCatalogue(url: string): Promise<readonly RegistryEntry[] | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as CatalogueResponse;
    if (data.version !== 1 || !Array.isArray(data.plugins)) return null;

    return data.plugins;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Merge: remote takes priority by name, local fills gaps
// ---------------------------------------------------------------------------

function mergeRegistries(
  remote: readonly RegistryEntry[],
  local: readonly RegistryEntry[],
): readonly RegistryEntry[] {
  const byName = new Map<string, RegistryEntry>();

  // Local first (lower priority)
  for (const entry of local) {
    byName.set(entry.name, entry);
  }
  // Remote overwrites
  for (const entry of remote) {
    byName.set(entry.name, entry);
  }

  return Array.from(byName.values());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Loads the plugin registry. Fetches from the remote catalogue URL first,
 * falling back to the local plugin-registry.json on failure.
 * Results are cached in memory for `cacheTtlSeconds`.
 */
export async function loadRegistry(options: RegistryOptions = {}): Promise<readonly RegistryEntry[]> {
  const {
    catalogueUrl = DEFAULT_CATALOGUE_URL,
    cacheTtlSeconds = 3600,
    fallbackPath = DEFAULT_REGISTRY_PATH,
  } = options;

  // Return cached entries if still valid
  const now = Date.now();
  if (cachedEntries !== null && now < cacheExpiresAt) {
    return cachedEntries;
  }

  const local = loadLocalRegistry(fallbackPath);

  // Try remote fetch
  const remote = await fetchRemoteCatalogue(catalogueUrl);

  let entries: readonly RegistryEntry[];
  if (remote !== null) {
    entries = mergeRegistries(remote, local);
  } else {
    // Remote unavailable — use local only
    entries = local;
  }

  // Update cache
  cachedEntries = entries;
  cacheExpiresAt = now + cacheTtlSeconds * 1000;

  return entries;
}

/**
 * Synchronous local-only registry load (for backward compat in tests).
 */
export function loadRegistrySync(registryPath: string = DEFAULT_REGISTRY_PATH): readonly RegistryEntry[] {
  return loadLocalRegistry(registryPath);
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

/**
 * Finds a registry entry by its npm package name, or returns null.
 */
export function getByPackageName(entries: readonly RegistryEntry[], packageName: string): RegistryEntry | null {
  return entries.find((entry) => entry.packageName === packageName) ?? null;
}

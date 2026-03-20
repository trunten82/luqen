import { readFileSync } from 'node:fs';
import type { PluginManager } from './manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  readonly installed: readonly string[];
  readonly configured: readonly string[];
  readonly activated: readonly string[];
  readonly errors: readonly string[];
}

interface PluginEntry {
  readonly name: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly active?: boolean;
}

interface PluginConfigFile {
  readonly plugins: readonly PluginEntry[];
}

// ---------------------------------------------------------------------------
// Environment variable resolution
// ---------------------------------------------------------------------------

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Recursively replaces `${VAR_NAME}` patterns in string values with
 * `process.env[VAR_NAME]`. Non-string values are returned unchanged.
 * A warning is logged for undefined environment variables (replaced
 * with empty string).
 */
export function resolveEnvVars(
  config: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      result[key] = value.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
        const envValue = process.env[varName];
        if (envValue === undefined) {
          console.warn(
            `Environment variable "${varName}" is not defined; substituting empty string`,
          );
          return '';
        }
        return envValue;
      });
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = resolveEnvVars(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

/**
 * Reads a `pally-plugins.json` config file and reconciles the declared
 * plugins against the current state managed by `PluginManager`.
 *
 * For each plugin entry:
 *  - If not already installed: install it.
 *  - Apply resolved config (env vars substituted).
 *  - If `active: true` and not already active: activate it.
 */
export async function reconcile(
  manager: PluginManager,
  configPath: string,
): Promise<ReconcileResult> {
  const raw = readFileSync(configPath, 'utf-8');
  const configFile = JSON.parse(raw) as PluginConfigFile;

  const installed: string[] = [];
  const configured: string[] = [];
  const activated: string[] = [];
  const errors: string[] = [];

  for (const entry of configFile.plugins) {
    const { name, config, active } = entry;

    // Check if already installed
    const existing = manager
      .list()
      .find((p) => p.packageName === name);

    let pluginId: string | null = existing?.id ?? null;

    // Install if missing
    if (!existing) {
      try {
        const record = await manager.install(name);
        pluginId = record.id;
        installed.push(name);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to install ${name}: ${message}`);
        continue; // Skip configure/activate if install failed
      }
    }

    // Configure (always apply config, even for already-installed plugins)
    if (pluginId && config) {
      const resolvedConfig = resolveEnvVars(config);
      await manager.configure(pluginId, resolvedConfig);
      configured.push(name);
    }

    // Activate if requested and not already active
    if (pluginId && active) {
      const current = manager.getPlugin(pluginId);
      if (current && current.status !== 'active') {
        await manager.activate(pluginId);
        activated.push(name);
      }
    }
  }

  return { installed, configured, activated, errors };
}

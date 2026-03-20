import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AzureBlobClient } from './azure-client.js';

// Local interface definitions (compatible with dashboard's StoragePlugin)
interface ConfigField {
  readonly key: string;
  readonly label: string;
  readonly type: 'string' | 'secret' | 'number' | 'boolean' | 'select';
  readonly required?: boolean;
  readonly default?: unknown;
  readonly options?: readonly string[];
}

interface PluginManifest {
  readonly name: string;
  readonly displayName: string;
  readonly type: 'auth' | 'notification' | 'storage' | 'scanner';
  readonly version: string;
  readonly description: string;
  readonly configSchema: readonly ConfigField[];
}

// ── Manifest ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const manifestPath = resolve(__dirname, '..', 'manifest.json');
const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
export const manifest: PluginManifest = Object.freeze(rawManifest);

// ── State ───────────────────────────────────────────────────────────────────

let client: AzureBlobClient | null = null;

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function activate(config: Readonly<Record<string, unknown>>): Promise<void> {
  const connectionString = config.connectionString as string | undefined;
  if (connectionString == null || connectionString === '') {
    throw new Error('Azure connectionString is required');
  }

  const containerName = config.containerName as string | undefined;
  if (containerName == null || containerName === '') {
    throw new Error('Azure containerName is required');
  }

  const prefix = (config.prefix as string | undefined) ?? 'pally-agent/';

  client = new AzureBlobClient(connectionString, containerName, prefix);
}

export async function deactivate(): Promise<void> {
  client = null;
}

export async function healthCheck(): Promise<boolean> {
  if (client === null) return false;
  return client.testConnection();
}

// ── Storage ─────────────────────────────────────────────────────────────────

export async function save(key: string, data: Uint8Array): Promise<void> {
  if (client === null) {
    throw new Error('Azure plugin is not activated');
  }
  await client.save(key, data);
}

export async function load(key: string): Promise<Uint8Array> {
  if (client === null) {
    throw new Error('Azure plugin is not activated');
  }
  return client.load(key);
}

async function deleteBlob(key: string): Promise<void> {
  if (client === null) {
    throw new Error('Azure plugin is not activated');
  }
  await client.delete(key);
}

export { deleteBlob as delete };

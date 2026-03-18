import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client } from './s3-client.js';

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

let client: S3Client | null = null;

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function activate(config: Readonly<Record<string, unknown>>): Promise<void> {
  const bucket = config.bucket as string | undefined;
  if (bucket == null || bucket === '') {
    throw new Error('S3 bucket is required');
  }

  const accessKeyId = config.accessKeyId as string | undefined;
  if (accessKeyId == null || accessKeyId === '') {
    throw new Error('S3 accessKeyId is required');
  }

  const secretAccessKey = config.secretAccessKey as string | undefined;
  if (secretAccessKey == null || secretAccessKey === '') {
    throw new Error('S3 secretAccessKey is required');
  }

  const region = (config.region as string | undefined) ?? 'us-east-1';
  const prefix = (config.prefix as string | undefined) ?? 'luqen/';

  client = new S3Client(bucket, region, { accessKeyId, secretAccessKey }, prefix);
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
    throw new Error('S3 plugin is not activated');
  }
  await client.save(key, data);
}

export async function load(key: string): Promise<Uint8Array> {
  if (client === null) {
    throw new Error('S3 plugin is not activated');
  }
  return client.load(key);
}

async function deleteObject(key: string): Promise<void> {
  if (client === null) {
    throw new Error('S3 plugin is not activated');
  }
  await client.delete(key);
}

export { deleteObject as delete };

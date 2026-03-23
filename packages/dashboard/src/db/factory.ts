import type { StorageAdapter } from './adapter.js';
import { SqliteStorageAdapter } from './sqlite/index.js';

export interface StorageConfig {
  readonly type: 'sqlite';  // extend later: | 'postgres' | 'mongodb'
  readonly sqlite?: { readonly dbPath: string };
}

export async function resolveStorageAdapter(config: StorageConfig): Promise<StorageAdapter> {
  switch (config.type) {
    case 'sqlite': {
      const dbPath = config.sqlite?.dbPath ?? './dashboard.db';
      const adapter = new SqliteStorageAdapter(dbPath);
      await adapter.connect();
      await adapter.migrate();
      return adapter;
    }
    default:
      throw new Error(`Unknown storage type: ${String(config.type)}`);
  }
}

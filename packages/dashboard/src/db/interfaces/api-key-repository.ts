import type { ApiKeyRecord } from '../types.js';

export interface ApiKeyRepository {
  storeKey(key: string, label: string, orgId?: string): Promise<string>;
  validateKey(key: string): Promise<boolean>;
  getOrCreateKey(): Promise<{ key: string | null; isNew: boolean }>;
  revokeAllKeys(): Promise<void>;
  listKeys(orgId?: string): Promise<ApiKeyRecord[]>;
  revokeKey(id: string): Promise<void>;
}

import type { ApiKeyRecord, ApiKeyRole } from '../types.js';

export interface ApiKeyValidation {
  readonly valid: boolean;
  readonly role?: ApiKeyRole;
}

export interface ApiKeyRepository {
  storeKey(
    key: string,
    label: string,
    orgId?: string,
    role?: ApiKeyRole,
    expiresAt?: string | null,
  ): Promise<string>;
  validateKey(key: string): Promise<ApiKeyValidation>;
  getOrCreateKey(): Promise<{ key: string | null; isNew: boolean }>;
  revokeAllKeys(): Promise<void>;
  listKeys(orgId?: string): Promise<ApiKeyRecord[]>;
  revokeKey(id: string, orgId?: string): Promise<void>;
  deleteKey(id: string, orgId: string): Promise<boolean>;
  revokeExpiredKeys(): Promise<number>;
}

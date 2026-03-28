import type { GitHostConfig, DeveloperCredential } from '../types.js';

export interface CreateGitHostConfigInput {
  readonly orgId: string;
  readonly pluginType: string;
  readonly hostUrl: string;
  readonly displayName: string;
}

export interface StoreCredentialInput {
  readonly userId: string;
  readonly gitHostConfigId: string;
  readonly encryptedToken: string;
  readonly tokenHint: string;
  readonly validatedUsername?: string;
}

export interface DeveloperCredentialRow extends DeveloperCredential {
  readonly encryptedToken: string;
}

export interface GitHostRepository {
  createConfig(input: CreateGitHostConfigInput): Promise<GitHostConfig>;
  getConfig(id: string): Promise<GitHostConfig | null>;
  listConfigs(orgId: string): Promise<GitHostConfig[]>;
  deleteConfig(id: string): Promise<void>;
  storeCredential(input: StoreCredentialInput): Promise<DeveloperCredential>;
  getCredentialForHost(userId: string, gitHostConfigId: string): Promise<DeveloperCredentialRow | null>;
  listCredentials(userId: string): Promise<DeveloperCredential[]>;
  deleteCredential(id: string, userId: string): Promise<void>;
}

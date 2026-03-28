import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorageAdapter } from '../../src/db/sqlite/index.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

let storage: SqliteStorageAdapter;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(tmpdir(), `test-${randomUUID()}.db`);
  storage = new SqliteStorageAdapter(dbPath);
  await storage.migrate();
});

afterEach(async () => {
  await storage.disconnect();
  if (existsSync(dbPath)) rmSync(dbPath);
});

describe('GitHostRepository', () => {
  describe('createConfig and listConfigs', () => {
    it('creates a git host config and lists by org', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'github',
        hostUrl: 'https://github.com',
        displayName: 'GitHub',
      });

      expect(config.id).toBeDefined();
      expect(config.orgId).toBe('org-1');
      expect(config.pluginType).toBe('github');
      expect(config.hostUrl).toBe('https://github.com');
      expect(config.displayName).toBe('GitHub');
      expect(typeof config.createdAt).toBe('string');

      const configs = await storage.gitHosts.listConfigs('org-1');
      expect(configs).toHaveLength(1);
      expect(configs[0].id).toBe(config.id);
    });

    it('returns empty list for org with no configs', async () => {
      const configs = await storage.gitHosts.listConfigs('org-none');
      expect(configs).toHaveLength(0);
    });

    it('enforces unique constraint on org+plugin+host', async () => {
      await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'github',
        hostUrl: 'https://github.com',
        displayName: 'GitHub',
      });

      await expect(
        storage.gitHosts.createConfig({
          orgId: 'org-1',
          pluginType: 'github',
          hostUrl: 'https://github.com',
          displayName: 'GitHub Duplicate',
        }),
      ).rejects.toThrow();
    });
  });

  describe('getConfig', () => {
    it('returns config by ID', async () => {
      const created = await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'gitlab',
        hostUrl: 'https://gitlab.com',
        displayName: 'GitLab',
      });

      const fetched = await storage.gitHosts.getConfig(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.displayName).toBe('GitLab');
    });

    it('returns null for non-existent ID', async () => {
      const result = await storage.gitHosts.getConfig('does-not-exist');
      expect(result).toBeNull();
    });
  });

  describe('deleteConfig', () => {
    it('removes the config from the database', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'github',
        hostUrl: 'https://github.com',
        displayName: 'GitHub',
      });

      await storage.gitHosts.deleteConfig(config.id);

      const result = await storage.gitHosts.getConfig(config.id);
      expect(result).toBeNull();
    });
  });

  describe('storeCredential and listCredentials', () => {
    it('stores and lists credentials for a user', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'github',
        hostUrl: 'https://github.com',
        displayName: 'GitHub',
      });

      const cred = await storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config.id,
        encryptedToken: 'encrypted-abc123',
        tokenHint: 'ghp_...xyz',
        validatedUsername: 'octocat',
      });

      expect(cred.id).toBeDefined();
      expect(cred.userId).toBe('user-1');
      expect(cred.gitHostConfigId).toBe(config.id);
      expect(cred.tokenHint).toBe('ghp_...xyz');
      expect(cred.validatedUsername).toBe('octocat');
      expect(typeof cred.createdAt).toBe('string');
      // The public DeveloperCredential should NOT expose encryptedToken
      expect((cred as Record<string, unknown>)['encryptedToken']).toBeUndefined();

      const list = await storage.gitHosts.listCredentials('user-1');
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(cred.id);
    });

    it('upserts on same user+host combination', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'github',
        hostUrl: 'https://github.com',
        displayName: 'GitHub',
      });

      await storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config.id,
        encryptedToken: 'encrypted-first',
        tokenHint: 'ghp_...aaa',
      });

      await storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config.id,
        encryptedToken: 'encrypted-second',
        tokenHint: 'ghp_...bbb',
        validatedUsername: 'newuser',
      });

      const list = await storage.gitHosts.listCredentials('user-1');
      expect(list).toHaveLength(1);
      expect(list[0].tokenHint).toBe('ghp_...bbb');
      expect(list[0].validatedUsername).toBe('newuser');
    });
  });

  describe('getCredentialForHost', () => {
    it('returns credential with encrypted token for a specific host', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'github',
        hostUrl: 'https://github.com',
        displayName: 'GitHub',
      });

      await storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config.id,
        encryptedToken: 'encrypted-secret',
        tokenHint: 'ghp_...xyz',
      });

      const row = await storage.gitHosts.getCredentialForHost('user-1', config.id);
      expect(row).not.toBeNull();
      expect(row!.encryptedToken).toBe('encrypted-secret');
      expect(row!.tokenHint).toBe('ghp_...xyz');
    });

    it('returns null when no credential exists', async () => {
      const result = await storage.gitHosts.getCredentialForHost('user-1', 'no-such-host');
      expect(result).toBeNull();
    });
  });

  describe('deleteCredential', () => {
    it('removes a credential owned by the user', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'github',
        hostUrl: 'https://github.com',
        displayName: 'GitHub',
      });

      const cred = await storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config.id,
        encryptedToken: 'encrypted-abc',
        tokenHint: 'ghp_...xyz',
      });

      await storage.gitHosts.deleteCredential(cred.id, 'user-1');

      const list = await storage.gitHosts.listCredentials('user-1');
      expect(list).toHaveLength(0);
    });

    it('does not delete credential belonging to another user', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'github',
        hostUrl: 'https://github.com',
        displayName: 'GitHub',
      });

      const cred = await storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config.id,
        encryptedToken: 'encrypted-abc',
        tokenHint: 'ghp_...xyz',
      });

      await storage.gitHosts.deleteCredential(cred.id, 'user-2');

      const list = await storage.gitHosts.listCredentials('user-1');
      expect(list).toHaveLength(1);
    });
  });

  describe('cascade delete', () => {
    it('deleting a config removes its credentials', async () => {
      const config = await storage.gitHosts.createConfig({
        orgId: 'org-1',
        pluginType: 'github',
        hostUrl: 'https://github.com',
        displayName: 'GitHub',
      });

      await storage.gitHosts.storeCredential({
        userId: 'user-1',
        gitHostConfigId: config.id,
        encryptedToken: 'encrypted-abc',
        tokenHint: 'ghp_...xyz',
      });

      await storage.gitHosts.storeCredential({
        userId: 'user-2',
        gitHostConfigId: config.id,
        encryptedToken: 'encrypted-def',
        tokenHint: 'ghp_...abc',
      });

      await storage.gitHosts.deleteConfig(config.id);

      const creds1 = await storage.gitHosts.listCredentials('user-1');
      const creds2 = await storage.gitHosts.listCredentials('user-2');
      expect(creds1).toHaveLength(0);
      expect(creds2).toHaveLength(0);
    });
  });
});
